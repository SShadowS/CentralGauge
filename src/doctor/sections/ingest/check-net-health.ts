import { parse } from "jsr:@std/yaml@^1.1.0";
import type { Check, DoctorContext } from "../../types.ts";

const TIMEOUT_MS = 5000;

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
      if (typeof url === "string" && url.length > 0) {
        return url.replace(/\/+$/, "");
      }
    } catch {
      // try next
    }
  }
  return null;
}

export const checkNetHealth: Check = {
  id: "net.health",
  level: "B",
  requires: ["cfg.present"],
  async run(ctx: DoctorContext) {
    const url = await readUrl(ctx);
    if (!url) {
      return {
        id: "net.health",
        level: "B" as const,
        status: "failed" as const,
        message: "no ingest.url configured",
        durationMs: 0,
      };
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    const started = Date.now();
    try {
      const resp = await ctx.fetchFn(`${url}/health`, {
        method: "GET",
        signal: ac.signal,
      });
      clearTimeout(timer);
      const elapsed = Date.now() - started;
      if (resp.status === 200) {
        return {
          id: "net.health",
          level: "B" as const,
          status: "passed" as const,
          message: `200 in ${elapsed}ms`,
          durationMs: 0,
        };
      }
      return {
        id: "net.health",
        level: "B" as const,
        status: "failed" as const,
        message: `${resp.status} from ${url}/health (in ${elapsed}ms)`,
        remediation: {
          summary: "Check Cloudflare worker dashboard / URL correctness",
          autoRepairable: false,
        },
        durationMs: 0,
      };
    } catch (e) {
      clearTimeout(timer);
      const isAbort = e instanceof DOMException && e.name === "AbortError";
      return {
        id: "net.health",
        level: "B" as const,
        status: "failed" as const,
        message: isAbort
          ? `timeout after ${TIMEOUT_MS}ms`
          : `fetch failed: ${e instanceof Error ? e.message : String(e)}`,
        remediation: {
          summary: "Check URL, DNS, and network",
          autoRepairable: false,
        },
        durationMs: 0,
      };
    }
  },
};
