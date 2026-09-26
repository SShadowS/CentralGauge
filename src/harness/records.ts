/**
 * Harness Bench records (spec 1a sections 6 and 8): immutable JSON under
 * results/harness/. An execution is one attempt of one (task, repeat, arm)
 * cell; a rerun adds an execution, a rejudge adds a judgment.
 *
 * Layout:
 *   campaigns/<campaign-id>.json
 *   executions/<campaign-id>/<execution-id>.json
 *   artifacts/<execution-id>.json          association: execution -> workspace
 *   workspaces/<workspace-hash>/           content-addressed copy (Part 2)
 *   judgments/<execution-id>/<judgment-id>.json
 *
 * Identical workspace bytes from two executions share one workspace copy but
 * have two artifact associations and separate judgments, so a rejudge of one
 * execution never changes another's result.
 *
 * Publication is crash-safe: write `<name>.tmp-<uuid>`, hard-link it to the
 * final name (fails if it exists: no replace), remove the temp file. A crash
 * leaves at most a temp file, which readers ignore and `sweepTemp` removes.
 */

import { join, relative, SEPARATOR } from "@std/path";
import { z } from "zod";
import { ValidationError } from "../errors.ts";
import { type Experiment, ExperimentSchema } from "./config.ts";
import { hashJson } from "./hash.ts";
import { Sha256Hex, TaskSetIdentitySchema } from "./identity.ts";
import { ResolvedManifestSchema } from "./manifest.ts";
import { mulberry32 } from "./stats.ts";
import { TASK_KINDS, TaskLimitsSchema } from "./task.ts";

/** Lower-case hex SHA-256 (a workspace hash becomes a path in Part 2). */
/** Lower-case only: ids become file names, and Windows folds case. */
const Uuid = z.uuid().refine((s) => s === s.toLowerCase(), "lower-case uuid");
const Iso = z.iso.datetime();
const n = z.number().nonnegative().nullable();

export const TERMINATIONS = [
  "completed",
  "timeout",
  "budget_exhausted",
  "refusal",
  "usage_limited",
  "harness_crash",
  "setup_failed",
] as const;
export const VERDICTS = ["pass", "fail", "unscored"] as const;
export const RUN_KINDS = ["planned", "auto_retry", "manual_rerun"] as const;

/**
 * Run totals from the harness (spec 1a section 5). Every field nullable.
 * `cost_usd` is the primary-metric input and must be the list-price estimate
 * from reported tokens (decided 2026-09-24): a non-null value needs
 * cost_source "estimated" and a pricing snapshot. A harness's own figure goes
 * in `reported_cost_usd` only.
 */
const TelemetryFields = z.strictObject({
  harness_version: z.string().nullable(),
  cost_usd: n,
  cost_source: z.literal("estimated").nullable(),
  pricing_snapshot: z.string().min(1).nullable(),
  reported_cost_usd: n,
  per_model: z.array(z.strictObject({
    model: z.string(),
    requests: n,
    tokens_in_uncached: n,
    tokens_cache_read: n,
    tokens_cache_write: n,
    tokens_out: n,
    tokens_reasoning: n,
    cost_usd: n,
  })),
  turns: n,
  compactions: n,
  wall_ms: n,
  exit_code: z.number().int().nullable(),
  stop_reason: z.string().nullable(),
  refusal_detected: z.boolean().nullable(),
  /** Harness usage payload as reported; always written, null if none. */
  raw_usage: z.json(),
});
/** Telemetry field names; `incomplete_telemetry` may only list these. */
export const TelemetryField = TelemetryFields.keyof();
export const TelemetrySchema = TelemetryFields.refine(
  (t) =>
    t.cost_usd === null ||
    (t.cost_source === "estimated" && t.pricing_snapshot !== null),
  {
    message: "cost_usd needs cost_source estimated and a pricing_snapshot",
    path: ["cost_usd"],
  },
);
export type Telemetry = z.output<typeof TelemetrySchema>;

/**
 * Independent validity flags; both empty/false means complete. The field
 * list names which declared metrics are missing (metrics contract, spec 1a
 * section 5), so a missing `turns` never looks like a missing primary cost.
 */
export const OBSERVED_FIELDS = [
  "harness_version",
  "models",
  "loaded_components",
] as const;

export const ValiditySchema = z.strictObject({
  incomplete_telemetry: z.array(TelemetryField),
  /**
   * Observed fields the harness could not verify (execution `v: 2`, M1-22):
   * required in `v: 2`, absent in `v: 1` (reads as `[]`).
   */
  incomplete_observed: z.array(z.enum(OBSERVED_FIELDS)).optional(),
  infra_exposed: z.boolean(),
}).refine((v) =>
  new Set(v.incomplete_telemetry).size ===
    v.incomplete_telemetry.length, {
  message: "duplicate field",
  path: ["incomplete_telemetry"],
}).refine((v) =>
  v.incomplete_observed === undefined ||
  new Set(v.incomplete_observed).size === v.incomplete_observed.length, {
  message: "duplicate field",
  path: ["incomplete_observed"],
});

export const ExecutionRecordSchema = z.strictObject({
  /** 1: Part 1; 2: Part 2 (M1-22), adds validity.incomplete_observed. */
  v: z.union([z.literal(1), z.literal(2)]),
  id: Uuid,
  campaign_id: Uuid,
  block: z.number().int().nonnegative(),
  order_in_block: z.number().int().nonnegative(),
  arm: z.string(),
  task_id: z.string(),
  task_visible_hash: Sha256Hex,
  repeat: z.number().int().positive(),
  /** Unique per cell: planned = 1, auto retry = parent + 1, manual = next. */
  attempt: z.number().int().positive(),
  run_kind: z.enum(RUN_KINDS),
  /** The execution an automatic retry retries; null otherwise. */
  retry_of: Uuid.nullable(),
  started_at: Iso,
  ended_at: Iso,
  /** Hash of the campaign arm template this execution belongs to. */
  arm_manifest_hash: Sha256Hex,
  /** The execution manifest: arm template with task-effective limits. */
  manifest: ResolvedManifestSchema,
  /** What actually ran; filled by the adapter (Part 2). */
  observed: z.strictObject({
    harness_version: z.string().nullable(),
    models: z.array(z.string()).nullable(),
    loaded_components: z.array(z.string()).nullable(),
  }),
  termination: z.enum(TERMINATIONS),
  /**
   * The agent acted before stopping: any model request, tool call, file
   * read or edit, or build attempt. Not "changed the workspace".
   */
  did_work: z.boolean(),
  validity: ValiditySchema,
  /** Spec 1b section 6: whether image attachments reached the model. */
  image_attachments: z.enum(["none", "delivered", "unsupported", "unknown"]),
  telemetry: TelemetrySchema,
  trace_path: z.string().nullable(),
  host_log_path: z.string().nullable(),
  raw_log_path: z.string().nullable(),
  container_assignments: z.array(z.string()),
  /** Hash of the frozen workspace; null when nothing was frozen. */
  workspace_hash: Sha256Hex.nullable(),
}).superRefine((e, ctx) => {
  if (e.v === 2 && e.validity.incomplete_observed === undefined) {
    ctx.addIssue({
      code: "custom",
      message: "execution v2 needs validity.incomplete_observed",
      path: ["validity", "incomplete_observed"],
    });
  }
  if (e.v === 1 && e.validity.incomplete_observed !== undefined) {
    ctx.addIssue({
      code: "custom",
      message: "execution v1 carries no validity.incomplete_observed",
      path: ["validity", "incomplete_observed"],
    });
  }
  const bad = (message: string) =>
    ctx.addIssue({ code: "custom", message, path: ["run_kind"] });
  if (e.run_kind === "planned" && (e.attempt !== 1 || e.retry_of !== null)) {
    bad("planned execution is attempt 1 with no retry_of");
  }
  if (e.run_kind === "auto_retry" && (e.attempt < 2 || e.retry_of === null)) {
    bad("auto_retry needs retry_of and attempt >= 2");
  }
  if (e.run_kind === "manual_rerun" && (e.attempt < 2 || e.retry_of !== null)) {
    bad("manual_rerun has attempt >= 2 and no retry_of");
  }
  if (
    e.validity.incomplete_telemetry.includes("cost_usd") &&
    e.telemetry.cost_usd !== null
  ) {
    ctx.addIssue({
      code: "custom",
      message: "cost_usd is declared incomplete but has a value",
      path: ["validity", "incomplete_telemetry"],
    });
  }
  if (
    e.telemetry.cost_usd === null &&
    !e.validity.incomplete_telemetry.includes("cost_usd")
  ) {
    ctx.addIssue({
      code: "custom",
      message: "cost_usd is null but not declared incomplete",
      path: ["validity", "incomplete_telemetry"],
    });
  }
});
export type ExecutionRecord = z.output<typeof ExecutionRecordSchema>;

/** Observed fields left unverified (`[]` for a `v: 1` record). */
export const incompleteObserved = (e: ExecutionRecord): string[] =>
  e.validity.incomplete_observed ?? [];

export const ArtifactRecordSchema = z.strictObject({
  v: z.literal(1),
  execution_id: Uuid,
  workspace_hash: Sha256Hex,
  /** Content-addressed copy, e.g. workspaces/<workspace_hash>. */
  stored_path: z.string().min(1),
  created_at: Iso,
});
export type ArtifactRecord = z.output<typeof ArtifactRecordSchema>;

export const TestResultSchema = z.strictObject({
  codeunit: z.number().int(),
  procedure: z.string(),
  /** What the procedure ran against (spec 1a section 7, test-authoring). */
  target: z.string().regex(/^(candidate|reference|mutant:[A-Za-z0-9_-]+)$/),
  outcome: z.enum(["pass", "fail", "error", "not_run"]),
  /** Why it did not pass; a compile error or infra fault is not a kill. */
  failure: z.enum(["assertion", "compile", "runtime_error", "infra"])
    .nullable(),
}).refine((t) => (t.outcome === "pass") === (t.failure === null), {
  message: "failure is set exactly when the outcome is not pass",
  path: ["failure"],
});

/**
 * Verdict from scorer results (decision 2026-09-25-verdict-fail-wins): any
 * false scorer fails the judgment (null scorers stay null in the record);
 * otherwise any null is unscored; otherwise pass.
 */
export function verdictOf(
  scorers: readonly { passed: boolean | null }[],
): "pass" | "fail" | "unscored" {
  if (scorers.some((s) => s.passed === false)) return "fail";
  return scorers.some((s) => s.passed === null) ? "unscored" : "pass";
}

export const JudgmentRecordSchema = z.strictObject({
  v: z.literal(1),
  id: Uuid,
  execution_id: Uuid,
  workspace_hash: Sha256Hex,
  task_id: z.string(),
  task_oracle_hash: Sha256Hex,
  scorer_versions: z.record(z.string(), z.string()),
  /** scorerFingerprint(scorer_versions); checked in M1-07b. */
  scorer_fingerprint: Sha256Hex,
  scorers: z.array(z.strictObject({
    name: z.string(),
    /** null = infra fault, not a fail (GH #13 rule). */
    passed: z.boolean().nullable(),
    tests: z.array(TestResultSchema),
  })).min(1).refine(
    (ss) => new Set(ss.map((s) => s.name)).size === ss.length,
    "duplicate scorer name",
  ),
  verdict: z.enum(VERDICTS),
  verdict_container: z.string().nullable(),
  started_at: Iso,
  ended_at: Iso,
}).refine((j) => j.verdict === verdictOf(j.scorers), {
  message: "verdict disagrees with scorer results",
  path: ["verdict"],
});
export type JudgmentRecord = z.output<typeof JudgmentRecordSchema>;

export const BlockSchema = z.strictObject({
  index: z.number().int().nonnegative(),
  task_id: z.string(),
  repeat: z.number().int().positive(),
  order: z.array(z.string()).min(1),
});
export type Block = z.output<typeof BlockSchema>;

export const CampaignRecordSchema = z.strictObject({
  v: z.literal(1),
  id: Uuid,
  experiment: ExperimentSchema,
  experiment_hash: Sha256Hex,
  created_at: Iso,
  /** mulberry32 seed; wider values would alias (seed >>> 0). */
  seed: z.number().int().min(0).max(0xffffffff),
  /**
   * Historical executions reused on explicit request (--reuse-history).
   * The shape is frozen, but Part 1 cannot load or map them, so it must be
   * empty until Part 2 implements reuse.
   */
  reuse: z.array(z.strictObject({
    campaign_id: Uuid,
    execution_id: Uuid,
  })).max(0, "historical reuse is not supported before Part 2"),
  task_set: TaskSetIdentitySchema,
  /**
   * Per task: `kind` and `coupling` for report slices (not hashed), and the
   * task limits, so M1-07b can check each execution's exact limits (the
   * limits are also inside the task's visible hash).
   */
  tasks_meta: z.array(z.strictObject({
    id: z.string(),
    kind: z.enum(TASK_KINDS),
    coupling: z.array(z.string()),
    limits: TaskLimitsSchema,
  })),
  arms: z.array(z.strictObject({
    config_id: z.string(),
    manifest_hash: Sha256Hex,
    manifest: ResolvedManifestSchema,
  })).min(2),
  /** The full plan (every task x repeat). Staged runs execute subsets of it. */
  blocks: z.array(BlockSchema).min(1),
}).superRefine((c, ctx) => {
  const issue = (message: string, path: (string | number)[]) =>
    ctx.addIssue({ code: "custom", message, path });
  if (c.task_set.provisional) {
    issue("campaign needs a non-provisional task set (symbols lock)", [
      "task_set",
    ]);
  }
  const armIds = c.arms.map((a) => a.config_id);
  const declared = [c.experiment.baseline, ...c.experiment.variants];
  if ([...armIds].sort().join() !== [...declared].sort().join()) {
    issue("arms must be exactly the experiment's baseline and variants", [
      "arms",
    ]);
  }
  c.arms.forEach((a, i) => {
    if (a.manifest.config_id !== a.config_id) {
      issue("arm manifest belongs to another config", ["arms", i]);
    }
  });
  const taskIds = c.task_set.tasks.map((t) => t.id).sort();
  const dupTasks = taskIds.filter((t, i) => taskIds.indexOf(t) !== i);
  if (dupTasks.length > 0) {
    issue(`duplicate task ${[...new Set(dupTasks)].join(", ")}`, [
      "task_set",
    ]);
  }
  const metaIds = new Set(c.tasks_meta.map((t) => t.id));
  if (
    metaIds.size !== c.tasks_meta.length ||
    metaIds.size !== new Set(taskIds).size ||
    !taskIds.every((t) => metaIds.has(t))
  ) {
    issue("tasks_meta must list exactly the task-set tasks", ["tasks_meta"]);
  }
  const want = new Set(
    taskIds.flatMap((t) =>
      Array.from({ length: c.experiment.repeats }, (_, r) => `${t}#${r + 1}`)
    ),
  );
  const seen = new Set<string>();
  const arms = [...armIds].sort().join();
  c.blocks.forEach((b, i) => {
    const k = `${b.task_id}#${b.repeat}`;
    if (b.index !== i) {
      issue("block index must equal its position", ["blocks", i]);
    }
    if (seen.has(k)) issue(`duplicate block ${k}`, ["blocks", i]);
    if (!want.has(k)) {
      issue(`block ${k} is not in task set x repeats`, ["blocks", i]);
    }
    seen.add(k);
    if ([...b.order].sort().join() !== arms) {
      issue("block order must be a permutation of the arms", [
        "blocks",
        i,
        "order",
      ]);
    }
  });
  if (seen.size !== want.size) {
    issue("blocks must cover every task x repeat exactly once", ["blocks"]);
  }
});
export type CampaignRecord = z.output<typeof CampaignRecordSchema>;

export type Termination = (typeof TERMINATIONS)[number];
export type RunKind = (typeof RUN_KINDS)[number];

export interface OutcomePolicy {
  /** Send the artifact to the verdict pipeline. false = unscored. */
  judge: boolean;
  /** once: one automatic retry. after_usage_reset: pause, then retry the cell. */
  retry: "none" | "once" | "after_usage_reset";
}

/** Spec 1a section 8. Lives here so M1-07b can validate retries. */
export function outcomePolicy(
  termination: Termination,
  didWork: boolean,
): OutcomePolicy {
  switch (termination) {
    case "completed":
    case "timeout":
    case "budget_exhausted":
    case "refusal":
      return { judge: true, retry: "none" };
    case "harness_crash":
      return didWork
        ? { judge: true, retry: "none" }
        : { judge: false, retry: "once" };
    case "setup_failed":
      return { judge: false, retry: "once" };
    case "usage_limited":
      return { judge: false, retry: "after_usage_reset" };
  }
}

/** A root execution (planned or manual_rerun) and its auto_retry descendants. */
export interface RetryChain {
  root: ExecutionRecord;
  /** Root first, then each automatic retry in ancestry order. */
  members: ExecutionRecord[];
}

/**
 * Group one cell's executions into retry chains by `retry_of` ancestry, not
 * by label. Each auto_retry joins the chain of its parent; an execution
 * whose parent is missing, or that has two children, is returned in
 * `orphans` for M1-07b to report.
 */
export function retryChains(
  cell: ExecutionRecord[],
): { chains: RetryChain[]; orphans: ExecutionRecord[] } {
  const children = new Map<string, ExecutionRecord[]>();
  for (const e of cell) {
    if (e.retry_of !== null) {
      children.set(e.retry_of, [...(children.get(e.retry_of) ?? []), e]);
    }
  }
  const chains: RetryChain[] = [];
  const placed = new Set<string>();
  for (const root of cell.filter((e) => e.retry_of === null)) {
    const members = [root];
    placed.add(root.id);
    let at = root;
    while ((children.get(at.id) ?? []).length === 1) {
      at = children.get(at.id)![0]!;
      members.push(at);
      placed.add(at.id);
    }
    chains.push({ root, members });
  }
  return { chains, orphans: cell.filter((e) => !placed.has(e.id)) };
}

/**
 * Whether `member` is an allowed automatic retry of `parent`: the parent's
 * termination allows a retry, and a "once" retry is not used twice in a row.
 */
export function retryProblem(
  parent: ExecutionRecord,
  member: ExecutionRecord,
  grandparent: ExecutionRecord | undefined,
): string | null {
  const p = outcomePolicy(parent.termination, parent.did_work);
  if (p.retry === "none") {
    return `automatic retry ${member.id} of an execution that ended ${parent.termination}`;
  }
  if (
    p.retry === "once" && parent.run_kind === "auto_retry" && grandparent &&
    outcomePolicy(grandparent.termination, grandparent.did_work).retry ===
      "once"
  ) {
    return `second automatic retry ${member.id}: the one retry was used`;
  }
  return null;
}

/** The fingerprint a judgment stores for its scorer versions. */
export function scorerFingerprint(
  versions: Record<string, string>,
): Promise<string> {
  return hashJson({ scorer_versions: versions });
}

/** The stored experiment_hash of a campaign. */
export function experimentHash(e: Experiment): Promise<string> {
  return hashJson({ experiment: e });
}

/**
 * One block per (task, repeat), repeat-major so a partial campaign covers
 * every task at repeat 1 first. Arm order inside a block is a seeded
 * Fisher-Yates shuffle (spec 1a section 6, D17).
 */
export function planBlocks(
  taskIds: string[],
  repeats: number,
  arms: string[],
  seed: number,
): Block[] {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError(`seed must be an integer in 0..0xffffffff: ${seed}`);
  }
  const rand = mulberry32(seed);
  const blocks: Block[] = [];
  for (let repeat = 1; repeat <= repeats; repeat++) {
    for (const task_id of [...taskIds].sort()) {
      const order = [...arms];
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
      blocks.push({ index: blocks.length, task_id, repeat, order });
    }
  }
  return blocks;
}

const TMP = ".tmp-";

/** Ids become path segments: only a uuid may, so no path leaves the store. */
function safeId(id: string, what: string): string {
  if (!Uuid.safeParse(id).success) {
    throw new ValidationError(`${what} id is not a lower-case uuid: ${id}`, [
      id,
    ]);
  }
  return id;
}

async function removeBestEffort(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch {
    // A leftover temp file is invisible to readers; sweepTemp removes it.
  }
}

async function publishOnce(path: string, value: unknown): Promise<void> {
  await Deno.mkdir(join(path, ".."), { recursive: true });
  const tmp = `${path}${TMP}${crypto.randomUUID()}`;
  const file = await Deno.open(tmp, { write: true, createNew: true });
  try {
    try {
      const bytes = new TextEncoder().encode(
        JSON.stringify(value, null, 2) + "\n",
      );
      for (let off = 0; off < bytes.length;) {
        off += await file.write(bytes.subarray(off));
      }
      // Durable before it becomes visible, so a power loss cannot publish an
      // empty or truncated record under the final name.
      await file.sync();
    } finally {
      file.close();
    }
    await Deno.link(tmp, path);
  } catch (err) {
    await removeBestEffort(tmp);
    if (err instanceof Deno.errors.AlreadyExists) {
      throw new ValidationError(
        `record is immutable, already exists: ${path}`,
        [path],
      );
    }
    throw err;
  }
  // Published; failing to remove the temp name must not report a failure.
  await removeBestEffort(tmp);
}

/**
 * lstat every component from the store root down to `path`, refusing links
 * and junctions (as hash.ts does). NotFound propagates.
 */
async function lstatNoLinks(
  root: string,
  path: string,
): Promise<Deno.FileInfo> {
  const parts = relative(root, path).split(SEPARATOR).filter((x) => x !== "");
  let at = root;
  let info: Deno.FileInfo | undefined;
  for (const next of [root, ...parts.map((x) => (at = join(at, x)))]) {
    info = await Deno.lstat(next);
    if (info.isSymlink) {
      throw new ValidationError(`refusing link or reparse point: ${next}`, [
        next,
      ]);
    }
  }
  return info!;
}

/**
 * Read and validate one record. `expect` pins fields to the record's
 * location (file name, folder), so a hand-moved or copied record fails
 * loudly instead of joining another execution or campaign. NotFound
 * propagates; everything else names the file.
 */
async function readRecord<T extends z.ZodType>(
  root: string,
  path: string,
  schema: T,
  expect: Record<string, string>,
): Promise<z.output<T>> {
  if (!(await lstatNoLinks(root, path)).isFile) {
    throw new ValidationError(`not a record file: ${path}`, [path]);
  }
  let raw: unknown;
  try {
    const bytes = await Deno.readFile(path);
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`Invalid record ${path}: ${msg}`, [msg]);
  }
  const result = schema.safeParse(raw);
  const errors = result.success
    ? Object.entries(expect).filter(([k, v]) =>
      (result.data as Record<string, unknown>)[k] !== v
    ).map(([k, v]) => `${k}: does not match its location (${v})`)
    : result.error.issues.map((i) =>
      `${i.path.join(".") || "(root)"}: ${i.message}`
    );
  if (errors.length > 0) {
    throw new ValidationError(
      `Invalid record ${path}:\n  ${errors.join("\n  ")}`,
      errors,
    );
  }
  return result.data as z.output<T>;
}

/**
 * Every record in `dir`; `expect(stem)` gives the location-pinned fields.
 * Only a missing folder means "none". Temp files are skipped; any other
 * entry that is not a plain `.json` file, and a record that vanishes
 * mid-listing, is an error naming it.
 */
async function readAll<T extends z.ZodType>(
  root: string,
  dir: string,
  schema: T,
  expect: (stem: string) => Record<string, string>,
): Promise<z.output<T>[]> {
  try {
    if (!(await lstatNoLinks(root, dir)).isDirectory) {
      throw new ValidationError(`not a record folder: ${dir}`, [dir]);
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
  const out: z.output<T>[] = [];
  for await (const e of Deno.readDir(dir)) {
    const path = join(dir, e.name);
    if (e.isFile && e.name.includes(TMP)) continue;
    if (!e.isFile || !e.name.endsWith(".json")) {
      throw new ValidationError(
        `unexpected entry in record folder (link, folder or non-record file): ${path}`,
        [path],
      );
    }
    const stem = e.name.slice(0, -".json".length);
    try {
      out.push(await readRecord(root, path, schema, expect(stem)));
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
      throw new ValidationError(`record vanished while listing: ${path}`, [
        path,
      ]);
    }
  }
  return out;
}

/**
 * Exact order of two UTC ISO datetimes (z.iso.datetime: "Z" only, seconds
 * optional, any number of fractional digits). Not a string compare, since
 * precision varies, and not Date.parse alone, which rounds to milliseconds.
 */
export function compareInstant(a: string, b: string): number {
  const split = (s: string): [number, string] => {
    const m = /^(.*?)(?:\.(\d+))?Z$/.exec(s);
    const at = m ? Date.parse(`${m[1]}Z`) : NaN;
    if (Number.isNaN(at)) {
      throw new ValidationError(`not a UTC datetime: ${s}`, [s]);
    }
    return [at, m![2] ?? ""];
  };
  const [sa, fa] = split(a);
  const [sb, fb] = split(b);
  if (sa !== sb) return sa - sb;
  const w = Math.max(fa.length, fb.length);
  const [pa, pb] = [fa.padEnd(w, "0"), fb.padEnd(w, "0")];
  return pa < pb ? -1 : pa > pb ? 1 : 0;
}

/** Ascending by exact instant, then id. */
function byInstant<R extends { id: string }>(at: (r: R) => string) {
  return (a: R, b: R) =>
    compareInstant(at(a), at(b)) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Validating, write-once record store rooted at results/harness. */
export class RecordStore {
  constructor(readonly root: string) {}

  writeCampaign(c: CampaignRecord): Promise<void> {
    const r = CampaignRecordSchema.parse(c);
    return publishOnce(join(this.root, "campaigns", `${r.id}.json`), r);
  }

  writeExecution(e: ExecutionRecord): Promise<void> {
    const r = ExecutionRecordSchema.parse(e);
    return publishOnce(
      join(this.root, "executions", r.campaign_id, `${r.id}.json`),
      r,
    );
  }

  writeArtifact(a: ArtifactRecord): Promise<void> {
    const r = ArtifactRecordSchema.parse(a);
    return publishOnce(
      join(this.root, "artifacts", `${r.execution_id}.json`),
      r,
    );
  }

  writeJudgment(j: JudgmentRecord): Promise<void> {
    const r = JudgmentRecordSchema.parse(j);
    return publishOnce(
      join(this.root, "judgments", r.execution_id, `${r.id}.json`),
      r,
    );
  }

  /** Campaigns of one experiment, newest first (ties by id). */
  async campaigns(experimentId: string): Promise<CampaignRecord[]> {
    const all = await readAll(
      this.root,
      join(this.root, "campaigns"),
      CampaignRecordSchema,
      (id) => ({ id }),
    );
    const oldest = byInstant<CampaignRecord>((c) => c.created_at);
    return all.filter((c) => c.experiment.id === experimentId)
      .sort((a, b) => oldest(b, a));
  }

  /** Executions of one campaign, by started_at then id. */
  async executions(campaignId: string): Promise<ExecutionRecord[]> {
    const campaign_id = safeId(campaignId, "campaign");
    return (await readAll(
      this.root,
      join(this.root, "executions", campaign_id),
      ExecutionRecordSchema,
      (id) => ({ id, campaign_id }),
    )).sort(byInstant((e) => e.started_at));
  }

  /**
   * Executions of every campaign (estimates borrow samples across
   * experiments by arm manifest hash), by started_at then id.
   */
  async allExecutions(): Promise<ExecutionRecord[]> {
    const dir = join(this.root, "executions");
    try {
      if (!(await lstatNoLinks(this.root, dir)).isDirectory) {
        throw new ValidationError(`not a record folder: ${dir}`, [dir]);
      }
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return [];
      throw err;
    }
    const out: ExecutionRecord[] = [];
    for await (const e of Deno.readDir(dir)) {
      if (!e.isDirectory) {
        throw new ValidationError(
          `unexpected entry in executions folder: ${join(dir, e.name)}`,
          [e.name],
        );
      }
      out.push(...await this.executions(e.name));
    }
    return out.sort(byInstant((e) => e.started_at));
  }

  /** The artifact association of one execution, or null. */
  async artifact(executionId: string): Promise<ArtifactRecord | null> {
    const execution_id = safeId(executionId, "execution");
    try {
      return await readRecord(
        this.root,
        join(this.root, "artifacts", `${execution_id}.json`),
        ArtifactRecordSchema,
        { execution_id },
      );
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) return null;
      throw err;
    }
  }

  /** Judgments of one execution, by started_at then id. */
  async judgments(executionId: string): Promise<JudgmentRecord[]> {
    const execution_id = safeId(executionId, "execution");
    return (await readAll(
      this.root,
      join(this.root, "judgments", execution_id),
      JudgmentRecordSchema,
      (id) => ({ id, execution_id }),
    )).sort(byInstant((j) => j.started_at));
  }

  /** Remove temp files left by an interrupted publish. Returns the count. */
  async sweepTemp(): Promise<number> {
    let removed = 0;
    const walkDir = async (dir: string): Promise<void> => {
      try {
        for await (const e of Deno.readDir(dir)) {
          const p = join(dir, e.name);
          if (e.isDirectory) await walkDir(p);
          else if (e.name.includes(TMP)) {
            await Deno.remove(p);
            removed++;
          }
        }
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) throw err;
      }
    };
    await walkDir(this.root);
    return removed;
  }
}
