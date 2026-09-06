/**
 * Spike 2b (spec section 11): companion to openai-endpoint.ts. Creates a
 * batch for each (model, endpoint) pair given on the command line
 * concurrently, then polls all of them together, instead of the serial
 * script's create-one-then-poll-to-completion-before-the-next shape (which
 * makes four sequential batch waits when one batch alone can sit
 * `in_progress` for tens of minutes on the 24h completion window).
 *
 * Each pair is `<model>:<endpoint>`, e.g. `gpt-6-astra:/v1/chat/completions`.
 *
 *   deno run --allow-all scripts/spikes/batch/openai-endpoint-parallel.ts \
 *     gpt-6-astra:/v1/chat/completions gpt-5-mini:/v1/responses gpt-6-astra:/v1/responses
 */
import { EnvLoader } from "../../../src/utils/env-loader.ts";
await EnvLoader.loadEnvironment();

import OpenAI from "@openai/openai";

const client = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY") });

function line(model: string, endpoint: string, id: string): string {
  const body = endpoint === "/v1/chat/completions"
    ? {
      model,
      max_completion_tokens: 64,
      messages: [{ role: "user", content: "Reply with the single word OK." }],
    }
    : { model, max_output_tokens: 64, input: "Reply with the single word OK." };
  return JSON.stringify({ custom_id: id, method: "POST", url: endpoint, body });
}

interface Pending {
  model: string;
  endpoint: string;
  fileId: string;
  batchId: string;
}

type Endpoint = "/v1/chat/completions" | "/v1/responses";

function asEndpoint(value: string): Endpoint {
  if (value === "/v1/chat/completions" || value === "/v1/responses") {
    return value;
  }
  throw new Error(`unsupported endpoint: ${value}`);
}

const pairs = Deno.args.map((arg) => {
  const idx = arg.indexOf(":");
  return { model: arg.slice(0, idx), endpoint: asEndpoint(arg.slice(idx + 1)) };
});
if (pairs.length === 0) {
  console.error("usage: openai-endpoint-parallel.ts <model>:<endpoint> ...");
  Deno.exit(1);
}

const pending: Pending[] = [];
for (const { model, endpoint } of pairs) {
  const nonce = crypto.randomUUID();
  const jsonl = line(model, endpoint, "b-0") + "\n";
  const file = await client.files.create({
    file: new File([jsonl], `spike-${nonce}.jsonl`),
    purpose: "batch",
  });
  const batch = await client.batches.create({
    input_file_id: file.id,
    endpoint,
    completion_window: "24h",
    metadata: { nonce, runId: "spike-parallel", model },
  });
  console.log("created", endpoint, model, batch.id, batch.status);
  pending.push({ model, endpoint, fileId: file.id, batchId: batch.id });
}

const remaining = new Set(pending.map((p) => p.batchId));
while (remaining.size > 0) {
  await new Promise((r) => setTimeout(r, 10_000));
  for (const p of pending) {
    if (!remaining.has(p.batchId)) continue;
    const status = await client.batches.retrieve(p.batchId);
    console.log(
      "poll",
      p.endpoint,
      p.model,
      status.status,
      JSON.stringify(status.request_counts),
    );
    if (
      !["completed", "failed", "expired", "cancelled"].includes(status.status)
    ) {
      continue;
    }
    remaining.delete(p.batchId);
    console.log(
      "errors field",
      p.endpoint,
      p.model,
      JSON.stringify(status.errors),
    );
    for (const key of [status.output_file_id, status.error_file_id]) {
      if (!key) continue;
      const text = await (await client.files.content(key)).text();
      console.log(
        `FILE ${key} (${
          key === status.output_file_id ? "output" : "error"
        }) endpoint=${p.endpoint} model=${p.model}`,
      );
      console.log(text);
    }
  }
}

for (const p of pending) {
  await client.files.delete(p.fileId);
}
console.log("done", pending.map((p) => `${p.endpoint}:${p.model}`).join(", "));
