import { assertEquals } from "@std/assert";
import * as ed from "npm:@noble/ed25519@3.1.0";
import { syncCatalogToAdmin } from "../../../src/ingest/catalog/sync.ts";
import type { Catalog } from "../../../src/ingest/catalog/read.ts";

const adminPriv = ed.utils.randomSecretKey();
const config = { url: "https://cg.example/", adminKeyId: 1 };

const emptyCatalog: Catalog = { models: [], pricing: [], families: [] };

function oneModelCatalog(): Catalog {
  return {
    families: [{ slug: "grok", vendor: "xAI", display_name: "Grok" }],
    models: [{
      slug: "openrouter/x-ai/grok-4.3",
      api_model_id: "x-ai/grok-4.3",
      family: "grok",
      display_name: "Grok 4.3",
    }],
    pricing: [{
      pricing_version: "2026-07-17",
      model_slug: "openrouter/x-ai/grok-4.3",
      effective_from: "2026-07-17T00:00:00.000Z",
      effective_until: null,
      input_per_mtoken: 1,
      output_per_mtoken: 2,
      cache_read_per_mtoken: 0,
      cache_write_per_mtoken: 0,
      source: "openrouter-api",
      fetched_at: "2026-07-17T00:00:00.000Z",
    }],
  };
}

function ok200(): Response {
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

Deno.test("syncCatalogToAdmin: no rows -> ok, no retry, empty item list", async () => {
  const result = await syncCatalogToAdmin(emptyCatalog, config, adminPriv, {
    fetchFn: () => Promise.resolve(ok200()),
  });
  assertEquals(result.items.length, 0);
  assertEquals(result.retried, false);
  assertEquals(result.ok, true);
});

Deno.test("syncCatalogToAdmin: all rows succeed first pass -> no retry", async () => {
  let calls = 0;
  const result = await syncCatalogToAdmin(
    oneModelCatalog(),
    config,
    adminPriv,
    {
      fetchFn: () => {
        calls++;
        return Promise.resolve(ok200());
      },
    },
  );
  assertEquals(calls, 3); // family + model + pricing
  assertEquals(result.retried, false);
  assertEquals(result.ok, true);
  assertEquals(result.items.map((i) => i.kind), ["family", "model", "pricing"]);
  assertEquals(result.items.every((i) => i.ok), true);
});

Deno.test("syncCatalogToAdmin: a 429 with Retry-After recovers on the single retry pass, honoring the header wait", async () => {
  const sleeps: number[] = [];
  let pricingCalls = 0;
  const result = await syncCatalogToAdmin(
    oneModelCatalog(),
    config,
    adminPriv,
    {
      sleepFn: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      fetchFn: (input) => {
        const url = String(input);
        if (url.includes("/pricing")) {
          pricingCalls++;
          if (pricingCalls === 1) {
            return Promise.resolve(
              new Response("rate limited", {
                status: 429,
                headers: { "retry-after": "5" },
              }),
            );
          }
          return Promise.resolve(ok200());
        }
        return Promise.resolve(ok200());
      },
    },
  );

  assertEquals(result.retried, true);
  assertEquals(result.ok, true);
  assertEquals(sleeps, [5000]); // honored the Retry-After: 5 header, in ms
  const pricingResult = result.items.find((i) => i.kind === "pricing")!;
  assertEquals(pricingResult.ok, true);
  assertEquals(pricingResult.status, 200);
});

Deno.test("syncCatalogToAdmin: 429 with no Retry-After header uses the short bounded default, not a blanket 60s sleep", async () => {
  const sleeps: number[] = [];
  let familyCalls = 0;
  const result = await syncCatalogToAdmin(
    oneModelCatalog(),
    config,
    adminPriv,
    {
      defaultRetryWaitMs: 2000,
      sleepFn: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      fetchFn: (input) => {
        const url = String(input);
        if (url.includes("/families")) {
          familyCalls++;
          if (familyCalls === 1) {
            return Promise.resolve(
              new Response("rate limited", { status: 429 }),
            );
          }
          return Promise.resolve(ok200());
        }
        return Promise.resolve(ok200());
      },
    },
  );

  assertEquals(result.retried, true);
  assertEquals(sleeps, [2000]);
  assertEquals(result.ok, true);
});

Deno.test("syncCatalogToAdmin: caps an oversized Retry-After hint at maxRetryWaitMs", async () => {
  const sleeps: number[] = [];
  let modelCalls = 0;
  const result = await syncCatalogToAdmin(
    oneModelCatalog(),
    config,
    adminPriv,
    {
      maxRetryWaitMs: 10_000,
      sleepFn: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      fetchFn: (input) => {
        const url = String(input);
        if (url.includes("/models")) {
          modelCalls++;
          if (modelCalls === 1) {
            return Promise.resolve(
              new Response("rate limited", {
                status: 429,
                headers: { "retry-after": "600" }, // 600s = 600_000ms, way over the cap
              }),
            );
          }
          return Promise.resolve(ok200());
        }
        return Promise.resolve(ok200());
      },
    },
  );

  assertEquals(sleeps, [10_000]);
  assertEquals(result.ok, true);
});

Deno.test("syncCatalogToAdmin: still-429-after-retry reports a resumable failure (not silently swallowed)", async () => {
  const result = await syncCatalogToAdmin(
    oneModelCatalog(),
    config,
    adminPriv,
    {
      sleepFn: () => Promise.resolve(),
      fetchFn: () =>
        Promise.resolve(new Response("still limited", { status: 429 })),
    },
  );

  assertEquals(result.retried, true);
  assertEquals(result.ok, false);
  // Resumable: every item that's still bad is identifiable by kind+key.
  const failed = result.items.filter((i) => !i.ok);
  assertEquals(failed.length, 3);
  assertEquals(failed.map((f) => f.status), [429, 429, 429]);
});

Deno.test("syncCatalogToAdmin: a permanent (non-429) failure is reported but NOT retried", async () => {
  let calls = 0;
  const result = await syncCatalogToAdmin(
    oneModelCatalog(),
    config,
    adminPriv,
    {
      sleepFn: () => {
        throw new Error("should not sleep — nothing here is retryable");
      },
      fetchFn: () => {
        calls++;
        return Promise.resolve(
          new Response(JSON.stringify({ code: "bad_signature" }), {
            status: 400,
          }),
        );
      },
    },
  );

  assertEquals(calls, 3); // one call per row, no retry pass
  assertEquals(result.retried, false);
  assertEquals(result.ok, false);
  assertEquals(result.items.every((i) => i.status === 400 && !i.ok), true);
});

Deno.test("syncCatalogToAdmin: mixed batch — permanent failure stays failed, 429 recovers — only the 429 row is retried", async () => {
  let familyCalls = 0;
  let modelCalls = 0;
  const result = await syncCatalogToAdmin(
    oneModelCatalog(),
    config,
    adminPriv,
    {
      sleepFn: () => Promise.resolve(),
      fetchFn: (input) => {
        const url = String(input);
        if (url.includes("/families")) {
          familyCalls++;
          // Permanently bad signature — retrying never helps.
          return Promise.resolve(new Response("bad sig", { status: 400 }));
        }
        if (url.includes("/models")) {
          modelCalls++;
          if (modelCalls === 1) {
            return Promise.resolve(
              new Response("rate limited", { status: 429 }),
            );
          }
          return Promise.resolve(ok200());
        }
        return Promise.resolve(ok200());
      },
    },
  );

  assertEquals(familyCalls, 1); // never retried
  assertEquals(modelCalls, 2); // first pass 429, retried once
  assertEquals(result.retried, true);
  assertEquals(result.ok, false);
  const family = result.items.find((i) => i.kind === "family")!;
  const model = result.items.find((i) => i.kind === "model")!;
  assertEquals(family.ok, false);
  assertEquals(model.ok, true);
});

Deno.test("syncCatalogToAdmin: onItem fires once per row per pass with the final resumable state reflected in the return value", async () => {
  const seen: string[] = [];
  let pricingCalls = 0;
  await syncCatalogToAdmin(oneModelCatalog(), config, adminPriv, {
    sleepFn: () => Promise.resolve(),
    onItem: (r) => seen.push(`${r.kind}:${r.status}`),
    fetchFn: (input) => {
      const url = String(input);
      if (url.includes("/pricing")) {
        pricingCalls++;
        if (pricingCalls === 1) {
          return Promise.resolve(new Response("rate limited", { status: 429 }));
        }
        return Promise.resolve(ok200());
      }
      return Promise.resolve(ok200());
    },
  });

  // family:200, model:200, pricing:429 (pass 1), then pricing:200 (retry pass)
  assertEquals(seen, ["family:200", "model:200", "pricing:429", "pricing:200"]);
});
