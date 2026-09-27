// Budget guard and sole key holder for pi 0.87.1 (adapter contract
// enforcesBudget; pi has no budget flag). Loaded by run.ps1 with
// `-e C:\cg-budget.ts`. The provider credential is released here, so a
// guard that fails to load leaves pi without one: the OpenRouter key is
// registered (CG_PI_PROVIDER openrouter, the default), or the openai-codex
// OAuth entry is written into the agent auth.json (H-02). Records go through
// pi.appendEntry (JSON-mode entry_appended); stdout belongs to pi. A trip
// aborts the current operation and blocks every later tool call. Overshoot
// is bounded by the request that crossed the limit.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

interface Msg {
  role?: unknown;
  usage?: {
    input?: unknown;
    output?: unknown;
    cacheRead?: unknown;
    cacheWrite?: unknown;
    cost?: { total?: unknown };
  };
}
interface Ctx {
  abort(): void;
}
interface Api {
  registerProvider(name: string, config: { apiKey: string }): void;
  appendEntry(customType: string, data: unknown): void;
  on(event: "agent_start", h: () => void): void;
  on(event: "message_end", h: (e: { message: Msg }, ctx: Ctx) => void): void;
  on(
    event: "tool_call",
    h: () => { block: true; reason: string } | undefined,
  ): void;
}

/** A token count: absent is 0; present but not a finite non-negative number is malformed (NaN). */
const count = (v: unknown) =>
  v === undefined
    ? 0
    : typeof v === "number" && Number.isFinite(v) && v >= 0
    ? v
    : Number.NaN;

export function budgetStep(
  spent: number,
  message: unknown,
): { spent: number; unpriced: boolean } {
  const m = (message ?? {}) as Msg;
  if (m.role !== "assistant") return { spent, unpriced: false };
  // Fail closed: an assistant message without usage, or with a malformed count, is unpriced.
  if (m.usage === null || typeof m.usage !== "object") {
    return { spent, unpriced: true };
  }
  const u = m.usage;
  const counts = [u.input, u.output, u.cacheRead, u.cacheWrite].map(count);
  if (counts.some(Number.isNaN)) return { spent, unpriced: true };
  const billable = counts.some((n) => n > 0);
  const total = u.cost?.total;
  if (typeof total !== "number" || !Number.isFinite(total) || total < 0) {
    return { spent, unpriced: billable || total !== undefined };
  }
  if (billable && total === 0) return { spent, unpriced: true };
  return { spent: spent + total, unpriced: false };
}

/** pi refreshes an OAuth token with less than 5 minutes left (pi-ai auth/resolve.js:62-92); never inside the sandbox. */
const CODEX_REFRESH_WINDOW_MS = 5 * 60_000;
const CODEX_FIELDS = '["access","accountId","expires","refresh","type"]';
/** As src/harness/codex-auth.ts: printable, no space, quote or backslash, at least 16 characters. */
const CODEX_INNER = /^[\x21\x23-\x5b\x5d-\x7e]{16,}$/;

/**
 * H-02: the ChatGPT-subscription OAuth entry goes into the agent directory's
 * auth.json; run.ps1 never reads it. pi 0.87.1 reads that file lazily,
 * after extensions load (pi-coding-agent dist): the model runtime and its
 * AuthStorage come first (core/agent-session-services.js:56-61; the store
 * writes an empty "{}" through ensureFileExists, core/auth-storage.js:28-31
 * and 57-59), then extensions load (agent-session-services.js:69;
 * extensions/loader.js:449 awaits this factory), then provider availability
 * is refreshed (agent-session-services.js:98), and every credential read
 * re-reads the file once its stat revision changed (auth-storage.js:330-338;
 * utils/paths.js:21-29).
 *
 * H-02 review: the refresh token is withheld (the host releases refresh "").
 * pi uses only the access token while it is valid: the refresh path runs
 * only inside the 5-minute window (pi-ai auth/resolve.js:62-99), the auth
 * is derived from `access` alone (auth/oauth/openai-codex.js:445-448), the
 * availability check needs only an oauth entry (models.js:223-226), and
 * auth.json validation needs `refresh` to be a string (auth-storage.js:195-199).
 * So the token must outlive this run (CG_TIMEOUT_MIN) plus that window.
 * Returns the write, which the factory runs last. Errors never echo a value.
 */
function prepareCodexAuth(): () => void {
  const dir = process.env["PI_CODING_AGENT_DIR"];
  if (!dir) throw new Error("PI_CODING_AGENT_DIR is not set");
  const timeoutMin = Number(process.env["CG_TIMEOUT_MIN"]);
  if (!(Number.isFinite(timeoutMin) && timeoutMin > 0)) {
    throw new Error("CG_TIMEOUT_MIN must be a positive number");
  }
  const bad = (why: string): never => {
    throw new Error(`openai-codex credential file: ${why}`);
  };
  let text = "";
  try {
    text = readFileSync(
      process.env["CG_PI_AUTH_FILE"] ?? "C:\\cg-secrets\\openai-codex-auth",
      "utf8",
    );
  } catch {
    bad("unreadable");
  }
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    bad("not JSON");
  }
  const keys = v !== null && typeof v === "object" && !Array.isArray(v)
    ? Object.keys(v)
    : [];
  if (keys.length !== 1 || keys[0] !== "openai-codex") {
    bad("must hold exactly one entry, openai-codex");
  }
  const e = (v as Record<string, Record<string, unknown>>)["openai-codex"];
  if (
    e === null || typeof e !== "object" || Array.isArray(e) ||
    JSON.stringify(Object.keys(e).sort()) !== CODEX_FIELDS ||
    e["type"] !== "oauth" ||
    !["access", "accountId"].every((k) =>
      typeof e[k] === "string" && CODEX_INNER.test(e[k] as string)
    ) || !Number.isSafeInteger(e["expires"])
  ) {
    bad("not an oauth entry of exactly access, refresh, expires, accountId");
  }
  if (e!["refresh"] !== "") {
    bad('the refresh token is not withheld (the host releases refresh "")');
  }
  const need = Date.now() + timeoutMin * 60_000 + CODEX_REFRESH_WINDOW_MS;
  if ((e!["expires"] as number) < need) {
    bad(
      "the access token does not outlive the run timeout plus 5 minutes; pi would try to refresh it inside the sandbox (refresh it on the host)",
    );
  }
  const path = join(dir, "auth.json");
  return () => {
    // Only pi's own empty placeholder may be replaced: never merge into another credential.
    if (
      existsSync(path) &&
      !/^\s*(\{\s*\})?\s*$/.test(readFileSync(path, "utf8"))
    ) {
      bad("the agent auth.json already holds a credential");
    }
    writeFileSync(path, JSON.stringify({ "openai-codex": e }, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
  };
}

export default function (pi: Api): void {
  const limit = Number(process.env["CG_MAX_BUDGET_USD"]);
  if (!(Number.isFinite(limit) && limit > 0)) {
    throw new Error("CG_MAX_BUDGET_USD must be a positive number");
  }
  const provider = process.env["CG_PI_PROVIDER"] ?? "openrouter";
  let releaseCodex: (() => void) | null = null;
  if (provider === "openai-codex") releaseCodex = prepareCodexAuth();
  else if (provider === "openrouter") {
    const key = readFileSync(
      process.env["CG_PI_KEY_FILE"] ?? "C:\\cg-secrets\\openrouter-api-key",
      "utf8",
    ).trim();
    // pi interpolates $NAME anywhere in the value and runs a leading !command: only a plain literal is safe.
    if (
      key.length < 16 || key.includes("$") || key.startsWith("!") ||
      /\s/.test(key)
    ) {
      throw new Error("provider key file is not a usable literal key");
    }
    pi.registerProvider("openrouter", { apiKey: key });
  } else {
    throw new Error(
      "CG_PI_PROVIDER names a provider this guard does not hold",
    );
  }
  let armed = false;
  let tripped = false;
  let spent = 0;
  pi.on("agent_start", () => {
    if (armed) return;
    // Armed only once recorded: a failed write retries on the next agent_start.
    pi.appendEntry("cg-budget", { event: "armed", limit_usd: limit });
    armed = true;
  });
  pi.on(
    "tool_call",
    () => tripped ? { block: true, reason: "budget exhausted" } : undefined,
  );
  pi.on("message_end", (e, ctx) => {
    if (tripped) return;
    const s = budgetStep(spent, e.message);
    spent = s.spent;
    if (s.unpriced || spent >= limit) {
      tripped = true;
      try {
        pi.appendEntry("cg-budget", {
          event: "exhausted",
          spent_usd: spent,
          limit_usd: limit,
          reason: s.unpriced ? "unpriced" : "limit",
        });
      } finally {
        // The stop never depends on the record succeeding.
        ctx.abort();
      }
    }
  });
  // H-02 review: last, once every handler is registered; a factory that
  // throws earlier leaves pi without the credential (pi discards the extension).
  releaseCodex?.();
}
