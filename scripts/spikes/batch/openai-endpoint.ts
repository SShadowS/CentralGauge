/**
 * Spike 2 (spec section 11): which endpoint GPT-6 Astra accepts in the Batch
 * API. Uploads one JSONL per (model, endpoint) pair and prints the raw output
 * and error lines.
 *
 * NOTE: the OpenAI Batch API rejects a JSONL file whose lines target more
 * than one model ("mismatched_model" — "Each batch must contain requests for
 * a single model."). That is a structural constraint of the real API, not a
 * request choice this spike is testing, so each (model, endpoint) pair gets
 * its own file and its own batch below.
 *
 *   deno run --allow-all scripts/spikes/batch/openai-endpoint.ts
 */
import { EnvLoader } from "../../../src/utils/env-loader.ts";
await EnvLoader.loadEnvironment();

import OpenAI from "@openai/openai";

const client = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY") });
const MODELS = ["gpt-5-mini", "gpt-6-astra"];
const ENDPOINTS = ["/v1/chat/completions", "/v1/responses"] as const;

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

for (const endpoint of ENDPOINTS) {
  for (const model of MODELS) {
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
      metadata: { nonce, runId: "spike", model },
    });
    console.log("created", endpoint, model, batch.id, batch.status);
    let status = batch;
    while (
      !["completed", "failed", "expired", "cancelled"].includes(status.status)
    ) {
      await new Promise((r) => setTimeout(r, 10_000));
      status = await client.batches.retrieve(batch.id);
      console.log(
        "poll",
        endpoint,
        model,
        status.status,
        JSON.stringify(status.request_counts),
      );
    }
    console.log("errors field", endpoint, model, JSON.stringify(status.errors));
    for (const key of [status.output_file_id, status.error_file_id]) {
      if (!key) continue;
      const text = await (await client.files.content(key)).text();
      console.log(
        `FILE ${key} (${
          key === status.output_file_id ? "output" : "error"
        }) endpoint=${endpoint} model=${model}`,
      );
      console.log(text);
    }
    const listed = await client.batches.list({ limit: 3 });
    console.log("listed nonce", listed.data.map((b) => b.metadata?.["nonce"]));
    await client.files.delete(file.id);
  }
}
