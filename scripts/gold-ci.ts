/**
 * Gold-solution CI: replay reference solutions against their oracles and
 * record the verdicts, so a task whose reference stops passing is caught by a
 * machine rather than by a confused operator months later.
 *
 * Why this exists (synthesis G1, the largest gap against field practice):
 *
 *   - BigCodeBench computes a "Groundtruth pass rate" on EVERY evaluation run
 *     and ships `--check_gt_only` for CI. METR re-runs gold solutions whenever
 *     a task is revised, explicitly to catch a scoring change.
 *   - SWE-bench does NOT, and that is how issue-#484-class rot happened: gold
 *     patches silently stopped passing as dependencies drifted, undetected for
 *     about a year, because the only gold validation was a one-time sweep at
 *     the Docker cutover.
 *   - We had the SWE-bench version of this problem. `trap-probe` is invoked by
 *     hand, so nothing revalidated references when an oracle, a dependency
 *     manifest, or a container image changed. CG-AL-X001 sat with a TEST
 *     codeunit as its "reference solution" until a mutation sweep tripped over
 *     it, and the 20 `Any` tasks passed probe while failing the bench.
 *
 * What it does: for each in-scope task with a reference solution, decide
 * whether the recorded green replay is still trustworthy, and re-probe the
 * ones that are not. Staleness is content-addressed, not time-based — a replay
 * is invalidated by a change to any input that can alter the verdict:
 *
 *   - the oracle and its companions (`tests/al/<tier>/<id>*.al`)
 *   - the reference solution itself (`reference/solutions/<id>/`)
 *   - the prereq app, if the task has one
 *   - the harness inputs that decide what the candidate app declares and
 *     depends on (dependency manifest, app.json writers, probe entry point)
 *
 * That last group is the one a hand-run probe always forgets, and the one the
 * `Any` incident turned on.
 *
 * Usage:
 *   deno run --allow-all scripts/gold-ci.ts --check      # report only, exit 1 if stale
 *   deno run --allow-all scripts/gold-ci.ts --replay     # re-probe stale tasks
 *   deno run --allow-all scripts/gold-ci.ts --replay --all
 *   deno run --allow-all scripts/gold-ci.ts --replay --sample 8
 *   deno run --allow-all scripts/gold-ci.ts --replay --task CG-AL-H015
 *   deno run --allow-all scripts/gold-ci.ts --replay \
 *     --containers Cronus28,Cronus281,Cronus282   # one worker per container
 *
 * Ledger: docs/reasoning-suite/gold-ci.json (consumed by gate-records.ts).
 */

import { dirname, fromFileUrl, join } from "@std/path";
import {
  harnessFingerprint,
  hashFiles,
} from "../src/utils/harness-fingerprint.ts";

const REPO = dirname(dirname(fromFileUrl(import.meta.url)));
const LEDGER = join(REPO, "docs", "reasoning-suite", "gold-ci.json");

interface Replay {
  /** "pass" | "fail" | "error" */
  verdict: string;
  at: string;
  testsPassed?: number;
  testsTotal?: number;
  /** Fingerprint of every input that can change the verdict. */
  inputsHash: string;
  harnessHash: string;
  detail?: string;
}

interface Ledger {
  schemaVersion: number;
  what: string;
  harnessHash?: string;
  tasks: Record<string, Replay>;
}

async function exists(p: string): Promise<boolean> {
  try {
    await Deno.stat(join(REPO, p));
    return true;
  } catch {
    return false;
  }
}

/** Every path whose content can change this task's verdict. */
async function taskInputs(id: string, tier: string): Promise<string[]> {
  const out: string[] = [];
  for (const dir of [`tests/al/${tier}`, `reference/solutions/${id}`]) {
    try {
      for await (const e of Deno.readDir(join(REPO, dir))) {
        if (!e.isFile) continue;
        // Oracle dir holds every task's files; take only this task's.
        if (dir.startsWith("tests/al/") && !e.name.startsWith(id)) continue;
        // PROVENANCE is a note about the solution, not an input to it.
        if (e.name === "PROVENANCE.md") continue;
        out.push(`${dir}/${e.name}`);
      }
    } catch { /* absent dir is not an error */ }
  }
  const prereq = `tests/al/dependencies/${id}`;
  if (await exists(prereq)) {
    for await (const e of Deno.readDir(join(REPO, prereq))) {
      if (e.isFile) out.push(`${prereq}/${e.name}`);
    }
  }
  return out;
}

async function inScopeTasks(): Promise<Map<string, string>> {
  const tasks = new Map<string, string>();
  for (const tier of ["hard", "medium"]) {
    for await (const e of Deno.readDir(join(REPO, "tasks", tier))) {
      if (!e.isFile || !e.name.endsWith(".yml")) continue;
      const txt = await Deno.readTextFile(join(REPO, "tasks", tier, e.name));
      const m = txt.match(/^id:\s*["']?([A-Za-z0-9-]+)/m);
      tasks.set(m ? m[1]! : e.name.slice(0, -4), tier);
    }
  }
  return tasks;
}

async function loadLedger(): Promise<Ledger> {
  try {
    return JSON.parse(await Deno.readTextFile(LEDGER)) as Ledger;
  } catch {
    return {
      schemaVersion: 1,
      what:
        "Gold-solution replay ledger. A task is TRUSTED only while its recorded " +
        "verdict is `pass` AND the hashes below still match: inputsHash covers the " +
        "oracle, companions, reference solution and prereq; harnessHash covers the " +
        "dependency manifest and app.json writers. Either changing invalidates the " +
        "replay, because either can flip the verdict.",
      tasks: {},
    };
  }
}

interface ProbeOutcome {
  verdict: string;
  testsPassed?: number;
  testsTotal?: number;
  detail?: string;
}

async function probe(id: string, container?: string): Promise<ProbeOutcome> {
  const cmd = new Deno.Command("deno", {
    args: [
      "run",
      "-A",
      "scripts/trap-probe.ts",
      "--task",
      id,
      "--solution",
      `reference/solutions/${id}`,
      "--expect",
      "pass",
      ...(container ? ["--container", container] : []),
    ],
    cwd: REPO,
    stdout: "piped",
    stderr: "piped",
  });
  const out = await cmd.output();
  const text = new TextDecoder().decode(out.stdout) +
    new TextDecoder().decode(out.stderr);
  const tests = text.match(/tests:\s*(\d+)\/(\d+)\s*passed/);
  const verdict = out.code === 0
    ? "pass"
    : /actual=fail/.test(text)
    ? "fail"
    : "error";
  const line = text.split("\n").reverse().find((l) =>
    /trap-probe\]\s*(message|OK|FAIL)/.test(l)
  );
  return {
    verdict,
    ...(tests
      ? { testsPassed: Number(tests[1]), testsTotal: Number(tests[2]) }
      : {}),
    ...(line ? { detail: line.replace(/\[[0-9;]*m/g, "").trim() } : {}),
  };
}

async function main(argv: string[]) {
  const replay = argv.includes("--replay");
  const all = argv.includes("--all");
  const sampleArg = argv.indexOf("--sample");
  const sample = sampleArg >= 0 ? Number(argv[sampleArg + 1]) : 0;
  const taskArg = argv.indexOf("--task");
  const only = taskArg >= 0 ? argv[taskArg + 1] : undefined;
  const containersArg = argv.indexOf("--containers");
  const containers: string[] = containersArg >= 0
    ? (argv[containersArg + 1] ?? "").split(",").map((c) => c.trim()).filter(
      Boolean,
    )
    : [];

  const harnessHash = await harnessFingerprint(REPO);
  const ledger = await loadLedger();
  const tasks = await inScopeTasks();

  const trusted: string[] = [];
  const stale: string[] = [];
  const failing: string[] = [];
  const noRef: string[] = [];
  const inputs = new Map<string, string>();

  for (const [id, tier] of [...tasks].sort()) {
    if (!(await exists(`reference/solutions/${id}`))) {
      noRef.push(id);
      continue;
    }
    const h = await hashFiles(await taskInputs(id, tier), REPO, {
      missing: "skip",
    });
    inputs.set(id, h);
    const rec = ledger.tasks[id];
    if (rec === undefined) {
      stale.push(id);
    } else if (rec.verdict !== "pass") {
      failing.push(id);
    } else if (rec.inputsHash !== h || rec.harnessHash !== harnessHash) {
      stale.push(id);
    } else {
      trusted.push(id);
    }
  }

  console.log(`[gold-ci] harness fingerprint ${harnessHash.slice(0, 12)}`);
  console.log(
    `[gold-ci] trusted (green, inputs unchanged) : ${trusted.length}`,
  );
  console.log(`[gold-ci] STALE (never replayed or changed) : ${stale.length}`);
  console.log(
    `[gold-ci] FAILING (recorded non-pass)       : ${failing.length}`,
  );
  console.log(`[gold-ci] no reference solution             : ${noRef.length}`);
  if (failing.length > 0) {
    console.log(`[gold-ci]   failing: ${failing.join(" ")}`);
  }

  if (!replay) {
    if (stale.length > 0) {
      console.log(
        `\n[gold-ci] ${stale.length} task(s) need a replay. First 20:\n  ` +
          stale.slice(0, 20).join(" "),
      );
    }
    return stale.length > 0 || failing.length > 0 ? 1 : 0;
  }

  let queue = only !== undefined
    ? [only]
    : all
    ? [...tasks.keys()].filter((t) => inputs.has(t))
    : stale;
  if (sample > 0) {
    // Deterministic sample: sorted order, evenly spaced. A random sample would
    // make the CI's own verdict irreproducible.
    const src = [...queue].sort();
    const step = Math.max(1, Math.floor(src.length / sample));
    queue = src.filter((_, i) => i % step === 0).slice(0, sample);
  }
  // One worker per container. A full backfill is ~200 serial probes against a
  // single container while the rest of the pool sits idle, and the whole
  // ledger goes stale again on every harness change - so this runs often
  // enough to be worth fanning out.
  const workers: (string | undefined)[] = containers.length > 0
    ? containers
    : [undefined];
  console.log(
    `\n[gold-ci] replaying ${queue.length} task(s) on ${workers.length} ` +
      `container(s)${
        containers.length > 0 ? `: ${containers.join(", ")}` : ""
      }\n`,
  );

  let pass = 0, bad = 0, next = 0;
  // Serialise ledger writes through a promise chain. Persisting after each
  // task means a long replay killed midway keeps everything it finished, and
  // concurrent probes must not interleave writes to the same file.
  let writes: Promise<void> = Promise.resolve();

  async function runWorker(container?: string) {
    const tag = container ? `[${container}] ` : "";
    while (true) {
      const i = next++;
      if (i >= queue.length) return;
      const id = queue[i]!;
      const tier = tasks.get(id);
      if (tier === undefined) {
        console.log(`  ${tag}${id}: not an in-scope task, skipped`);
        continue;
      }
      const r = await probe(id, container);
      const h = inputs.get(id) ?? await hashFiles(
        await taskInputs(id, tier),
        REPO,
        { missing: "skip" },
      );
      ledger.tasks[id] = {
        verdict: r.verdict,
        at: new Date().toISOString(),
        ...(r.testsPassed !== undefined ? { testsPassed: r.testsPassed } : {}),
        ...(r.testsTotal !== undefined ? { testsTotal: r.testsTotal } : {}),
        inputsHash: h,
        harnessHash,
        ...(r.detail ? { detail: r.detail } : {}),
      };
      if (r.verdict === "pass") {
        pass++;
        console.log(
          `  ${tag}${id}: pass ${r.testsPassed ?? "?"}/${r.testsTotal ?? "?"}` +
            ` (${pass + bad}/${queue.length})`,
        );
      } else {
        bad++;
        console.log(
          `  ${tag}${id}: ${r.verdict.toUpperCase()} - ${
            r.detail ?? "(no detail)"
          } (${pass + bad}/${queue.length})`,
        );
      }
      ledger.harnessHash = harnessHash;
      writes = writes.then(() =>
        Deno.writeTextFile(LEDGER, JSON.stringify(ledger, null, 2) + "\n")
      );
      await writes;
    }
  }

  await Promise.all(workers.map((c) => runWorker(c)));

  console.log(`\n[gold-ci] replayed ${pass + bad}: ${pass} pass, ${bad} not`);
  console.log(`[gold-ci] -> ${LEDGER}`);
  return bad > 0 ? 1 : 0;
}

if (import.meta.main) Deno.exit(await main(Deno.args));
