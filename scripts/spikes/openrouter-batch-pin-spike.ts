// scripts/spikes/openrouter-batch-pin-spike.ts
//
// Two one-item batches against a cheap model. Batch A pins a slug that the
// endpoints listing marks unavailable (status !== 0) or that is currently
// rate-limited, with allow_fallbacks false. Batch B pins a live slug and sets
// X-OpenRouter-Metadata: enabled on the batch create request. Prints the
// batch status, request_counts, and each result entry verbatim so the D3
// table can be amended from observation rather than inference.
//
// Poll-only mode: `... openrouter-batch-pin-spike.ts --poll <batchId> [<batchId>...]`
// creates nothing and only polls the given batch ids every 60 seconds for up
// to 40 minutes, printing status, request_counts and, once terminal, the
// full record (same 4000-char truncation) verbatim. Spends no credit, so it
// does not count against the create path's two-run budget.
import { EnvLoader } from "../../src/utils/env-loader.ts";

await EnvLoader.loadEnvironment();
const key = Deno.env.get("OPENROUTER_API_KEY");
if (!key) throw new Error("OPENROUTER_API_KEY not set");
const MODEL = "z-ai/glm-5.3-flash";
const H = {
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

async function pollMany(
  ids: string[],
  intervalMs: number,
  maxAttempts: number,
) {
  const pending = new Set(ids);
  for (let i = 0; i < maxAttempts && pending.size > 0; i++) {
    await new Promise((res) => setTimeout(res, intervalMs));
    for (const id of [...pending]) {
      const r = await fetch(`https://openrouter.ai/api/beta/batches/${id}`, {
        headers: H,
      });
      const j = await r.json();
      const d = j.data ?? j;
      console.log(
        `${id} poll ${i}: status=${d.status} counts=${
          JSON.stringify(d.request_counts ?? {})
        }`,
      );
      if (["completed", "failed", "expired", "cancelled"].includes(d.status)) {
        console.log(`\n== ${id} final record (results verbatim):`);
        console.log(JSON.stringify(d).slice(0, 4000));
        pending.delete(id);
      }
    }
  }
  const minutes = Math.round((intervalMs * maxAttempts) / 60_000);
  for (const id of pending) {
    console.log(
      `${id}: still processing after ${minutes} minutes; record that as the observation`,
    );
  }
}

if (Deno.args[0] === "--poll") {
  const ids = Deno.args.slice(1);
  if (ids.length === 0) {
    throw new Error("--poll requires at least one batch id");
  }
  await pollMany(ids, 60_000, 40);
  Deno.exit(0);
}

const ep = await (await fetch(
  `https://openrouter.ai/api/v1/models/${MODEL}/endpoints`,
  { headers: H },
)).json() as { data?: { endpoints?: Array<{ tag: string; status?: number }> } };
const endpoints = ep.data?.endpoints ?? [];
const dead = endpoints.find((e) => (e.status ?? 0) !== 0)?.tag ??
  "no-such-upstream/fp8";
const live = endpoints.find((e) => (e.status ?? 0) === 0)?.tag;
if (!live) throw new Error("no live upstream to pin");
console.log(`dead pin: ${dead}   live pin: ${live}`);

async function createBatch(
  label: string,
  pin: string,
  extra: Record<string, string>,
) {
  const body = {
    endpoint: "/v1/chat/completions",
    model: MODEL,
    requests: [{
      custom_id: `${label}-1`,
      body: {
        model: MODEL,
        messages: [{ role: "user", content: "Reply with the single word: ok" }],
        max_tokens: 32,
        provider: { order: [pin], allow_fallbacks: false },
      },
    }],
  };
  const r = await fetch("https://openrouter.ai/api/beta/batches", {
    method: "POST",
    headers: { ...H, ...extra },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  console.log(`\n== ${label} create: HTTP ${r.status}`);
  console.log(JSON.stringify(j).slice(0, 600));
  return (j.data ?? j).id as string | undefined;
}

async function pollBatch(label: string, id: string) {
  for (let i = 0; i < 40; i++) {
    await new Promise((res) => setTimeout(res, 15_000));
    const r = await fetch(`https://openrouter.ai/api/beta/batches/${id}`, {
      headers: H,
    });
    const j = await r.json();
    const d = j.data ?? j;
    console.log(
      `${label} poll ${i}: status=${d.status} counts=${
        JSON.stringify(d.request_counts ?? {})
      }`,
    );
    if (["completed", "failed", "expired", "cancelled"].includes(d.status)) {
      console.log(`\n== ${label} final record (results verbatim):`);
      console.log(JSON.stringify(d).slice(0, 4000));
      return;
    }
  }
  console.log(
    `${label}: still processing after 10 minutes; record that as the observation`,
  );
}

const a = await createBatch("dead-pin", dead, {});
const b = await createBatch("live-pin-metadata", live, {
  "X-OpenRouter-Metadata": "enabled",
});
if (a) await pollBatch("dead-pin", a);
if (b) await pollBatch("live-pin-metadata", b);
