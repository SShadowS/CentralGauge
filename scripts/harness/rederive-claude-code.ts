// Re-derive a Claude Code cell's parse, cost and trace from its stored records
// without a new run (M1-32b: M1-29's raw.jsonl was refused before the
// same-session resume fix). Never overwrites: both outputs are created new.
// The pricing book is not stored with an execution, only its instant
// (sandbox.json pricing_book_at), so it is rebuilt from site/catalog at that
// instant, as the run did (harness-env.ts). Usage, from the repo root:
//   deno run --allow-all scripts/harness/rederive-claude-code.ts <records-dir> <label>
// reads <records-dir>/{execution.json,sandbox.json,raw.jsonl}, writes
// <records-dir>/derived-<label>.json and derived-<label>.trace.jsonl.
import { fromFileUrl, join } from "@std/path";
import { parseClaudeStream } from "../../src/harness/adapters/claude-code.ts";
import { loadPricingBook } from "../../src/harness/pricing.ts";
import { ExecutionRecordSchema } from "../../src/harness/records.ts";
import { writeTrace } from "../../src/harness/trace.ts";

const [dir, label] = Deno.args;
if (!dir || !label) {
  console.error(
    "usage: rederive-claude-code.ts <records-dir> <label> (e.g. M1-32b)",
  );
  Deno.exit(2);
}
const read = async (name: string) => {
  const path = join(dir, name);
  try {
    return await Deno.readTextFile(path);
  } catch (err) {
    throw new Error(`${path}: ${(err as Error).message}`);
  }
};
const execFile = join(dir, "execution.json");
const parsed = ExecutionRecordSchema.safeParse(
  JSON.parse(await read("execution.json")),
);
if (!parsed.success) {
  throw new Error(`${execFile}: ${parsed.error.message}`);
}
const exec = parsed.data;
if (exec.manifest.harness !== "claude-code") {
  throw new Error(`${execFile}: harness ${exec.manifest.harness}`);
}
const sandbox = JSON.parse(await read("sandbox.json"));
const at = typeof sandbox.pricing_book_at === "string"
  ? sandbox.pricing_book_at
  : exec.started_at;
const book = await loadPricingBook(
  fromFileUrl(new URL("../../site/catalog", import.meta.url)),
  new Date(at),
);
const raw = await read("raw.jsonl");
const { trace, ...run } = parseClaudeStream(raw, {
  rawLog: join(dir, "raw.jsonl"),
  exitCode: exec.telemetry.exit_code,
  pricing: book,
  manifest: exec.manifest,
});
const sha256 = async (s: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
  ].map((b) => b.toString(16).padStart(2, "0")).join("");
const traceName = `derived-${label}.trace.jsonl`;
const out = {
  derived_from: {
    execution_id: exec.id,
    raw_log: "raw.jsonl",
    raw_log_sha256: await sha256(raw),
    original_termination: exec.termination,
    original_cost_usd: exec.telemetry.cost_usd,
  },
  derived_by: {
    task: label,
    script: "scripts/harness/rederive-claude-code.ts",
    adapter: "src/harness/adapters/claude-code.ts parseClaudeStream",
    pricing_book_at: at,
    pricing_book_source: typeof sandbox.pricing_book_at === "string"
      ? "site/catalog at sandbox.json pricing_book_at"
      : "site/catalog at execution started_at",
    at: new Date().toISOString(),
  },
  termination: run.termination,
  did_work: run.didWork,
  telemetry: run.telemetry,
  observed: run.observed,
  unobservable: run.unobservable,
  trace_events: run.traceEvents,
  trace_path: traceName,
};
const outFile = join(dir, `derived-${label}.json`);
await Deno.writeTextFile(outFile, JSON.stringify(out, null, 2) + "\n", {
  createNew: true,
});
// writeTrace overwrites, so claim the name first.
await Deno.writeTextFile(join(dir, traceName), "", { createNew: true });
await writeTrace(join(dir, traceName), trace);
console.log(JSON.stringify({
  out: outFile,
  termination: run.termination,
  cost_usd: run.telemetry.cost_usd,
  reported_cost_usd: run.telemetry.reported_cost_usd,
  turns: run.telemetry.turns,
  wall_ms: run.telemetry.wall_ms,
  trace_events: run.traceEvents,
  pricing_snapshot: run.telemetry.pricing_snapshot,
}));
