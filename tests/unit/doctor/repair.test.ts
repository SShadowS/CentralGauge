import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  applyRepairs,
  builtInRepairers,
  markTaskSetCurrentRepairer,
  type Repairer,
  seedCatalogRepairer,
} from "../../../src/doctor/repair.ts";
import type { DoctorReport } from "../../../src/doctor/types.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

const reportWithRepairableFailure: DoctorReport = {
  schemaVersion: 1,
  section: "ingest",
  generatedAt: "2026-04-26T00:00:00.000Z",
  ok: false,
  checks: [
    {
      id: "catalog.bench",
      level: "D",
      status: "failed",
      message: "pricing missing for openai/gpt-5",
      remediation: {
        summary: "Push catalog drift to D1",
        command: "deno task start sync-catalog --apply",
        autoRepairable: true,
      },
      details: {
        missing_pricing: [{
          slug: "openai/gpt-5",
          pricing_version: "2026-04-26",
        }],
      },
      durationMs: 100,
    },
  ],
  summary: { passed: 0, failed: 1, warning: 0, skipped: 0 },
};

describe("applyRepairs", () => {
  it("invokes the matching repairer for each auto-repairable failed check", async () => {
    const calls: string[] = [];
    const repairer: Repairer = {
      id: "sync-catalog",
      matches: (r) =>
        r.id === "catalog.bench" && r.remediation?.autoRepairable === true,
      run: async () => {
        await Promise.resolve();
        calls.push("sync-catalog");
        return { ok: true, message: "synced" };
      },
    };
    const outcome = await applyRepairs(reportWithRepairableFailure, [repairer]);
    assertEquals(calls, ["sync-catalog"]);
    assertEquals(outcome.attempted.length, 1);
    assertEquals(outcome.attempted[0]!.checkId, "catalog.bench");
    assertEquals(outcome.attempted[0]!.ok, true);
  });

  it("does not invoke repairers for non-repairable failures", async () => {
    const failedNonRepairable: DoctorReport = {
      ...reportWithRepairableFailure,
      checks: [
        {
          id: "auth.probe",
          level: "C",
          status: "failed",
          message: "key mismatch",
          remediation: {
            summary: "Re-provision",
            autoRepairable: false,
          },
          durationMs: 0,
        },
      ],
    };
    const calls: string[] = [];
    const r: Repairer = {
      id: "any",
      matches: () => true,
      run: async () => {
        await Promise.resolve();
        calls.push("ran");
        return { ok: true };
      },
    };
    const outcome = await applyRepairs(failedNonRepairable, [r]);
    assertEquals(calls.length, 0);
    assertEquals(outcome.attempted.length, 0);
  });

  it("captures repairer errors and reports ok=false", async () => {
    const r: Repairer = {
      id: "boom",
      matches: () => true,
      run: async () => {
        await Promise.resolve();
        throw new Error("kaboom");
      },
    };
    const outcome = await applyRepairs(reportWithRepairableFailure, [r]);
    assertEquals(outcome.attempted.length, 1);
    assertEquals(outcome.attempted[0]!.ok, false);
    assertEquals(outcome.attempted[0]!.message?.includes("kaboom"), true);
  });
});

describe("seedCatalogRepairer.matches", () => {
  it("matches catalog.bench failures with missing_models", () => {
    const check = {
      id: "catalog.bench" as const,
      level: "D" as const,
      status: "failed" as const,
      message: "models missing",
      remediation: { summary: "", autoRepairable: true as const },
      details: { missing_models: [{ slug: "openrouter/x-ai/grok-4.3" }] },
      durationMs: 0,
    };
    assertEquals(seedCatalogRepairer.matches(check), true);
  });

  it("does not match when no missing_models", () => {
    const check = {
      id: "catalog.bench" as const,
      level: "D" as const,
      status: "failed" as const,
      message: "",
      remediation: { summary: "", autoRepairable: true as const },
      details: { missing_models: [] },
      durationMs: 0,
    };
    assertEquals(seedCatalogRepairer.matches(check), false);
  });

  it("does not match when autoRepairable=false", () => {
    const check = {
      id: "catalog.bench" as const,
      level: "D" as const,
      status: "failed" as const,
      message: "",
      remediation: { summary: "", autoRepairable: false as const },
      details: { missing_models: [{ slug: "x" }] },
      durationMs: 0,
    };
    assertEquals(seedCatalogRepairer.matches(check), false);
  });

  it("does not match for non-catalog.bench check ids", () => {
    const check = {
      id: "auth.probe" as const,
      level: "C" as const,
      status: "failed" as const,
      message: "",
      remediation: { summary: "", autoRepairable: true as const },
      details: {},
      durationMs: 0,
    };
    assertEquals(seedCatalogRepairer.matches(check), false);
  });
});

describe("seedCatalogRepairer.run", () => {
  it("returns ok=true and a summary message on success", async () => {
    const tempDir = await createTempDir("seed-repair-cwd");
    await Deno.mkdir(`${tempDir}/site/catalog`, { recursive: true });
    await Deno.writeTextFile(`${tempDir}/site/catalog/models.yml`, "");
    await Deno.writeTextFile(
      `${tempDir}/site/catalog/model-families.yml`,
      "",
    );
    await Deno.writeTextFile(`${tempDir}/site/catalog/pricing.yml`, "");

    const originalCwd = Deno.cwd;
    (Deno as { cwd: () => string }).cwd = () => tempDir;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: [
              {
                id: "x-ai/grok-4.3",
                name: "xAI: Grok 4.3",
                created: 1761955200,
                pricing: { prompt: "0.00000125", completion: "0.0000025" },
              },
            ],
          }),
          { status: 200 },
        ),
      )) as typeof fetch;
    Deno.env.set("OPENROUTER_API_KEY", "test-key");

    try {
      const result = await seedCatalogRepairer.run({
        id: "catalog.bench",
        level: "D",
        status: "failed",
        message: "",
        remediation: { summary: "", autoRepairable: true },
        details: {
          missing_models: [{ slug: "openrouter/x-ai/grok-4.3" }],
        },
        durationMs: 0,
      });
      assertEquals(result.ok, true);
      assertEquals(result.message?.includes("seeded 1 model"), true);

      // Verify YAML was actually written.
      const models = await Deno.readTextFile(
        `${tempDir}/site/catalog/models.yml`,
      );
      assertEquals(models.includes("openrouter/x-ai/grok-4.3"), true);
    } finally {
      (Deno as { cwd: () => string }).cwd = originalCwd;
      globalThis.fetch = originalFetch;
      await cleanupTempDir(tempDir);
    }
  });

  it("returns ok=false with detail when a slug has no pricing source", async () => {
    const tempDir = await createTempDir("seed-repair-fail");
    await Deno.mkdir(`${tempDir}/site/catalog`, { recursive: true });
    await Deno.writeTextFile(`${tempDir}/site/catalog/models.yml`, "");
    await Deno.writeTextFile(
      `${tempDir}/site/catalog/model-families.yml`,
      "",
    );
    await Deno.writeTextFile(`${tempDir}/site/catalog/pricing.yml`, "");

    const originalCwd = Deno.cwd;
    (Deno as { cwd: () => string }).cwd = () => tempDir;

    const originalFetch = globalThis.fetch;
    // OR returns empty data; LiteLLM also returns nothing for unknown.
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      )) as typeof fetch;
    Deno.env.set("OPENROUTER_API_KEY", "test-key");

    try {
      const result = await seedCatalogRepairer.run({
        id: "catalog.bench",
        level: "D",
        status: "failed",
        message: "",
        remediation: { summary: "", autoRepairable: true },
        details: {
          missing_models: [{ slug: "openrouter/acme/totally-fake-9000" }],
        },
        durationMs: 0,
      });
      assertEquals(result.ok, false);
      assertEquals(result.message?.includes("seed failed"), true);
      assertEquals(result.message?.includes("no pricing source"), true);
    } finally {
      (Deno as { cwd: () => string }).cwd = originalCwd;
      globalThis.fetch = originalFetch;
      await cleanupTempDir(tempDir);
    }
  });
});

describe("builtInRepairers ordering", () => {
  it("includes seedCatalogRepairer before syncCatalogRepairer", () => {
    const ids = builtInRepairers.map((r) => r.id);
    const seedIdx = ids.indexOf("seed-catalog");
    const syncIdx = ids.indexOf("sync-catalog");
    assertEquals(seedIdx >= 0, true);
    assertEquals(syncIdx >= 0, true);
    assertEquals(seedIdx < syncIdx, true);
  });
});

describe("markTaskSetCurrentRepairer.matches", () => {
  it("matches when task_set_known=true and task_set_current=false", () => {
    const check = {
      id: "catalog.bench",
      level: "D" as const,
      status: "failed" as const,
      message: "task_set is_current=0",
      remediation: { summary: "...", autoRepairable: true },
      details: {
        task_set_known: true,
        task_set_current: false,
        task_set_hash: "abc",
      },
      durationMs: 0,
    };
    assertEquals(markTaskSetCurrentRepairer.matches(check), true);
  });

  it("does not match when task_set_known=false", () => {
    const check = {
      id: "catalog.bench",
      level: "D" as const,
      status: "failed" as const,
      message: "task_set unknown",
      remediation: { summary: "...", autoRepairable: false },
      details: { task_set_known: false, task_set_current: false },
      durationMs: 0,
    };
    assertEquals(markTaskSetCurrentRepairer.matches(check), false);
  });

  it("does not match when task_set_current=true", () => {
    const check = {
      id: "catalog.bench",
      level: "D" as const,
      status: "failed" as const,
      message: "ok",
      remediation: { summary: "...", autoRepairable: true },
      details: { task_set_known: true, task_set_current: true },
      durationMs: 0,
    };
    assertEquals(markTaskSetCurrentRepairer.matches(check), false);
  });
});
