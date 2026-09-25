// SPIKE (throwaway): harness bench M0
// Usage: deno run --allow-all scripts/spikes/harness/summarize-log.ts <claude|pi> <file.jsonl>
const [harness, file] = Deno.args;
if (!harness || !file) throw new Error("usage: see header");
const types = new Map<string, number>();
const toolNames = new Map<string, number>();
const usageKeys = new Set<string>();
let toolErrors = 0;
let bad = 0;

function walkUsage(u: unknown, prefix = "") {
  if (!u || typeof u !== "object") return;
  for (const [k, v] of Object.entries(u)) {
    usageKeys.add(prefix + k);
    if (v && typeof v === "object") walkUsage(v, prefix + k + ".");
  }
}

function countTool(name: unknown) {
  const n = String(name ?? "?");
  toolNames.set(n, (toolNames.get(n) ?? 0) + 1);
}

for (const line of (await Deno.readTextFile(file)).split("\n")) {
  if (!line.trim()) continue;
  let rec: Record<string, unknown>;
  try {
    rec = JSON.parse(line.replace(/\r$/, ""));
  } catch {
    bad++;
    continue;
  }
  const t = String(rec["type"] ?? "?");
  types.set(t, (types.get(t) ?? 0) + 1);
  const msg = rec["message"] as Record<string, unknown> | undefined;
  if (msg?.["usage"]) walkUsage(msg["usage"], "message.usage.");
  if (rec["usage"]) walkUsage(rec["usage"], "usage.");
  // pi repeats every message in message_update/turn_end/agent_end records, so
  // pi tool calls are counted from tool_execution_start only (one per call).
  if (harness === "claude") {
    const content = Array.isArray(msg?.["content"])
      ? msg["content"] as Record<string, unknown>[]
      : [];
    for (const c of content) {
      if (c["type"] === "tool_use") countTool(c["name"]);
      if (c["type"] === "tool_result" && c["is_error"] === true) toolErrors++;
    }
  } else {
    if (t === "tool_execution_start") countTool(rec["toolName"]);
    if (t === "tool_execution_end" && rec["isError"] === true) toolErrors++;
  }
}
console.log(JSON.stringify(
  {
    harness,
    file,
    badLines: bad,
    recordTypes: Object.fromEntries(types),
    toolCalls: Object.fromEntries(toolNames),
    toolErrors,
    usageKeys: [...usageKeys].sort(),
  },
  null,
  2,
));
