import { mergeConfigSources } from "../../../ingest/config.ts";
import type { Check, DoctorContext } from "../../types.ts";

// Matches the worker's verifySignedRequest SKEW_LIMIT_MS in
// site/src/lib/server/signature.ts (10 minutes). Using a stricter local
// tolerance would false-fail when the server is more lenient.
const TOLERANCE_MS = 10 * 60 * 1000;

async function readUrl(ctx: DoctorContext): Promise<string | null> {
  const src = await mergeConfigSources(ctx.cwd, {});
  return src.url ?? null;
}

export const checkClockSkew: Check = {
  id: "clock.skew",
  level: "A",
  async run(ctx: DoctorContext) {
    const url = await readUrl(ctx);
    if (!url) {
      return {
        id: "clock.skew",
        level: "A" as const,
        status: "warning" as const,
        message: "no ingest.url configured; skew unknowable",
        durationMs: 0,
      };
    }
    try {
      const resp = await ctx.fetchFn(`${url}/health`, { method: "HEAD" });
      const dateHeader = resp.headers.get("Date");
      if (!dateHeader) {
        return {
          id: "clock.skew",
          level: "A" as const,
          status: "warning" as const,
          message: "server did not return a Date header",
          durationMs: 0,
        };
      }
      const serverMs = new Date(dateHeader).getTime();
      const skew = Math.abs(Date.now() - serverMs);
      if (skew < TOLERANCE_MS) {
        return {
          id: "clock.skew",
          level: "A" as const,
          status: "passed" as const,
          message: `${(skew / 1000).toFixed(1)}s`,
          durationMs: 0,
        };
      }
      return {
        id: "clock.skew",
        level: "A" as const,
        status: "failed" as const,
        message: `skew ${(skew / 1000).toFixed(1)}s exceeds ${
          TOLERANCE_MS / 1000
        }s tolerance`,
        remediation: {
          summary: "Sync system clock",
          autoRepairable: false,
        },
        details: { skew_ms: skew, tolerance_ms: TOLERANCE_MS },
        durationMs: 0,
      };
    } catch (e) {
      return {
        id: "clock.skew",
        level: "A" as const,
        status: "warning" as const,
        message: `skew probe failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
        durationMs: 0,
      };
    }
  },
};
