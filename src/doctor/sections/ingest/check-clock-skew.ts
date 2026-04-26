import { parse } from "jsr:@std/yaml@^1.1.0";
import type { Check, DoctorContext } from "../../types.ts";

// Matches the worker's verifySignedRequest SKEW_LIMIT_MS in
// site/src/lib/server/signature.ts (10 minutes). Using a stricter local
// tolerance would false-fail when the server is more lenient.
const TOLERANCE_MS = 10 * 60 * 1000;

function homeDir(): string {
  const override = Deno.env.get("CENTRALGAUGE_TEST_HOME");
  if (override) return override;
  return Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME") ?? ".";
}

async function readUrl(ctx: DoctorContext): Promise<string | null> {
  for (
    const path of [
      `${ctx.cwd}/.centralgauge.yml`,
      `${homeDir()}/.centralgauge.yml`,
    ]
  ) {
    try {
      const cfg = parse(await Deno.readTextFile(path)) as Record<
        string,
        unknown
      >;
      const url = (cfg?.["ingest"] as Record<string, unknown> | undefined)?.[
        "url"
      ];
      if (typeof url === "string" && url.length > 0) return url;
    } catch {
      // try next
    }
  }
  return null;
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
