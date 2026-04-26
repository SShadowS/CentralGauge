import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { checkCatalogBench } from "../../../../../src/doctor/sections/ingest/check-catalog-bench.ts";
import type { DoctorContext } from "../../../../../src/doctor/types.ts";

async function setup(): Promise<string> {
  const tmp = await Deno.makeTempDir();
  const keyPath = `${tmp}/k.ed25519`;
  // 32 non-zero bytes — valid ed25519 seed.
  const seed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) seed[i] = i + 1;
  await Deno.writeFile(keyPath, seed);
  await Deno.writeTextFile(
    `${tmp}/.centralgauge.yml`,
    `ingest:\n  url: https://x.example\n  key_id: 7\n  key_path: ${keyPath}\n  machine_id: m\n`,
  );
  Deno.env.set("CENTRALGAUGE_TEST_HOME", tmp);
  return tmp;
}

describe("checkCatalogBench", () => {
  it("skips with warning when ctx.variants is empty", async () => {
    const tmp = await setup();
    try {
      const ctx: DoctorContext = {
        cwd: tmp,
        fetchFn: async () => await Promise.resolve(new Response("{}")),
        previousResults: new Map(),
      };
      const result = await checkCatalogBench.run(ctx);
      assertEquals(result.status, "warning");
      assertEquals(result.message.includes("no variants"), true);
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("passes when all variants registered, pricing seeded, task-set current", async () => {
    const tmp = await setup();
    try {
      const fetchFn: typeof fetch = async () =>
        await Promise.resolve(
          new Response(
            JSON.stringify({
              schema_version: 1,
              auth: {
                ok: true,
                key_id: 7,
                key_role: "ingest",
                key_active: true,
                machine_id_match: true,
              },
              catalog: {
                missing_models: [],
                missing_pricing: [],
                task_set_current: true,
                task_set_known: true,
              },
              server_time: new Date().toISOString(),
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      const ctx: DoctorContext = {
        cwd: tmp,
        fetchFn,
        variants: [{
          slug: "anthropic/claude-opus-4-7",
          api_model_id: "claude-opus-4-7",
          family_slug: "claude",
        }],
        pricingVersion: "2026-04-26",
        taskSetHash: "abc",
        previousResults: new Map(),
      };
      const result = await checkCatalogBench.run(ctx);
      assertEquals(result.status, "passed");
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("fails when missing_models is non-empty and is auto-repairable", async () => {
    const tmp = await setup();
    try {
      const fetchFn: typeof fetch = async () =>
        await Promise.resolve(
          new Response(
            JSON.stringify({
              schema_version: 1,
              auth: {
                ok: true,
                key_id: 7,
                key_role: "ingest",
                key_active: true,
                machine_id_match: true,
              },
              catalog: {
                missing_models: [{
                  slug: "openai/gpt-5",
                  reason: "no models row",
                }],
                missing_pricing: [],
                task_set_current: true,
                task_set_known: true,
              },
              server_time: new Date().toISOString(),
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      const ctx: DoctorContext = {
        cwd: tmp,
        fetchFn,
        variants: [{
          slug: "openai/gpt-5",
          api_model_id: "gpt-5",
          family_slug: "gpt",
        }],
        previousResults: new Map(),
      };
      const result = await checkCatalogBench.run(ctx);
      assertEquals(result.status, "failed");
      assertEquals(result.remediation?.autoRepairable, true);
      assertEquals(
        result.remediation?.command,
        "deno task start sync-catalog --apply",
      );
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });

  it("fails when task_set_current=false (mark-current is auto-repairable)", async () => {
    const tmp = await setup();
    try {
      const fetchFn: typeof fetch = async () =>
        await Promise.resolve(
          new Response(
            JSON.stringify({
              schema_version: 1,
              auth: {
                ok: true,
                key_id: 7,
                key_role: "ingest",
                key_active: true,
                machine_id_match: true,
              },
              catalog: {
                missing_models: [],
                missing_pricing: [],
                task_set_current: false,
                task_set_known: true,
              },
              server_time: new Date().toISOString(),
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      const ctx: DoctorContext = {
        cwd: tmp,
        fetchFn,
        variants: [{ slug: "x/y", api_model_id: "y", family_slug: "x" }],
        taskSetHash: "abc",
        previousResults: new Map(),
      };
      const result = await checkCatalogBench.run(ctx);
      assertEquals(result.status, "failed");
      assertEquals(result.remediation?.autoRepairable, true);
    } finally {
      Deno.env.delete("CENTRALGAUGE_TEST_HOME");
      await Deno.remove(tmp, { recursive: true });
    }
  });
});
