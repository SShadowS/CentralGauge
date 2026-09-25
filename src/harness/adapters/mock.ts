/**
 * Mock harness adapter (spec 1a section 11): runs mock.ps1, no model, no
 * credential, no spend. Its arms apply a task variant named in the explicit
 * per-task qualification manifest (M4 round 2 section 4), never "first
 * alphabetically": `positive` is the task's positive folder (`correct/` or
 * `reference-tests/`), `naive:<name>` must be listed. `fixture:<name>`
 * applies tests/fixtures/harness/hostile/<name> (the M1-30 hostile rows).
 */

import { join } from "@std/path";
import type { HarnessAdapter, ParsedRun } from "../adapter.ts";
import type { QualifyManifest } from "../qualify.ts";
import type { Termination } from "../records.ts";
import { ConfigurationError } from "../../errors.ts";

export const HOSTILE_FIXTURES = "tests/fixtures/harness/hostile";

/** The task-relative variant folder the mock arm applies. */
export function resolveVariant(
  taskId: string,
  settings: Record<string, unknown>,
  manifest: QualifyManifest,
): string {
  const t = manifest.tasks[taskId];
  if (!t) {
    throw new ConfigurationError(
      `${taskId} is not listed in the qualification manifest`,
    );
  }
  const v = settings["variant"];
  if (v === "positive") return t.positive;
  if (typeof v === "string" && v.startsWith("naive:")) {
    const name = v.slice("naive:".length);
    if (!t.naive.includes(name)) {
      throw new ConfigurationError(
        `${taskId}: naive variant ${name} is not listed in the qualification manifest (listed: ${
          t.naive.join(", ")
        })`,
      );
    }
    return `naive/${name}`;
  }
  throw new ConfigurationError(
    `${taskId}: mock variant must be positive or naive:<name>, got ${
      JSON.stringify(v)
    }`,
  );
}

type Line = Record<string, unknown> & { type?: unknown };

export const mockAdapter: HarnessAdapter = {
  harness: "mock",
  declared: ["harness_version", "exit_code"],
  secretFiles: [],
  credentialBearing: false,
  // No model, no spend: the budget cannot be exceeded.
  enforcesBudget: true,
  nativeSettings: (config) => ({ ...config.settings }),
  providerRoutes: () => ({}),
  extraMounts: () => Promise.resolve([]),
  configCopies({ settings, task, repoRoot, qualify }) {
    const copies: { src: string; dst: string }[] = [];
    const v = settings["variant"];
    if (typeof v === "string" && v.startsWith("fixture:")) {
      const name = v.slice("fixture:".length);
      if (!/^[a-z0-9-]+$/.test(name)) {
        throw new ConfigurationError(`mock fixture name ${name} is not a slug`);
      }
      copies.push({
        src: join(repoRoot, HOSTILE_FIXTURES, name),
        dst: "variant",
      });
    } else if (v !== undefined) {
      if (!qualify) {
        throw new ConfigurationError(
          `mock variant ${
            JSON.stringify(v)
          } needs a qualification manifest (--qualify-manifest)`,
        );
      }
      const rel = resolveVariant(task.task.id, settings, qualify);
      copies.push({ src: join(task.dir, ...rel.split("/")), dst: "variant" });
    }
    if (settings["mode"] === "hostile-probe-backend") {
      copies.push({
        src: join(repoRoot, "scripts", "harness", "cg-al-probe.ps1"),
        dst: "cg-al-probe.ps1",
      });
    }
    return copies;
  },
  async parse(input): Promise<ParsedRun> {
    let text = "";
    try {
      text = await Deno.readTextFile(input.rawLog);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
    const lines: Line[] = [];
    const problems: string[] = [];
    for (const [i, l] of text.split(/\r?\n/).entries()) {
      if (l.trim() === "") continue;
      try {
        lines.push(JSON.parse(l) as Line);
      } catch {
        problems.push(`line ${i + 1}: not JSON`);
      }
    }
    const of = (t: string) => lines.filter((x) => x.type === t);
    const init = of("mock_init")[0];
    const version = typeof init?.["version"] === "string"
      ? init["version"]
      : null;
    const limit = of("mock_usage_limit")[0];
    const done = of("mock_done").length > 0;
    const termination: Termination | null = limit
      ? "usage_limited"
      : done && input.exitCode === 0
      ? "completed"
      : null;
    const resets = limit?.["resets_at"];
    await Deno.writeTextFile(input.traceOut, "");
    return {
      telemetry: {
        harness_version: version,
        cost_usd: 0,
        cost_source: "estimated",
        pricing_snapshot: "mock: no model",
        reported_cost_usd: null,
        per_model: [],
        turns: null,
        compactions: null,
        wall_ms: null,
        exit_code: input.exitCode,
        stop_reason: null,
        refusal_detected: null,
        raw_usage: { stream_problems: problems },
      },
      observed: {
        harness_version: version,
        models: [],
        loaded_components: init ? [] : null,
      },
      unobservable: [],
      didWork: of("mock_apply").length > 0 || of("mock_cg_al").length > 0,
      termination,
      usageResetAt: typeof resets === "number" && Number.isFinite(resets)
        ? new Date(resets * 1000).toISOString()
        : null,
      imageSupport: null,
      traceEvents: 0,
    };
  },
};
