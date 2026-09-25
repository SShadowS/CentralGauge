// Budget guard and sole key holder for pi 0.87.1 (adapter contract
// enforcesBudget; pi has no budget flag). Loaded by run.ps1 with
// `-e C:\cg-budget.ts`. The OpenRouter key is registered here, so a guard
// that fails to load leaves pi without a credential. Records go through
// pi.appendEntry (JSON-mode entry_appended); stdout belongs to pi. A trip
// aborts the current operation and blocks every later tool call. Overshoot
// is bounded by the request that crossed the limit.
import { readFileSync } from "node:fs";
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

export default function (pi: Api): void {
  const limit = Number(process.env["CG_MAX_BUDGET_USD"]);
  if (!(Number.isFinite(limit) && limit > 0)) {
    throw new Error("CG_MAX_BUDGET_USD must be a positive number");
  }
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
}
