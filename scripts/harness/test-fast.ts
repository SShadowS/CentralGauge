/**
 * Faster harness test run (T-01): `deno task test:harness:fast [--jobs N] [--log-dir DIR] [--dry-run]`.
 *
 * Runs the same files as `deno test --allow-all tests/unit/harness
 * tests/unit/cli/commands/harness-command.test.ts`, split over N concurrent
 * `deno test` processes. Each process still runs its files one after another
 * (no --parallel), so in-process shared state (env vars, cwd, Deno.Command
 * mocks, module statics) never meets a concurrent test. Files that touch a
 * resource shared ACROSS processes (a fixed path, port or external service)
 * are `safe: false` and all run in chunk 0, never concurrently with each
 * other. Safe files are spread over all chunks, longest first onto the
 * lightest chunk, by the measured seconds below. A file missing from CLASSES
 * is treated as unsafe until someone classifies it. No --coverage: concurrent
 * processes would share the coverage directory.
 *
 * Classification evidence: docs/contributing/testing.md.
 */
import { parseArgs } from "@std/cli/parse-args";
import * as colors from "@std/fmt/colors";
import { join } from "@std/path";

export interface FileClass {
  safe: boolean;
  /** Summed test time in a serial run (2026-10-16 09:02, master 4bd7b577). */
  seconds: number;
}

const H = "tests/unit/harness/";
const c = (safe: boolean, seconds: number): FileClass => ({ safe, seconds });

export const CLASSES: Record<string, FileClass> = {
  "tests/unit/cli/commands/harness-command.test.ts": c(true, 166),
  [`${H}adapter.test.ts`]: c(true, 0),
  [`${H}al-tools-mcp.test.ts`]: c(true, 6),
  [`${H}allocation.test.ts`]: c(true, 0),
  [`${H}analyze-campaign-alsem203.test.ts`]: c(true, 0),
  [`${H}analyze-campaign-density.test.ts`]: c(true, 0),
  [`${H}analyze-campaign.test.ts`]: c(true, 0),
  [`${H}app-package.test.ts`]: c(true, 0),
  [`${H}app-sync-probe.test.ts`]: c(true, 0),
  [`${H}backend-probe.test.ts`]: c(true, 0),
  [`${H}backend.test.ts`]: c(true, 12),
  [`${H}bc-apps.test.ts`]: c(true, 0),
  [`${H}bc-lane.test.ts`]: c(true, 4),
  [`${H}bc-sync-provider.test.ts`]: c(true, 4),
  [`${H}build-log.test.ts`]: c(true, 0),
  [`${H}campaign.test.ts`]: c(true, 138),
  [`${H}classify.test.ts`]: c(true, 0),
  [`${H}claude-code.test.ts`]: c(true, 4),
  [`${H}claude-trace.test.ts`]: c(true, 0),
  [`${H}config.test.ts`]: c(true, 0),
  [`${H}coord-lease.test.ts`]: c(true, 0),
  [`${H}credential-budget.test.ts`]: c(true, 1),
  [`${H}egress-probe-scrub.test.ts`]: c(true, 0),
  [`${H}egress-proxy.test.ts`]: c(true, 2),
  [`${H}egress.test.ts`]: c(true, 1),
  [`${H}estimate.test.ts`]: c(true, 0),
  [`${H}execution.test.ts`]: c(true, 233),
  [`${H}extracted-tests.test.ts`]: c(true, 2),
  [`${H}final-code.test.ts`]: c(true, 0),
  [`${H}freeze-archive.test.ts`]: c(true, 2),
  [`${H}frozen-tasks-drop.test.ts`]: c(true, 6),
  [`${H}fsutil.test.ts`]: c(true, 3),
  [`${H}gate-core.test.ts`]: c(true, 0),
  [`${H}gate-stage.test.ts`]: c(true, 8),
  [`${H}gate-task.test.ts`]: c(true, 3),
  [`${H}hash.test.ts`]: c(true, 0),
  [`${H}identity.test.ts`]: c(true, 21),
  [`${H}images.test.ts`]: c(true, 0),
  [`${H}install-claude-code.test.ts`]: c(true, 11),
  [`${H}install-lsp.test.ts`]: c(true, 21),
  [`${H}integrity.test.ts`]: c(true, 0),
  [`${H}inventory-lsp.test.ts`]: c(true, 3),
  [`${H}inventory.test.ts`]: c(true, 17),
  [`${H}judge-pairs.test.ts`]: c(true, 1),
  [`${H}judge-queue.test.ts`]: c(true, 26),
  [`${H}judgment-report.test.ts`]: c(true, 1),
  [`${H}lineage.test.ts`]: c(true, 0),
  [`${H}environment.test.ts`]: c(true, 0),
  [`${H}lsp-probe.test.ts`]: c(true, 223),
  [`${H}manifest.test.ts`]: c(true, 0),
  [`${H}measures.test.ts`]: c(true, 0),
  [`${H}mock.test.ts`]: c(true, 13),
  [`${H}nonadmin.test.ts`]: c(true, 27),
  // H-38: temp dirs only (measured 2026-10-21, not in the serial run above).
  [`${H}onprem-gate.test.ts`]: c(true, 0),
  [`${H}onprem-ref.test.ts`]: c(true, 1),
  [`${H}onprem-ruling.test.ts`]: c(true, 0),
  [`${H}onprem-selfcheck.test.ts`]: c(true, 0),
  [`${H}onprem-symbols.test.ts`]: c(true, 0),
  [`${H}otel.test.ts`]: c(true, 0),
  [`${H}outcome.test.ts`]: c(true, 0),
  [`${H}persistence-bans.test.ts`]: c(true, 1),
  [`${H}pi.test.ts`]: c(true, 0),
  // H-41: in-process fakes and its own timers only.
  [`${H}pool.test.ts`]: c(true, 2),
  // H-41: at most two pool-driver.ts children at a time, each over its own
  // temp dirs (no fixed path or port): safe; slow, placed by its seconds
  // (measured 2026-10-22, standalone).
  [`${H}pool-subprocess.test.ts`]: c(true, 50),
  [`${H}prenuke-owned.test.ts`]: c(true, 3),
  [`${H}prereg.test.ts`]: c(true, 6),
  [`${H}pricing.test.ts`]: c(true, 0),
  [`${H}production-policy.test.ts`]: c(true, 0),
  [`${H}pwsh-marker.test.ts`]: c(true, 3),
  [`${H}quarantine.test.ts`]: c(true, 1),
  [`${H}qualify.test.ts`]: c(true, 0),
  // Q-07: temp dirs only.
  [`${H}quality-report.test.ts`]: c(true, 1),
  [`${H}realistic-bundle.test.ts`]: c(true, 1),
  [`${H}records.test.ts`]: c(true, 0),
  [`${H}redact-patterns.test.ts`]: c(true, 0),
  [`${H}report-charts.test.ts`]: c(true, 0),
  [`${H}report-extras.test.ts`]: c(true, 0),
  [`${H}report.test.ts`]: c(true, 3),
  [`${H}reuse.test.ts`]: c(true, 16),
  [`${H}reset.test.ts`]: c(true, 0),
  [`${H}rollups.test.ts`]: c(true, 0),
  [`${H}sandbox.test.ts`]: c(true, 4),
  [`${H}screening.test.ts`]: c(true, 5),
  [`${H}skills-bundle.test.ts`]: c(true, 0),
  [`${H}staging.test.ts`]: c(true, 8),
  [`${H}stats.test.ts`]: c(true, 1),
  [`${H}stub-anthropic.test.ts`]: c(true, 0),
  [`${H}subagent-cost.test.ts`]: c(true, 0),
  [`${H}task-oracle.test.ts`]: c(true, 1),
  [`${H}task-rev.test.ts`]: c(true, 1),
  [`${H}task-set-v1.test.ts`]: c(true, 0),
  [`${H}task.test.ts`]: c(true, 0),
  [`${H}test-rerun-runner.test.ts`]: c(true, 5),
  [`${H}test-rerun.test.ts`]: c(true, 0),
  // Runs staging + mock tests in a child deno test with its own TEMP (GH #28).
  [`${H}temp-leak-guard.test.ts`]: c(true, 41),
  [`${H}trace-metrics.test.ts`]: c(true, 0),
  [`${H}v2-configs.test.ts`]: c(true, 0),
  [`${H}verdict-mutant.test.ts`]: c(true, 32),
  [`${H}verdict-workspace-helpers.test.ts`]: c(true, 2),
  [`${H}verdict-workspace.test.ts`]: c(true, 1),
  [`${H}verdict.test.ts`]: c(true, 33),
};

export interface Plan {
  chunks: string[][];
  seconds: number[];
  unclassified: string[];
}

export function plan(
  files: string[],
  classes: Record<string, FileClass>,
  jobs: number,
): Plan {
  const bins = Array.from({ length: jobs }, () => ({
    files: [] as string[],
    seconds: 0,
  }));
  const secs = (f: string) => classes[f]?.seconds ?? 0;
  const serial = bins[0]!;
  const safe: string[] = [];
  for (const f of files) {
    if (classes[f]?.safe) safe.push(f);
    else {
      serial.files.push(f);
      serial.seconds += secs(f);
    }
  }
  safe.sort((a, b) => secs(b) - secs(a));
  for (const f of safe) {
    const bin = bins.reduce((lo, b) => b.seconds < lo.seconds ? b : lo);
    bin.files.push(f);
    bin.seconds += secs(f);
  }
  const kept = bins.filter((b) => b.files.length > 0);
  return {
    chunks: kept.map((b) => b.files.sort()),
    seconds: kept.map((b) => b.seconds),
    unclassified: files.filter((f) => !(f in classes)),
  };
}

export interface Summary {
  ok: boolean;
  passed: number;
  failed: number;
  ignored: number;
}

/** The final `ok | N passed | N failed | N ignored (time)` line of a deno test run. */
export function parseSummary(output: string): Summary | undefined {
  // deno-lint-ignore no-control-regex
  const text = output.replace(/\x1b\[[0-9;]*m/g, "");
  const m = text.match(/^(ok|FAILED) \| (.*)$/m);
  if (!m) return undefined;
  const rest = m[2] ?? "";
  const n = (k: string) =>
    Number(rest.match(new RegExp(`(\\d+) ${k}`))?.[1] ?? 0);
  return {
    ok: m[1] === "ok",
    passed: n("passed"),
    failed: n("failed"),
    ignored: n("ignored"),
  };
}

function discover(): string[] {
  const files = [...Deno.readDirSync(H)]
    .filter((e) => e.isFile && e.name.endsWith(".test.ts"))
    .map((e) => H + e.name);
  return ["tests/unit/cli/commands/harness-command.test.ts", ...files].sort();
}

async function runChunk(i: number, files: string[], logDir: string) {
  const start = Date.now();
  const log = join(logDir, `chunk-${i}.log`);
  const out = await new Deno.Command(Deno.execPath(), {
    args: ["test", "--allow-all", ...files],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const dec = new TextDecoder();
  const text = dec.decode(out.stdout) + dec.decode(out.stderr);
  await Deno.writeTextFile(log, text);
  return {
    i,
    code: out.code,
    summary: parseSummary(text),
    wall: (Date.now() - start) / 1000,
    log,
  };
}

async function main() {
  const args = parseArgs(Deno.args, {
    string: ["jobs", "log-dir"],
    boolean: ["dry-run"],
  });
  const jobs = Number(args.jobs ?? 5);
  if (!Number.isInteger(jobs) || jobs < 1) {
    throw new Error(`--jobs must be a positive integer, got ${args.jobs}`);
  }
  const p = plan(discover(), CLASSES, jobs);
  for (const f of p.unclassified) {
    console.log(
      colors.yellow(
        `[WARN] ${f} is not classified in CLASSES; running it in chunk 0 with the unsafe files`,
      ),
    );
  }
  p.chunks.forEach((files, i) => {
    console.log(
      `[Plan] chunk ${i}: ${files.length} files, ~${
        Math.round(p.seconds[i] ?? 0)
      }s`,
    );
  });
  if (args["dry-run"]) {
    p.chunks.forEach((files, i) =>
      console.log(`chunk ${i}: ${files.join(" ")}`)
    );
    return;
  }
  const logDir = args["log-dir"] ??
    await Deno.makeTempDir({ prefix: "cg-harness-tests-" });
  await Deno.mkdir(logDir, { recursive: true });
  const start = Date.now();
  const results = await Promise.all(
    p.chunks.map((files, i) => runChunk(i, files, logDir)),
  );
  const total = { passed: 0, failed: 0, ignored: 0 };
  let bad = false;
  for (const r of results) {
    const s = r.summary;
    const fine = r.code === 0 && s?.ok === true;
    bad ||= !fine;
    if (s) {
      total.passed += s.passed;
      total.failed += s.failed;
      total.ignored += s.ignored;
    }
    const tag = fine ? colors.green("[OK]") : colors.red("[FAIL]");
    const counts = s
      ? `${s.passed} passed | ${s.failed} failed | ${s.ignored} ignored`
      : "no summary line";
    console.log(
      `${tag} chunk ${r.i}: exit ${r.code} | ${counts} (${
        Math.round(r.wall)
      }s) ${r.log}`,
    );
  }
  const wall = Math.round((Date.now() - start) / 1000);
  const line =
    `${total.passed} passed | ${total.failed} failed | ${total.ignored} ignored (${wall}s wall)`;
  console.log(
    bad ? colors.red(`FAILED | ${line}`) : colors.green(`ok | ${line}`),
  );
  if (bad) Deno.exit(1);
}

if (import.meta.main) await main();
