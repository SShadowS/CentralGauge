/**
 * Integration test: bench-precheck-flow
 * Full doctor.bench cycle with applyRepairs([seedCatalogRepairer]).
 * Stubs Deno.cwd, globalThis.fetch, OPENROUTER_API_KEY env.
 * Asserts the repair invocation succeeds and YAML is written.
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  cleanupTempDir,
  createTempDir,
  MockEnv,
} from "../../../utils/test-helpers.ts";
import {
  applyRepairs,
  seedCatalogRepairer,
} from "../../../../src/doctor/repair.ts";
import type { DoctorReport } from "../../../../src/doctor/types.ts";

describe("integration: bench-precheck-flow", () => {
  it("seedCatalogRepairer fills YAML when applyRepairs runs against catalog.bench failure", async () => {
    const tempDir = await createTempDir("seed-precheck");
    await Deno.mkdir(`${tempDir}/site/catalog`, { recursive: true });
    await Deno.writeTextFile(`${tempDir}/site/catalog/models.yml`, "");
    await Deno.writeTextFile(
      `${tempDir}/site/catalog/model-families.yml`,
      "",
    );
    await Deno.writeTextFile(`${tempDir}/site/catalog/pricing.yml`, "");

    const mockEnv = new MockEnv();
    const originalCwd = Deno.cwd;
    const originalFetch = globalThis.fetch;

    try {
      // Stub Deno.cwd to return tempDir
      (Deno as { cwd: () => string }).cwd = () => tempDir;

      // Stub globalThis.fetch to return OpenRouter metadata
      globalThis.fetch = ((
        _input: string | Request,
        _init?: RequestInit,
      ): Promise<Response> => {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [{
                id: "x-ai/grok-4.3",
                name: "xAI: Grok 4.3",
                created: 1761955200,
                pricing: {
                  prompt: "0.00000125",
                  completion: "0.0000025",
                },
              }],
            }),
            { status: 200 },
          ),
        );
      }) as typeof fetch;

      // Set OPENROUTER_API_KEY
      mockEnv.set("OPENROUTER_API_KEY", "test-key-openrouter");

      // Create a doctor report with catalog.bench failure
      const report: DoctorReport = {
        schemaVersion: 1,
        section: "ingest",
        generatedAt: "2026-05-03T00:00:00.000Z",
        ok: false,
        checks: [
          {
            id: "catalog.bench",
            level: "D",
            status: "failed",
            message: "models missing from bench",
            remediation: {
              summary: "Seed missing models",
              autoRepairable: true,
            },
            details: {
              missing_models: [{ slug: "openrouter/x-ai/grok-4.3" }],
              missing_pricing: [],
              task_set_known: true,
              task_set_current: true,
            },
            durationMs: 42,
          },
        ],
        summary: { passed: 0, failed: 1, warning: 0, skipped: 0 },
      };

      // Run only the seed repairer
      const outcome = await applyRepairs(report, [seedCatalogRepairer]);

      assertEquals(outcome.attempted.length, 1, "Should attempt 1 repair");
      assertEquals(
        outcome.attempted[0]?.checkId,
        "catalog.bench",
        "Should repair catalog.bench check",
      );
      assertEquals(
        outcome.attempted[0]?.ok,
        true,
        "Repair should succeed",
      );

      // Verify YAML was written
      const models = await Deno.readTextFile(
        `${tempDir}/site/catalog/models.yml`,
      );
      assertEquals(
        models.includes("openrouter/x-ai/grok-4.3") ||
          models.includes("grok-4.3"),
        true,
        "models.yml should contain the seeded model",
      );

      const families = await Deno.readTextFile(
        `${tempDir}/site/catalog/model-families.yml`,
      );
      assertEquals(
        families.includes("grok") || families.includes("x-ai"),
        true,
        "model-families.yml should contain the family",
      );

      const pricing = await Deno.readTextFile(
        `${tempDir}/site/catalog/pricing.yml`,
      );
      assertEquals(
        pricing.includes("openrouter"),
        true,
        "pricing.yml should contain openrouter source",
      );
    } finally {
      // Restore original functions
      (Deno as { cwd: () => string }).cwd = originalCwd;
      globalThis.fetch = originalFetch;
      mockEnv.restore();
      await cleanupTempDir(tempDir);
    }
  });
});
