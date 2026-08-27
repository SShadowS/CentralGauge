/**
 * Build the per-task hardening-gate record for the promoted suite.
 *
 * `docs/reasoning-suite/backfill-plan.md` asks for something specific: not an
 * assertion that the suite has been backfilled, but a record that makes the
 * question answerable from data. "Is the suite level?" should be a query, not
 * a claim someone has to trust.
 *
 * So this emits one row per promoted task covering every gate in
 * `hardening-pipeline.md` loop B and C, each row carrying the gate's status,
 * when it ran, and what it found. A gate that has never run says so, and a
 * gate that CANNOT run for a given task says that instead - those are
 * different facts and collapsing them is how a suite comes to look level
 * without being level.
 *
 * Output:
 *   docs/reasoning-suite/gate-records.json  - the queryable artifact
 *   docs/reasoning-suite/gate-records.md    - a human-readable rollup
 *
 * Query examples:
 *   jq '[.tasks[]|select(.gates.B2.status=="quarantine")|.id]' gate-records.json
 *   jq '[.tasks[]|select(.gates.B7.status=="absent")]|length' gate-records.json
 *   deno run -A scripts/gate-records.ts --query summary
 */

import { exists } from "@std/fs";
import { join } from "@std/path";

const REPO = new URL("..", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);

const DOCS = join(REPO, "docs", "reasoning-suite");
const JSON_OUT = join(DOCS, "gate-records.json");
const MD_OUT = join(DOCS, "gate-records.md");

/**
 * Status vocabulary, deliberately small.
 *
 * `not_runnable` is the one that matters most. It is NOT a synonym for
 * `absent`: absent means nobody has run the gate yet, not_runnable means the
 * gate cannot be run for this task as things stand and needs an unblocking
 * step first. B2 and B4 are not_runnable for every task with no reference
 * solution on disk, which is most of the suite.
 */
type GateStatus =
  | "pass"
  | "quarantine"
  | "stale"
  | "absent"
  | "not_runnable"
  | "pending_no_tooling"
  | "inconclusive";

interface GateRecord {
  status: GateStatus;
  /**
   * Explicitly `| undefined` rather than merely optional: under
   * `exactOptionalPropertyTypes` an absent timestamp and a present-but-unknown
   * one are different types, and several gates legitimately produce the latter
   * (a report with no readable mtime, a run with no recorded generation time).
   */
  at?: string | undefined;
  detail?: string | undefined;
  [k: string]: unknown;
}

interface TaskRecord {
  id: string;
  tier: string;
  kind: string;
  hasReferenceSolution: boolean;
  gates: Record<string, GateRecord>;
}

// ---------------------------------------------------------------------------

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await Deno.readTextFile(path)) as T;
  } catch {
    return undefined;
  }
}

async function promptTemplateOf(ymlPath: string): Promise<string> {
  try {
    const text = await Deno.readTextFile(ymlPath);
    const m = text.match(/prompt_template:\s*["']?([^"'\r\n]+)/);
    if (m?.[1] === undefined) return "unknown";
    return m[1].trim().replace(/\.md$/, "");
  } catch {
    return "unknown";
  }
}

async function inventory(): Promise<TaskRecord[]> {
  const rows: TaskRecord[] = [];
  for (const tier of ["hard", "medium", "easy"] as const) {
    const dir = join(REPO, "tasks", tier);
    if (!(await exists(dir))) continue;
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile || !entry.name.endsWith(".yml")) continue;
      const id = entry.name.match(/^(CG-AL-[A-Z0-9]+)/)?.[1];
      if (id === undefined) continue;
      rows.push({
        id,
        tier,
        kind: await promptTemplateOf(join(dir, entry.name)),
        hasReferenceSolution: await exists(
          join(REPO, "reference", "solutions", id),
        ),
        gates: {},
      });
    }
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  return rows;
}

// ---------------------------------------------------------------------------
// B1 - discrimination probe. The verdict a prior `task probe` cached.
// ---------------------------------------------------------------------------

interface ProbeJson {
  correct: string;
  naive: string;
  discriminates: boolean;
  at: string;
}

async function attachB1(t: TaskRecord): Promise<void> {
  const probe = await readJson<ProbeJson>(
    join(REPO, "scratch", t.id, ".probe.json"),
  );
  if (probe === undefined) {
    const seed = SEED_VERIFICATION[t.id];
    if (seed !== undefined) {
      t.gates["B1"] = {
        status: seed.b1 === "pass"
          ? "pass"
          : seed.b1 === "inconclusive"
          ? "inconclusive"
          : "quarantine",
        detail:
          `correct leg only (seeded reference, no negative side authored): ${seed.detail}`,
        legs: "correct-only",
      };
      return;
    }
    t.gates["B1"] = {
      status: t.hasReferenceSolution ? "absent" : "not_runnable",
      detail: t.hasReferenceSolution
        ? "no .probe.json on this machine"
        : "no reference solution: a discrimination probe has no correct side to run",
    };
    return;
  }
  t.gates["B1"] = {
    status: probe.discriminates ? "pass" : "quarantine",
    at: probe.at,
    detail: `correct=${probe.correct} naive=${probe.naive}`,
  };
}

// ---------------------------------------------------------------------------
// B2 - determinism, from the phase-1 backfill run.
// ---------------------------------------------------------------------------

interface Phase1Run {
  container: string;
  correct: string;
  naive: string;
  ms: number;
  exit: number;
}
interface Phase1Verdict {
  id: string;
  status: string;
  reason: string;
  runs: Phase1Run[];
  baseline?: { at: string };
}
interface Phase1File {
  generatedAt: string;
  verdicts: Phase1Verdict[];
  skipped: { id: string; why: string }[];
}

function attachB2(
  t: TaskRecord,
  phase1: Phase1File | undefined,
): void {
  const v = phase1?.verdicts.find((x) => x.id === t.id);
  if (v === undefined) {
    // A seeded task has no negative side, so phase 1 never ran it. Its
    // verification still measured the passing path twice on two containers,
    // which is what B2 asks of that path.
    const seed = SEED_VERIFICATION[t.id];
    if (seed !== undefined) {
      t.gates["B2"] = {
        status: seed.b2 === "pass"
          ? "pass"
          : seed.b2 === "quarantine"
          ? "quarantine"
          : "inconclusive",
        detail: `passing path only (seeded reference): ${seed.detail}`,
        ...(seed.runs === undefined
          ? {}
          : { containers: seed.runs.map((r) => r.container) }),
        scope: "passing-path-only",
      };
      return;
    }
    const skip = phase1?.skipped.find((x) => x.id === t.id);
    t.gates["B2"] = {
      status: skip === undefined ? "absent" : "not_runnable",
      detail: skip?.why ??
        "determinism has never been measured for this task",
      ...(skip === undefined ? {} : {
        note:
          "B2 as specified needs a program that PASSES the oracle, so that the " +
          "passing path is what gets re-run. Without a reference solution there is " +
          "no such program. A weaker variant (re-run the oracle against any fixed " +
          "failing project and compare counts) would detect gross oracle flakiness " +
          "but never exercises the passing path, which is where it matters.",
      }),
    };
    return;
  }
  const status: GateStatus = v.status === "DETERMINISTIC"
    ? "pass"
    : v.status === "QUARANTINE"
    ? "quarantine"
    : "inconclusive";
  t.gates["B2"] = {
    status,
    at: phase1?.generatedAt,
    detail: v.reason,
    containers: v.runs.map((r) => r.container),
    // Verdict AND assertion counts per run - matching aggregates is not enough.
    observations: v.runs.map((r) =>
      `${r.container}: correct=${r.correct} naive=${r.naive}`
    ),
  };
}

// ---------------------------------------------------------------------------
// B7 - mutation. A report whose oracle changed afterwards is STALE, not pass:
// its survivor list describes an oracle that no longer exists.
// ---------------------------------------------------------------------------

/**
 * Phase-2 triage dispositions, keyed by task id. Loaded once at module scope so
 * attachB7 can distinguish an accounted-for survivor from a real hole.
 */
interface DispositionEntry {
  totals: Record<string, number>;
  resweepResult?: {
    state?: string;
    partialRun?: boolean;
    scoreAfter?: number | null;
    deployedPerLog?: number | null;
    mutantsAfter?: number | null;
    allDispositionsConfirmed?: boolean | null;
  };
}

interface B4Entry {
  status: string;
  detail: string;
  tier?: string;
  outsideFamilies?: Record<string, { model: string; when: string }>;
  everSolved?: string[];
}

/**
 * B4 over-strictness evidence, recovered from the stored bench corpus.
 *
 * The gate asks whether the oracle accepts a SECOND valid implementation. Two
 * independent models from families other than the authoring family, both
 * passing prompt-only, is exactly that evidence - and 237 stored bench runs
 * already contain it for a third of the suite, so most of B4 costs nothing to
 * establish. Built by the block in scripts/ that writes b4-evidence.json.
 */
const B4_EVIDENCE: Record<string, B4Entry> = await (async () => {
  try {
    const raw = await Deno.readTextFile(join(DOCS, "b4-evidence.json"));
    return (JSON.parse(raw) as { tasks?: Record<string, B4Entry> }).tasks ?? {};
  } catch {
    return {};
  }
})();

const DISPOSITIONS: Record<string, DispositionEntry> = await (async () => {
  try {
    const raw = await Deno.readTextFile(
      join(DOCS, "survivor-dispositions.json"),
    );
    const parsed = JSON.parse(raw) as {
      tasks?: Record<string, DispositionEntry>;
    };
    return parsed.tasks ?? {};
  } catch {
    return {};
  }
})();

/**
 * Phase-3 seed verification, keyed by task id.
 *
 * These are the 123 tasks that had no reference solution committed until one was
 * seeded from a stored passing bench submission. Verifying a seed establishes
 * two things at once, so both gates read from here: B1's correct leg (does it
 * still pass TODAY's oracle) and B2 (does it pass identically on a second
 * container). It is a WEAKER B1 than a diagnose task's two-sided discrimination
 * probe - there is no negative side to run, because none was ever authored -
 * and the record says so rather than calling them the same thing.
 */
const SEED_VERIFICATION: Record<
  string,
  { b1: string; b2: string; detail: string; runs?: { container: string }[] }
> = await (async () => {
  try {
    const raw = await Deno.readTextFile(
      join(REPO, "scratch", "phase3-seed-final.json"),
    );
    const parsed = JSON.parse(raw) as {
      verdicts?: {
        id: string;
        b1: string;
        b2: string;
        detail: string;
        runs?: { container: string }[];
      }[];
    };
    const map: Record<string, {
      b1: string;
      b2: string;
      detail: string;
      runs?: { container: string }[];
    }> = {};
    for (const v of parsed.verdicts ?? []) map[v.id] = v;
    return map;
  } catch {
    return {};
  }
})();

interface LethalReport {
  mutationScore?: number;
  counts?: Record<string, number>;
  baselineGreen?: boolean;
  mutants?: { mutantCode: string; verdict: string }[];
}

async function fileMtime(path: string): Promise<Date | undefined> {
  try {
    return (await Deno.stat(path)).mtime ?? undefined;
  } catch {
    return undefined;
  }
}

async function oracleCommitDate(t: TaskRecord): Promise<Date | undefined> {
  const rel = `tests/al/${t.tier}/${t.id}.Test.al`;
  try {
    const out = await new Deno.Command("git", {
      args: ["log", "-1", "--format=%cI", "--", rel],
      cwd: REPO,
      stdout: "piped",
      stderr: "null",
    }).output();
    const s = new TextDecoder().decode(out.stdout).trim();
    return s === "" ? undefined : new Date(s);
  } catch {
    return undefined;
  }
}

/**
 * Why a LethAL run produced nothing, when the reason is a PERMANENT property of
 * LethAL's execution path rather than a fixable failure.
 *
 * LethAL runs the solution and the oracle as two SEPARATE apps
 * (`--project app --tests tests`) inside a fenced GuiAllowed=No /
 * ClientType=ODataV4 session with test isolation on. Three kinds of oracle
 * cannot execute there at all, no matter how good the oracle is:
 *
 *   - opens a TestPage - BC refuses to create a test service in the fenced
 *     session (measured at 87 ms; a refusal, not a hang)
 *   - starts a background session - requires a TestRunner with TestIsolation
 *     disabled
 *   - asserts on DataScope::Module isolated storage - Module scope resolves to
 *     the TEST app's module, not the solution's, so the assertion can never see
 *     what the solution stored. The bench itself compiles candidate and oracle
 *     into ONE app, where the same test passes.
 *
 * These belong in `not_runnable`, not `quarantine`: nothing about the suite can
 * be changed to make them pass, so counting them as failures would put a
 * permanent floor under the gate and hide the failures that ARE actionable.
 */
async function lethalStructuralLimit(
  taskId: string,
): Promise<string | undefined> {
  let log: string;
  try {
    log = await Deno.readTextFile(
      join(REPO, "scratch", "lethal-t1", taskId, "lethal-run.log"),
    );
  } catch {
    return undefined;
  }
  if (log.includes("TESTPAGE UNSUPPORTED")) {
    return "oracle opens a TestPage, which BC refuses in LethAL's fenced ODataV4 session";
  }
  if (log.includes("TestIsolation set to Disabled")) {
    return "oracle starts a background session, which needs a TestRunner with TestIsolation disabled";
  }
  return undefined;
}

/**
 * Oracles whose structural limit is not visible in LethAL's own output, so it
 * cannot be detected from the log and has to be named here.
 */
const LETHAL_UNSCORABLE: Record<string, string> = {
  "CG-AL-H016":
    "oracle asserts on DataScope::Module isolated storage; under LethAL's two-app split " +
    "Module scope resolves to the test app, not the solution, so the assertion can never " +
    "observe the stored value. Passes in the bench, where both compile into one app",
};

async function attachB7(t: TaskRecord): Promise<void> {
  const reportPath = join(REPO, "scratch", "lethal-t1", t.id, "report.json");
  const report = await readJson<LethalReport>(reportPath);
  if (report === undefined) {
    t.gates["B7"] = {
      status: "absent",
      detail: "no LethAL sweep has been run for this task",
    };
    return;
  }

  const survivors = (report.mutants ?? []).filter((m) =>
    m.verdict === "survived" || m.verdict === "no-coverage"
  );
  const noCoverage = survivors.filter((m) => m.verdict === "no-coverage");

  const reportAt = await fileMtime(reportPath);
  const oracleAt = await oracleCommitDate(t);
  const stale = reportAt !== undefined && oracleAt !== undefined &&
    oracleAt.getTime() > reportAt.getTime();

  // Phase-2 triage decides whether survivors are a FAILURE or an accounted-for
  // residual. A raw survivor count cannot: 63 of the suite's survivors are
  // provably equivalent, and treating those as a failed gate would make the
  // ledger permanently and uselessly red.
  const dispo = DISPOSITIONS[t.id];
  const unreached = dispo === undefined
    ? undefined
    : dispo.totals["unreached"] ?? 0;
  const triaged = dispo !== undefined;

  // A re-sweep re-measures against the CURRENT oracle, which is what retires
  // `stale`. A STRANDED re-sweep does not: it reports only the mutants that ran
  // before a timeout mutant killed the run, with a fresh mtime and a score over
  // a subset. Treat it as no re-sweep at all.
  const resweep = dispo?.resweepResult;
  const resweptClean = resweep?.state === "DONE" &&
    resweep?.partialRun !== true;
  const resweptPartial = resweep?.state === "DONE" &&
    resweep?.partialRun === true;

  // A run whose verdicts were all discarded reports zero survivors, which
  // would otherwise read as the STRONGEST possible pass when it is in fact no
  // measurement at all. Both of these must be decided BEFORE the survivor
  // count is consulted:
  //   - every mutant `error` - the run was quarantined (LethAL's
  //     unattested-artifact gate) or refused, and `mutants 0.0s` shows nothing
  //     ever executed. 5 tasks hit this on 2026-08-27.
  //   - baseline red - the score was computed against an oracle its own
  //     reference solution does not satisfy, so it does not describe the
  //     oracle. LethAL reports this as `SCOPE: degraded [baseline-red]` in the
  //     console but still writes a populated `mutationScore` to the report.
  const allMutants = report.mutants ?? [];
  const errored = allMutants.filter((m) => m.verdict === "error");
  const noMeasurement = allMutants.length > 0 &&
    errored.length === allMutants.length;
  const baselineRed = report.baselineGreen === false;

  let status: GateStatus;
  let detail: string;
  // A report with no mutants at all is the broadest false pass of the three:
  // it has zero survivors for the trivial reason that there was nothing to
  // mutate, so it would otherwise satisfy `survivors.length === 0`. LethAL
  // reports it as `0 sites -> 0 deployed (0/1 files instrumentable)`, and the
  // usual cause is a purely declarative task - a table, page or enum with no
  // procedure bodies. Mutation testing has nothing to say about those, which
  // makes the gate inapplicable rather than satisfied.
  const noMutableSites = allMutants.length === 0;

  const structural = LETHAL_UNSCORABLE[t.id] ??
    await lethalStructuralLimit(t.id);
  if (noMutableSites) {
    status = "not_runnable";
    detail =
      "no mutable sites: LethAL generated 0 mutants from this solution, so there is nothing " +
      "for the oracle to be measured against. Typically a purely declarative task";
  } else if (structural !== undefined && (noMeasurement || baselineRed)) {
    status = "not_runnable";
    detail = `not measurable by LethAL: ${structural}`;
  } else if (noMeasurement) {
    status = "quarantine";
    detail =
      `no measurement: all ${errored.length} mutant(s) returned verdict "error", so the run ` +
      "produced no verdicts at all. Zero survivors here means nothing ran, NOT that nothing " +
      "survived";
  } else if (baselineRed) {
    status = "quarantine";
    detail =
      "baseline red: the reference solution does not pass this task's own oracle, so any " +
      `score (${report.mutationScore}) was measured against something other than a working ` +
      "implementation";
  } else if (survivors.length === 0) {
    status = "pass";
    detail = resweptClean
      ? "every survivor triaged to equivalent, out-of-scope-proved or accepted, and confirmed " +
        `by a COMPLETE re-sweep (score ${resweep?.scoreAfter})`
      : "no surviving mutants";
  } else if (!triaged) {
    status = stale ? "stale" : "quarantine";
    detail = stale
      ? `report predates the current oracle (oracle committed ${oracleAt?.toISOString()}) ` +
        `and its ${survivors.length} survivor(s) are untriaged - re-sweep required`
      : `${survivors.length} survivor(s) with no recorded disposition`;
  } else if (unreached !== undefined && unreached > 0) {
    // A confirmed coverage hole. Not acceptable under B7, whatever the report's age.
    status = "quarantine";
    detail =
      `${unreached} UNREACHED mutant(s) - confirmed coverage hole; kill test recorded in ` +
      `survivor-dispositions.json`;
  } else if (stale || resweptPartial) {
    status = "stale";
    detail = resweptPartial
      ? "every survivor is dispositioned, and a re-sweep ran, but it STRANDED on a timeout " +
        `mutant (${resweep?.deployedPerLog} deployed, ${resweep?.mutantsAfter} in the report). ` +
        "A partial run re-measures nothing and its score is over a subset, so this stays stale"
      : "every survivor is dispositioned as equivalent, out-of-scope, already-killed or " +
        "accepted, but the report predates the current oracle, so the score itself needs a " +
        "confirming re-sweep";
  } else {
    status = "pass";
    detail =
      "every survivor triaged to equivalent, out-of-scope-proved or accepted";
  }

  t.gates["B7"] = {
    status,
    at: reportAt?.toISOString(),
    score: report.mutationScore,
    survivors: survivors.length,
    noCoverage: noCoverage.length,
    errored: errored.length,
    noMeasurement,
    noMutableSites,
    baselineRed,
    ...(structural === undefined ? {} : { lethalStructuralLimit: structural }),
    survivorCodes: survivors.map((m) => m.mutantCode),
    triaged,
    ...(dispo === undefined ? {} : { dispositions: dispo.totals }),
    reportPredatesOracle: stale,
    ...(resweep === undefined ? {} : {
      resweep: {
        state: resweep.state,
        partial: resweep.partialRun === true,
        scoreAfter: resweep.scoreAfter,
        dispositionsConfirmed: resweep.allDispositionsConfirmed,
      },
    }),
    detail,
  };
}

// ---------------------------------------------------------------------------
// Gates with no tooling yet, and gates not started. Recorded explicitly so a
// reader can tell "we checked and it passed" from "nobody has ever checked".
// ---------------------------------------------------------------------------

function attachRemaining(t: TaskRecord): void {
  t.gates["B3"] = {
    status: "pending_no_tooling",
    detail:
      "PASS_TO_PASS regression preservation: reviewer instruction only, not executable",
  };

  // B4 does NOT depend on a reference solution, and an earlier version of this
  // script wrongly marked it not_runnable wherever one was missing. The gate
  // asks whether the ORACLE accepts a second correct fix, which needs only the
  // rendered prompt, an independently written solution, and a run of the
  // oracle against it - all available for a code-gen task with no reference
  // solution on disk. So every task is simply `absent` here: never checked.
  //
  // The hard-tier exception is a separate matter and is recorded, not encoded:
  // where no qualifying model can solve the task, a model failure cannot
  // distinguish an over-strict oracle from a model that could not do it, so
  // the second implementation has to be author-written.
  const seedOk = SEED_VERIFICATION[t.id]?.b1 === "pass";
  const b4 = B4_EVIDENCE[t.id];
  t.gates["B4"] = b4 !== undefined
    ? {
      status: b4.status as GateStatus,
      detail: b4.detail,
      ...(seedOk ? { unblockedBy: "verified seeded reference solution" } : {}),
      ...(b4.outsideFamilies === undefined ? {} : {
        outsideFamilies: Object.fromEntries(
          Object.entries(b4.outsideFamilies).map(([f, v]) => [f, v.model]),
        ),
      }),
      ...(b4.everSolved === undefined ? {} : { everSolvedBy: b4.everSolved }),
    }
    : {
      status: "absent",
      ...(seedOk ? { unblockedBy: "verified seeded reference solution" } : {}),
      detail: t.tier === "hard"
        ? "over-strictness never checked; hard tier, so expect the author-written " +
          "second implementation rather than a model-supplied one"
        : "over-strictness never checked: needs two independent prompt-only solutions, " +
          "neither from the authoring model's family",
    };

  t.gates["B5"] = {
    status: "pending_no_tooling",
    detail: "input/state amplification: no harness exists",
  };
  t.gates["B6"] = {
    status: "absent",
    detail: "blind prompt audit not recorded per-task in a queryable form",
  };
  t.gates["C1"] = {
    status: "absent",
    detail: "clean-room solver gate unbuilt",
  };
}

// ---------------------------------------------------------------------------

function renderMarkdown(tasks: TaskRecord[], generatedAt: string): string {
  const GATES = ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "C1"];
  const glyph: Record<GateStatus, string> = {
    pass: "pass",
    quarantine: "QUAR",
    stale: "stale",
    absent: "-",
    not_runnable: "n/a",
    pending_no_tooling: "n/t",
    inconclusive: "inc",
  };

  const lines: string[] = [];
  lines.push("# Hardening-gate records");
  lines.push("");
  lines.push(
    "Generated by `scripts/gate-records.ts` - do not hand-edit. The queryable",
  );
  lines.push(
    "artifact is `gate-records.json`; this file is a rollup for reading.",
  );
  lines.push("");
  lines.push(`Generated: ${generatedAt}`);
  lines.push("");
  lines.push("Status vocabulary:");
  lines.push("");
  lines.push("| token | meaning |");
  lines.push("|---|---|");
  lines.push("| `pass` | gate ran and the task passed it |");
  lines.push("| `QUAR` | gate ran and the task FAILED it |");
  lines.push(
    "| `stale` | gate ran, but an artifact it depends on changed afterwards - the verdict describes something that no longer exists |",
  );
  lines.push("| `-` | gate has never run for this task |");
  lines.push(
    "| `n/a` | gate CANNOT run for this task as things stand (needs an unblocking step first, named in the JSON `detail`) |",
  );
  lines.push("| `n/t` | no tooling exists for this gate yet |");
  lines.push(
    "| `inc` | ran, but the result was inconclusive (infrastructure) |",
  );
  lines.push("");

  // Per-gate rollup.
  lines.push("## Rollup by gate");
  lines.push("");
  lines.push(
    "| gate | pass | QUAR | stale | inc | never ran | not runnable | no tooling |",
  );
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const g of GATES) {
    const c: Record<string, number> = {};
    for (const t of tasks) {
      const s = t.gates[g]?.status ?? "absent";
      c[s] = (c[s] ?? 0) + 1;
    }
    lines.push(
      `| ${g} | ${c["pass"] ?? 0} | ${c["quarantine"] ?? 0} | ${
        c["stale"] ?? 0
      } | ${c["inconclusive"] ?? 0} | ${c["absent"] ?? 0} | ${
        c["not_runnable"] ?? 0
      } | ${c["pending_no_tooling"] ?? 0} |`,
    );
  }
  lines.push("");

  // Per-tier rollup of the two gates the backfill actually moved.
  lines.push("## B2 determinism and B7 mutation, by tier");
  lines.push("");
  lines.push(
    "| tier | tasks | B2 pass | B2 QUAR | B2 inconclusive | B2 not runnable | B2 never ran " +
      "| B7 pass | B7 QUAR | B7 not measurable | B7 stale | B7 never ran |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const tier of ["hard", "medium", "easy"]) {
    const rows = tasks.filter((t) => t.tier === tier);
    if (rows.length === 0) continue;
    const n = (g: string, s: string) =>
      rows.filter((t) => t.gates[g]?.status === s).length;
    lines.push(
      `| ${tier} | ${rows.length} | ${n("B2", "pass")} | ${
        n("B2", "quarantine")
      } | ${n("B2", "inconclusive")} | ${n("B2", "not_runnable")} | ${
        n("B2", "absent")
      } | ${n("B7", "pass")} | ${n("B7", "quarantine")} | ${
        n("B7", "not_runnable")
      } | ${n("B7", "stale")} | ${n("B7", "absent")} |`,
    );
  }
  lines.push("");

  lines.push("## Per task");
  lines.push("");
  lines.push(`| task | tier | kind | ref? | ${GATES.join(" | ")} |`);
  lines.push(`|---|---|---|---|${GATES.map(() => "---").join("|")}|`);
  for (const t of tasks) {
    const cells = GATES.map((g) =>
      glyph[(t.gates[g]?.status ?? "absent") as GateStatus]
    );
    lines.push(
      `| ${t.id} | ${t.tier} | ${t.kind} | ${
        t.hasReferenceSolution ? "y" : "n"
      } | ${cells.join(" | ")} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const phase1 = await readJson<Phase1File>(
    join(REPO, "scratch", "backfill-phase1-results.json"),
  );
  if (phase1 === undefined) {
    console.warn(
      "[gate-records] no phase-1 results found; B2 will read as never-run",
    );
  }

  const tasks = await inventory();
  for (const t of tasks) {
    await attachB1(t);
    attachB2(t, phase1);
    await attachB7(t);
    attachRemaining(t);
  }

  const generatedAt = new Date().toISOString();
  const payload = {
    schemaVersion: 1,
    generatedAt,
    sources: {
      determinism: "scratch/backfill-phase1-results.json",
      mutation: "scratch/lethal-t1/<id>/report.json",
      probe: "scratch/<id>/.probe.json",
      triage: "scratch/phase2-triage/<id>.survivors.md",
    },
    counts: {
      tasks: tasks.length,
      withReferenceSolution: tasks.filter((t) => t.hasReferenceSolution).length,
    },
    tasks,
  };

  await Deno.writeTextFile(JSON_OUT, JSON.stringify(payload, null, 2));
  await Deno.writeTextFile(MD_OUT, renderMarkdown(tasks, generatedAt));

  console.log(`[gate-records] ${tasks.length} tasks -> ${JSON_OUT}`);
  for (const g of ["B1", "B2", "B7"]) {
    const c: Record<string, number> = {};
    for (const t of tasks) {
      const s = t.gates[g]?.status ?? "absent";
      c[s] = (c[s] ?? 0) + 1;
    }
    console.log(`[gate-records] ${g}: ${JSON.stringify(c)}`);
  }
}

if (import.meta.main) await main();
