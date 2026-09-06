/**
 * Spike 3 (spec section 11): OpenRouter beta batch shape and a measured
 * item/byte ceiling. Phase A submits a 3-item batch on a cheap model and one
 * Gemini 3.8 Flash item with reasoning params; phase B doubles item count
 * until the API rejects the submission, then doubles body size the same way.
 *
 * NOTE: `openai/gpt-5-mini` was tried first and rejected outright with
 * `{"error":{"message":"Model 'openai/gpt-5-mini' does not have a :batch
 * endpoint.","code":400}}`. OpenRouter's own batch-quickstart docs give
 * `openai/gpt-4o` as a working example model, but that was ALSO rejected
 * with the identical `does not have a :batch endpoint` error (both recorded
 * in the findings doc) — every OpenAI-family model tried is batch-disabled
 * for this account/key, while `google/gemini-3.8-flash` was accepted (202).
 * Phase B (the ceiling probes) therefore runs against the Gemini model —
 * the only model this key can actually submit a batch for — instead of the
 * OpenAI model the brief originally specified, since probing ceilings
 * against a model that 400s on every call measures nothing.
 *
 *   deno run --allow-all scripts/spikes/batch/openrouter-shape.ts
 */
import { EnvLoader } from "../../../src/utils/env-loader.ts";
await EnvLoader.loadEnvironment();

const KEY = Deno.env.get("OPENROUTER_API_KEY");
const BASE = "https://openrouter.ai/api/beta/batches";
const CHEAP = "openai/gpt-4o";
const WORKING = "google/gemini-3.8-flash";

function request(
  customId: string,
  model: string,
  content: string,
  extra: Record<string, unknown> = {},
) {
  return {
    custom_id: customId,
    body: {
      model,
      max_tokens: 64,
      messages: [{ role: "user", content }],
      ...extra,
    },
  };
}

async function submit(model: string, requests: unknown[]): Promise<Response> {
  // Key order matters to the beta API: endpoint, model, requests.
  const body = JSON.stringify({
    endpoint: "/v1/chat/completions",
    model,
    requests,
  });
  console.log("submit", model, requests.length, "items", body.length, "bytes");
  return await fetch(BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body,
  });
}

async function poll(id: string): Promise<Record<string, unknown>> {
  for (;;) {
    const res = await fetch(`${BASE}/${id}`, {
      headers: { Authorization: `Bearer ${KEY}` },
    });
    const json = await res.json() as Record<string, unknown>;
    const status = String(
      (json["data"] as Record<string, unknown> | undefined)?.["status"] ??
        json["status"],
    );
    console.log("poll", id, status);
    if (["completed", "failed", "expired", "cancelled"].includes(status)) {
      return json;
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

// Phase A: shape.
const a = await submit(CHEAP, [
  request("b-1", CHEAP, "Reply with the single word OK."),
  request("b-2", CHEAP, "Reply with the single word YES."),
  request("b-3", CHEAP, "Reply with the single word NO."),
]);
console.log("create status", a.status);
const created = await a.json() as Record<string, unknown>;
console.log("create body", JSON.stringify(created));
if (a.status >= 400) {
  console.log("FINAL", "skipped (create failed, see create body above)");
} else {
  const id = String(
    (created["data"] as Record<string, unknown> | undefined)?.["id"] ??
      created["id"],
  );
  const done = await poll(id);
  console.log("FINAL", JSON.stringify(done));
}

const g = await submit(WORKING, [
  request("g-1", WORKING, "Reply with the single word OK.", {
    reasoning: { effort: "low" },
  }),
]);
console.log("gemini create status", g.status);
const gCreated = await g.json() as Record<string, unknown>;
console.log("gemini create body", JSON.stringify(gCreated));
if (g.status < 400) {
  const gId = String(
    (gCreated["data"] as Record<string, unknown> | undefined)?.["id"] ??
      gCreated["id"],
  );
  const gDone = await poll(gId);
  console.log("GEMINI FINAL", JSON.stringify(gDone));
} else {
  console.log("GEMINI FINAL", "skipped (create failed, see create body above)");
}

const since = new Date(Date.now() - 600_000).toISOString();
const listed = await fetch(
  `${BASE}?created_after=${encodeURIComponent(since)}`,
  {
    headers: { Authorization: `Bearer ${KEY}` },
  },
);
console.log("list", listed.status, await listed.text());

// Phase B: ceilings. Doubling item count with a tiny body, then doubling body
// size with one item. Uses WORKING (the only model this key can submit a
// batch for) rather than CHEAP, which 400s unconditionally — see the header
// note.
for (let n = 8; n <= 4096; n *= 2) {
  const res = await submit(
    WORKING,
    Array.from({ length: n }, (_, i) => request(`c-${i}`, WORKING, "OK")),
  );
  console.log("items", n, "->", res.status, (await res.text()).slice(0, 300));
  if (res.status >= 400) break;
}
for (let kb = 64; kb <= 65536; kb *= 2) {
  const res = await submit(WORKING, [
    request("s-1", WORKING, "x".repeat(kb * 1024)),
  ]);
  console.log(
    "bytes",
    kb,
    "KiB ->",
    res.status,
    (await res.text()).slice(0, 300),
  );
  if (res.status >= 400) break;
}
