// SPIKE (throwaway): harness bench M0
// Usage: deno run --allow-all scripts/spikes/harness/classify-rules.ts <file.jsonl>... > calls.jsonl
// Call extraction follows the M0-04 findings: Claude Code calls are assistant
// `tool_use` items; pi calls are counted from `tool_execution_start` only
// (message_end, turn_end and agent_end repeat the same call).
export type Category =
  | "compile"
  | "test"
  | "publish"
  | "symbols"
  | "read"
  | "search"
  | "edit"
  | "vcs"
  | "other";

const BUILTIN: Record<string, Category> = {
  Read: "read",
  Glob: "search",
  Grep: "search",
  Edit: "edit",
  Write: "edit",
  MultiEdit: "edit",
  read: "read",
  grep: "search",
  find: "search",
  ls: "search",
  edit: "edit",
  write: "edit",
};
const SHELL_RULES: [RegExp, Category][] = [
  [/^\s*cg-al\s+compile\b/i, "compile"],
  [/^\s*cg-al\s+test\b/i, "test"],
  [/^\s*cg-al\s+symbols\b/i, "symbols"],
  [/^\s*cg-al\s+publish\b/i, "publish"],
  [/^\s*(al|altool)(\.exe)?\s+compile\b/i, "compile"],
  [/\balc(\.exe)?\s/i, "compile"],
  [/^\s*git\s/i, "vcs"],
  [/^\s*(cat|type|Get-Content|head|tail)\b/i, "read"],
  [/^\s*(ls|dir|Get-ChildItem|find|rg|grep|Select-String)\b/i, "search"],
];
const MCP_RULES: [RegExp, Category][] = [
  [/compile/i, "compile"],
  [/test/i, "test"],
  [/publish/i, "publish"],
  [/symbol/i, "symbols"],
];

export function classify(tool: string, command?: string): Category | null {
  if (tool.startsWith("mcp__")) {
    // Match the tool part only: the server name must not decide the category.
    const name = tool.split("__").pop() ?? "";
    for (const [re, c] of MCP_RULES) if (re.test(name)) return c;
    return null;
  }
  if (
    (tool === "Bash" || tool === "bash" || tool === "PowerShell") && command
  ) {
    for (const [re, c] of SHELL_RULES) if (re.test(command)) return c;
    return null;
  }
  return BUILTIN[tool] ?? null;
}

export interface Call {
  tool: string;
  command: string | undefined;
  input: Record<string, unknown>;
}

/** Tool calls in one log line, or [] for lines that carry none (or repeat one). */
export function extractCalls(rec: Record<string, unknown>): Call[] {
  if (rec["type"] === "tool_execution_start") {
    const input = (rec["args"] ?? {}) as Record<string, unknown>;
    return [{ tool: String(rec["toolName"]), command: cmd(input), input }];
  }
  if (rec["type"] !== "assistant") return [];
  const msg = rec["message"] as
    | { content?: Record<string, unknown>[] }
    | undefined;
  return (msg?.content ?? [])
    .filter((c) => c["type"] === "tool_use")
    .map((c) => {
      const input = (c["input"] ?? {}) as Record<string, unknown>;
      return { tool: String(c["name"]), command: cmd(input), input };
    });
}

function cmd(input: Record<string, unknown>): string | undefined {
  return typeof input["command"] === "string" ? input["command"] : undefined;
}

function selfCheck() {
  const cases: [string, string | undefined, Category | null][] = [
    ["Bash", "cg-al compile Core", "compile"],
    ["Bash", "al compile /project:C:\\workspace\\Core", "compile"],
    ["Bash", "git status", "vcs"],
    ["Read", undefined, "read"],
    ["mcp__al-tools__al_compile", undefined, "compile"],
    ["mcp__test-server__read_file", undefined, null],
    ["Bash", "cg-al publish Core", "publish"],
    ["Bash", "python make_stuff.py", null],
    ["bash", "ls -la", "search"],
    ["write", undefined, "edit"],
  ];
  for (const [t, c, want] of cases) {
    const got = classify(t, c);
    if (got !== want) {
      throw new Error(`classify(${t}, ${c}) = ${got}, want ${want}`);
    }
  }
  const pi = extractCalls({
    type: "tool_execution_start",
    toolName: "bash",
    args: { command: "git log" },
  });
  if (pi.length !== 1 || pi[0]?.command !== "git log") {
    throw new Error("pi extraction");
  }
  const repeat = extractCalls({
    type: "message_end",
    message: { content: [{ type: "toolCall", name: "bash" }] },
  });
  if (repeat.length !== 0) throw new Error("pi message_end must not count");
  const cc = extractCalls({
    type: "assistant",
    message: {
      content: [{ type: "text" }, {
        type: "tool_use",
        name: "Read",
        input: {},
      }],
    },
  });
  if (cc.length !== 1 || cc[0]?.tool !== "Read") {
    throw new Error("claude extraction");
  }
}

if (import.meta.main) {
  selfCheck();
  let total = 0, ruled = 0;
  for (const file of Deno.args) {
    for (const line of (await Deno.readTextFile(file)).split("\n")) {
      if (!line.trim()) continue;
      let rec: Record<string, unknown>;
      try {
        rec = JSON.parse(line.replace(/\r$/, ""));
      } catch {
        continue;
      }
      for (const { tool, command, input } of extractCalls(rec)) {
        const category = classify(tool, command);
        total++;
        if (category) ruled++;
        console.log(JSON.stringify({ file, tool, command, input, category }));
      }
    }
  }
  console.error(`[rules] ${ruled}/${total} classified by rule`);
}
