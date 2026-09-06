/**
 * Spike 1 (spec section 11): what a Message Batches result looks like for a
 * normal answer, a max_tokens stop, an invalid request, and (if the operator
 * supplies one) a prompt the API refuses. Prints every result envelope raw.
 *
 *   deno run --allow-all scripts/spikes/batch/anthropic-refusal.ts [prompt-file]
 */
import { EnvLoader } from "../../../src/utils/env-loader.ts";
await EnvLoader.loadEnvironment();

import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5-20251001";
const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

const refusalPrompt = Deno.args[0]
  ? await Deno.readTextFile(Deno.args[0])
  : "Reply with the single word OK.";

const batch = await client.messages.batches.create({
  requests: [
    {
      custom_id: "b-ok",
      params: {
        model: MODEL,
        max_tokens: 256,
        messages: [{ role: "user", content: "Reply with the single word OK." }],
      },
    },
    {
      custom_id: "b-max-tokens",
      params: {
        model: MODEL,
        max_tokens: 5,
        messages: [{
          role: "user",
          content: "Count from one to fifty in words.",
        }],
      },
    },
    {
      custom_id: "b-invalid",
      params: {
        model: "claude-model-that-does-not-exist",
        max_tokens: 16,
        messages: [{ role: "user", content: "hi" }],
      },
    },
    {
      custom_id: "b-refusal-candidate",
      params: {
        model: MODEL,
        max_tokens: 256,
        messages: [{ role: "user", content: refusalPrompt }],
      },
    },
  ],
});
console.log("created", batch.id, batch.processing_status, batch.request_counts);

let status = batch;
while (status.processing_status !== "ended") {
  await new Promise((r) => setTimeout(r, 5_000));
  status = await client.messages.batches.retrieve(batch.id);
  console.log(
    "poll",
    status.processing_status,
    JSON.stringify(status.request_counts),
  );
}

const listed = await client.messages.batches.list({ limit: 5 });
console.log("list entry fields", Object.keys(listed.data[0] ?? {}));

for await (const result of await client.messages.batches.results(batch.id)) {
  console.log("RESULT", result.custom_id, JSON.stringify(result.result));
}
