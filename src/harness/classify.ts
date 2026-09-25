/**
 * Deterministic, versioned call categorization (spec 1a section 5, D14).
 * Rules only (Laya cut). No rule, no category: `unclassified`. Skill use is a
 * trace event type (skill_invoke), never a category (accept-M0-07).
 * Changing any rule bumps RULES_VERSION.
 */

export const CATEGORIES = [
  "compile",
  "test",
  "publish",
  "symbols",
  "read",
  "search",
  "edit",
  "vcs",
  "other",
  "unclassified",
] as const;
export type Category = (typeof CATEGORIES)[number];
export const RULES_VERSION = 1;

export interface CallInput {
  tool: string;
  command: string | null;
  target: string | null;
}
export interface Classification {
  category: Category;
  classifier: string;
}

const at = (rule: string, category: Category): Classification => ({
  category,
  classifier: `${rule}@${RULES_VERSION}`,
});
const NONE = () => at("none", "unclassified");

const BUILTIN: Record<string, Category> = {
  Read: "read",
  Glob: "search",
  Grep: "search",
  Edit: "edit",
  Write: "edit",
  MultiEdit: "edit",
  NotebookEdit: "edit",
  Skill: "other",
  Agent: "other",
  Task: "other",
  ToolSearch: "other",
  read: "read",
  grep: "search",
  find: "search",
  ls: "search",
  edit: "edit",
  write: "edit",
};
const SHELLS = new Set(["Bash", "bash", "PowerShell"]);

/** Exact tool parts for known servers (al-tools: M3-03's tool list). An unknown tool of a known server is unclassified. */
const MCP_EXACT: Record<string, Record<string, Category>> = {
  "al-tools": { al_compile: "compile", al_test: "test", al_symbols: "symbols" },
};
/** Whole-token matches for unknown servers (`attest` is not `test`). */
const MCP_TOKENS: [string, Category][] = [
  ["compile", "compile"],
  ["build", "compile"],
  ["test", "test"],
  ["tests", "test"],
  ["publish", "publish"],
  ["deploy", "publish"],
  ["symbol", "symbols"],
  ["symbols", "symbols"],
];

/** Words that may precede the action token of an unknown MCP tool (`run-tests`). */
const RUN_VERBS = new Set(["run", "do", "exec", "execute", "start", "trigger"]);

function classifyMcp(tool: string): Classification {
  const rest = tool.slice("mcp__".length);
  const cut = rest.indexOf("__");
  if (cut <= 0) return NONE();
  const server = rest.slice(0, cut);
  const name = rest.slice(cut + 2);
  if (Object.hasOwn(MCP_EXACT, server)) {
    const table = MCP_EXACT[server]!;
    return Object.hasOwn(table, name)
      ? at(`mcp-exact.${server}.${name}`, table[name]!)
      : NONE();
  }
  const tokens = name.toLowerCase().split(/[_\-.]+/);
  for (const [tok, cat] of MCP_TOKENS) {
    const i = tokens.indexOf(tok);
    // `get_build_logs`, `list_tests`: the action word is an object, not the verb.
    if (i >= 0 && tokens.slice(0, i).every((t) => RUN_VERBS.has(t))) {
      return at(`mcp-token.${tok}`, cat);
    }
  }
  return NONE();
}

const NEUTRAL = new Set([
  "cd",
  "set-location",
  "sl",
  "pushd",
  "popd",
  "echo",
  "write-output",
  "write-host",
  "true",
  "exit",
]);
/** Only shape the output of the segment before the pipe. */
const FILTERS = new Set([
  "head",
  "tail",
  "grep",
  "egrep",
  "select-string",
  "sls",
  "findstr",
  "sort",
  "sort-object",
  "uniq",
  "wc",
  "measure-object",
  "measure",
  "select-object",
  "select",
  "where-object",
  "where",
  "out-string",
  "format-table",
  "ft",
  "format-list",
  "fl",
  "cut",
]);
const READ = new Set(["cat", "type", "get-content", "gc", "more", "less"]);
const SEARCH = new Set([
  "ls",
  "dir",
  "get-childitem",
  "gci",
  "find",
  "rg",
  "grep",
  "select-string",
  "findstr",
  "tree",
  "test-path",
]);
const EDIT = new Set([
  "set-content",
  "add-content",
  "out-file",
  "new-item",
  "ni",
  "remove-item",
  "rm",
  "del",
  "move-item",
  "mv",
  "copy-item",
  "cp",
  "rename-item",
  "mkdir",
  "md",
  "touch",
]);
const ENV = new Set(["set", "env", "printenv"]);
const STRENGTH: Category[] = [
  "compile",
  "test",
  "publish",
  "symbols",
  "edit",
  "vcs",
  "read",
  "search",
  "other",
];
/**
 * A redirect of stdout (`>`, `>>`, `1>`, `&>`, `*>`) to a real file, on text
 * whose quoted parts are replaced by `_` (a quoted target still counts, a `>`
 * inside quotes does not). `2>` and other stream numbers, `N>&M`, and targets
 * `$null`, `/dev/null`, `nul` are not edits.
 */
const REDIRECT =
  /(^|[^0-9>]|(?<![0-9])1)>>?\s*(?!&|\$null\b|\/dev\/null\b|nul\b)[^\s&|]/i;
const unquoted = (s: string) => s.replace(/"[^"]*"|'[^']*'/g, "_");
/** A lone `&` (background or cmd separator), not `&&`, `>&`, `&>` or a leading call operator. */
const BARE_AMP = /(?<![>&])&(?![>&])/;
/** Text the rules cannot see through: substitutions and escaped quotes. */
const OPAQUE = /\$\(|`|\\"/;

/** Split on ; && || | and newlines outside quotes; a segment after | is piped. */
function segments(cmd: string): { text: string; piped: boolean }[] {
  const out: { text: string; piped: boolean }[] = [];
  let cur = "";
  let piped = false;
  let q: string | null = null;
  const cut = (next: boolean) => {
    out.push({ text: cur, piped });
    cur = "";
    piped = next;
  };
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]!;
    if (q !== null) {
      cur += ch;
      if (ch === q) q = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      q = ch;
      cur += ch;
      continue;
    }
    const two = cmd.slice(i, i + 2);
    if (two === "&&" || two === "||") {
      cut(false);
      i++;
    } else if (ch === ";" || ch === "\n") cut(false);
    else if (ch === "|") cut(true);
    else cur += ch;
  }
  cut(false);
  return out.map((s) => ({
    ...s,
    text: s.text.trim().replace(/^[$@]?\(+/, ""),
  })).filter((s) => s.text !== "");
}

const words = (s: string) =>
  [...s.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) =>
    m[1] ?? m[2] ?? m[3]!
  );
const commandWord = (w: string) =>
  (w.replace(/^&/, "").replace(/\).*$/, "").split(/[\\/]/).pop() ?? "")
    .toLowerCase().replace(/\.(exe|cmd|ps1|bat|dll)$/, "");

function classifyShell(cmd: string, depth = 0): Classification {
  if (OPAQUE.test(cmd)) return NONE();
  const picked: Classification[] = [];
  for (const seg of segments(cmd)) {
    const r = classifySegment(seg.text, seg.piped, depth);
    if (r === "neutral") continue;
    if (r === null) return NONE();
    picked.push(r);
  }
  if (picked.length === 0) return NONE();
  return picked.sort((a, b) =>
    STRENGTH.indexOf(a.category) - STRENGTH.indexOf(b.category)
  )[0]!;
}

function base(ws: string[], piped: boolean): Classification | "neutral" | null {
  const w0 = commandWord(ws[0]!);
  if (piped && FILTERS.has(w0)) return "neutral";
  if (NEUTRAL.has(w0)) return "neutral";
  if (w0 === "cg-al") {
    const op = (ws[1] ?? "").replace(/\).*$/, "").toLowerCase();
    return ["compile", "test", "symbols"].includes(op)
      ? at(`shell.cg-al.${op}`, op as Category)
      : at("shell.cg-al.meta", "other");
  }
  if (w0 === "al" || w0 === "altool") {
    return (ws[1] ?? "").replace(/\).*$/, "").toLowerCase() === "compile"
      ? at("shell.toolchain.al", "compile")
      : null;
  }
  if (w0 === "alc") return at("shell.toolchain.alc", "compile");
  if (w0 === "git") return at("shell.git", "vcs");
  if (READ.has(w0)) return at("shell.read", "read");
  if (
    w0 === "find" &&
    ws.some((w) => /^-(delete|exec|execdir|ok|okdir)$/i.test(w))
  ) return null;
  if (SEARCH.has(w0)) return at("shell.search", "search");
  if (EDIT.has(w0)) return at("shell.edit", "edit");
  if (ENV.has(w0)) return ws.length === 1 ? at("shell.env", "other") : null;
  return null;
}

function classifySegment(
  text: string,
  piped: boolean,
  depth: number,
): Classification | "neutral" | null {
  if (BARE_AMP.test(unquoted(text).replace(/^\s*&/, ""))) return null;
  let ws = words(text);
  if (ws[0] === "&") ws = ws.slice(1);
  if (ws.length === 0) return "neutral";
  const w0 = commandWord(ws[0]!);
  if (depth < 3 && ["powershell", "pwsh", "cmd", "bash", "sh"].includes(w0)) {
    const i = ws.findIndex((w, k) =>
      k > 0 && /^([-/](c|command|file))$/i.test(w)
    );
    return i < 0 ? null : classifyShell(ws.slice(i + 1).join(" "), depth + 1);
  }
  if (w0 === "dotnet" && ws[1] && /\.dll$/i.test(ws[1])) ws = ws.slice(1);
  const b = base(ws, piped);
  // A redirect makes a known segment an edit; an unknown command stays unknown.
  if (b !== null && REDIRECT.test(unquoted(text))) {
    return at("shell.redirect", "edit");
  }
  return b;
}

export function classify(c: CallInput): Classification {
  if (c.tool.startsWith("mcp__")) return classifyMcp(c.tool);
  if (SHELLS.has(c.tool)) return c.command ? classifyShell(c.command) : NONE();
  return Object.hasOwn(BUILTIN, c.tool)
    ? at(`builtin.${c.tool}`, BUILTIN[c.tool]!)
    : NONE();
}
