/**
 * Coordination state for the Harness Bench autonomous run.
 *
 * Plain files under one root outside every worktree. No file has two writers:
 * - tasks/<id>/task.md                 orchestrator (YAML header + brief)
 * - tasks/<id>/runs/<NNN>/claim.json   claiming lane, created exclusively
 * - tasks/<id>/runs/<NNN>/checkpoint.json  run owner, replaced atomically
 * - tasks/<id>/runs/<NNN>/terminal.json    run owner or orchestrator, exclusive
 * - tasks/<id>/runs/<NNN>/review.json      orchestrator, exclusive
 * - tasks/<id>/accepted.json           orchestrator, exclusive
 * - leases/<container>/<NNN>/lease.json|release.json|hb.json
 * - questions/<qid>.md, questions/<qid>.answer.md
 *
 * Exclusivity comes from `mkdir` (non-recursive) and `createNew`. An
 * unreadable or half-written record is "unknown", never "free".
 *
 * Runbook: docs/superpowers/runbooks/harness-autonomy/README.md
 */
import { parseArgs } from "@std/cli/parse-args";
import { join } from "@std/path";
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";

export const PROTOCOL = 1;
export const RUN_STALE_MIN = 15;
export const LEASE_STALE_MIN = 10;

const ID_RE = /^[A-Z][A-Z0-9]*-[0-9]{2,3}[a-z]?$/;
const NAME_RE = /^[A-Za-z][A-Za-z0-9-]{0,40}$/;
const RUN_RE = /^[0-9]{3}$/;
const QID_RE = /^q-[0-9]{8}T[0-9]{6}-[0-9a-f]{8}$/;
const enc = new TextEncoder();

export class CoordError extends Error {}

export interface TaskHeader {
  id: string;
  lane: string;
  deps: string[];
  resources?: string[] | undefined;
}

export type TaskStateName =
  | "todo"
  | "doing"
  | "review"
  | "accepted"
  | "unknown";

export interface Checkpoint {
  phase: string;
  wait?: string | undefined;
  note?: string | undefined;
  at: number;
}

export interface TaskState {
  id: string;
  lane: string;
  state: TaskStateName;
  attempts: number;
  runId?: string | undefined;
  runLane?: string | undefined;
  claimedAt?: number | undefined;
  checkpoint?: Checkpoint | undefined;
  terminal?: { kind: string | undefined; commit?: string; reason?: string };
}

// ---------- file primitives ----------

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0;; i++) {
    try {
      return await fn();
    } catch (e) {
      const transient = e instanceof Deno.errors.PermissionDenied ||
        e instanceof Deno.errors.Busy;
      if (!transient || i >= 5) throw e;
      await new Promise((r) => setTimeout(r, 50 * 2 ** i));
    }
  }
}

async function writeExclusive(path: string, data: unknown): Promise<void> {
  let file: Deno.FsFile;
  try {
    file = await Deno.open(path, { write: true, createNew: true });
  } catch (e) {
    if (e instanceof Deno.errors.AlreadyExists) {
      throw new CoordError(`already exists: ${path}`);
    }
    throw e;
  }
  try {
    const bytes = enc.encode(
      typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n",
    );
    let off = 0;
    while (off < bytes.length) off += await file.write(bytes.subarray(off));
    await file.sync();
  } finally {
    file.close();
  }
}

async function writeReplace(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.${crypto.randomUUID()}.tmp`;
  await writeExclusive(tmp, data);
  await withRetry(() => Deno.rename(tmp, path));
}

async function mkdirExclusive(path: string): Promise<boolean> {
  try {
    await Deno.mkdir(path);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.AlreadyExists) return false;
    throw e;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    throw e;
  }
}

/** Missing file -> null. Unreadable or corrupt -> CoordError (caller maps to "unknown"). */
async function readJson<T>(path: string): Promise<T | null> {
  let text: string;
  try {
    text = await withRetry(() => Deno.readTextFile(path));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw new CoordError(`unreadable: ${path}: ${e}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new CoordError(`corrupt: ${path}`);
  }
}

async function listDir(path: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const e of Deno.readDir(path)) names.push(e.name);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return [];
    throw e;
  }
  return names.sort();
}

function group(m: RegExpMatchArray | null, i: number, what: string): string {
  const v = m?.[i];
  if (v === undefined) throw new CoordError(`cannot parse ${what}`);
  return v;
}

function last<T>(xs: T[], what: string): T {
  const v = xs[xs.length - 1];
  if (v === undefined) throw new CoordError(`empty ${what}`);
  return v;
}

function stamp(now = new Date()): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "");
}

// ---------- root ----------

export async function initRoot(root: string, campaign: string): Promise<void> {
  if (await exists(join(root, "coord.json"))) {
    throw new CoordError(`root already initialized: ${root}`);
  }
  await Deno.mkdir(root, { recursive: true });
  for (const d of ["tasks", "leases", "questions", "decisions"]) {
    await Deno.mkdir(join(root, d), { recursive: true });
  }
  await writeExclusive(join(root, "coord.json"), {
    protocol: PROTOCOL,
    campaign,
    createdAt: new Date().toISOString(),
  });
}

async function openRoot(root: string): Promise<void> {
  const meta = await readJson<{ protocol: number }>(join(root, "coord.json"));
  if (!meta) {
    throw new CoordError(
      `no coord root at ${root} (refusing to auto-create; run init deliberately)`,
    );
  }
  if (meta.protocol !== PROTOCOL) {
    throw new CoordError(`protocol ${meta.protocol} != ${PROTOCOL} at ${root}`);
  }
}

// ---------- tasks ----------

function taskDir(root: string, id: string): string {
  if (!ID_RE.test(id)) throw new CoordError(`bad task id: ${id}`);
  return join(root, "tasks", id);
}

function runDir(root: string, id: string, runId: string): string {
  if (!RUN_RE.test(runId)) throw new CoordError(`bad run id: ${runId}`);
  return join(taskDir(root, id), "runs", runId);
}

export async function addTask(
  root: string,
  header: TaskHeader,
  body: string,
): Promise<void> {
  await openRoot(root);
  if (!NAME_RE.test(header.lane)) {
    throw new CoordError(`bad lane: ${header.lane}`);
  }
  for (const d of header.deps) {
    if (!ID_RE.test(d)) throw new CoordError(`bad dep id: ${d}`);
  }
  const dir = taskDir(root, header.id);
  if (!(await mkdirExclusive(dir))) {
    throw new CoordError(`task exists: ${header.id}`);
  }
  await Deno.mkdir(join(dir, "runs"));
  const yaml = stringifyYaml({ ...header, resources: header.resources ?? [] });
  await writeExclusive(join(dir, "task.md"), `---\n${yaml}---\n\n${body}\n`);
}

async function readHeader(root: string, id: string): Promise<TaskHeader> {
  const text = await Deno.readTextFile(join(taskDir(root, id), "task.md"));
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) throw new CoordError(`task ${id}: missing YAML header`);
  const h = parseYaml(group(m, 1, `task ${id} header`)) as TaskHeader;
  if (h.id !== id) throw new CoordError(`task ${id}: header id ${h.id}`);
  return { ...h, deps: h.deps ?? [] };
}

async function taskIds(root: string): Promise<string[]> {
  return (await listDir(join(root, "tasks"))).filter((n) => ID_RE.test(n));
}

export async function taskState(root: string, id: string): Promise<TaskState> {
  const h = await readHeader(root, id);
  const base: TaskState = { id, lane: h.lane, state: "todo", attempts: 0 };
  try {
    if (await exists(join(taskDir(root, id), "accepted.json"))) {
      const runs = (await listDir(join(taskDir(root, id), "runs"))).filter((
        r,
      ) => RUN_RE.test(r));
      return {
        ...base,
        state: "accepted",
        attempts: runs.length,
        runId: runs.at(-1),
      };
    }
    const runs = (await listDir(join(taskDir(root, id), "runs"))).filter((r) =>
      RUN_RE.test(r)
    );
    if (runs.length === 0) return base;
    const runId = last(runs, "runs");
    const rd = runDir(root, id, runId);
    const claimRec = await readJson<{ lane: string; at: number }>(
      join(rd, "claim.json"),
    );
    const st: TaskState = { ...base, attempts: runs.length, runId };
    if (!claimRec) return { ...st, state: "unknown" };
    st.runLane = claimRec.lane;
    st.claimedAt = claimRec.at;
    st.checkpoint = (await readJson<Checkpoint>(join(rd, "checkpoint.json"))) ??
      undefined;
    const term = await readJson<TaskState["terminal"]>(
      join(rd, "terminal.json"),
    );
    if (!term) return { ...st, state: "doing" };
    st.terminal = term;
    if (term.kind !== "submitted") return { ...st, state: "todo" };
    const review = await readJson<{ verdict: string }>(join(rd, "review.json"));
    if (!review) return { ...st, state: "review" };
    return { ...st, state: "todo" };
  } catch (e) {
    if (e instanceof CoordError) return { ...base, state: "unknown" };
    throw e;
  }
}

export async function status(
  root: string,
  lane?: string,
): Promise<TaskState[]> {
  await openRoot(root);
  const out: TaskState[] = [];
  for (const id of await taskIds(root)) {
    const st = await taskState(root, id);
    if (!lane || st.lane === lane) out.push(st);
  }
  return out;
}

async function depsAccepted(root: string, h: TaskHeader): Promise<string[]> {
  const unmet: string[] = [];
  for (const d of h.deps) {
    if (!(await exists(join(taskDir(root, d), "task.md")))) unmet.push(d);
    else if ((await taskState(root, d)).state !== "accepted") unmet.push(d);
  }
  return unmet;
}

export async function next(root: string, lane: string): Promise<TaskState[]> {
  const out: TaskState[] = [];
  for (const st of await status(root, lane)) {
    if (st.state !== "todo") continue;
    const unmet = await depsAccepted(root, await readHeader(root, st.id));
    if (unmet.length === 0) out.push(st);
  }
  return out;
}

export async function claim(
  root: string,
  id: string,
  lane: string,
): Promise<{ runId: string; token: string }> {
  await openRoot(root);
  const h = await readHeader(root, id);
  if (h.lane !== lane) {
    throw new CoordError(`task ${id} belongs to lane ${h.lane}, not ${lane}`);
  }
  const st = await taskState(root, id);
  if (st.state !== "todo") {
    throw new CoordError(`task ${id} is ${st.state}, cannot claim`);
  }
  const unmet = await depsAccepted(root, h);
  if (unmet.length) {
    throw new CoordError(`task ${id} has unmet deps: ${unmet.join(", ")}`);
  }
  const runId = String(st.attempts + 1).padStart(3, "0");
  const rd = runDir(root, id, runId);
  if (!(await mkdirExclusive(rd))) {
    throw new CoordError(`lost claim race for ${id}/${runId}`);
  }
  const token = crypto.randomUUID();
  const taskText = await Deno.readTextFile(join(taskDir(root, id), "task.md"));
  const rev = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(taskText))),
  ).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  await writeExclusive(join(rd, "claim.json"), {
    runId,
    token,
    lane,
    at: Date.now(),
    taskRev: rev,
  });
  return { runId, token };
}

async function ownedRun(
  root: string,
  id: string,
  runId: string,
  token: string,
): Promise<string> {
  const rd = runDir(root, id, runId);
  const c = await readJson<{ token: string }>(join(rd, "claim.json"));
  if (!c) throw new CoordError(`no claim for ${id}/${runId}`);
  if (c.token !== token) {
    throw new CoordError(`token mismatch for ${id}/${runId}`);
  }
  if (await exists(join(rd, "terminal.json"))) {
    throw new CoordError(`${id}/${runId} already terminal`);
  }
  return rd;
}

export async function checkpoint(
  root: string,
  id: string,
  runId: string,
  token: string,
  phase: string,
  opts: { wait?: string | undefined; note?: string | undefined } = {},
): Promise<void> {
  const rd = await ownedRun(root, id, runId, token);
  await writeReplace(join(rd, "checkpoint.json"), {
    phase,
    ...opts,
    at: Date.now(),
  });
}

export async function submit(
  root: string,
  id: string,
  runId: string,
  token: string,
  commit: string,
  branch: string,
): Promise<void> {
  const rd = await ownedRun(root, id, runId, token);
  await writeExclusive(join(rd, "terminal.json"), {
    kind: "submitted",
    commit,
    branch,
    at: Date.now(),
  });
}

export async function fail(
  root: string,
  id: string,
  runId: string,
  token: string,
  reason: string,
): Promise<void> {
  const rd = await ownedRun(root, id, runId, token);
  await writeExclusive(join(rd, "terminal.json"), {
    kind: "failed",
    reason,
    at: Date.now(),
  });
}

/** Orchestrator only: close a run whose owner is gone. */
export async function abandon(
  root: string,
  id: string,
  runId: string,
  reason: string,
): Promise<void> {
  const rd = runDir(root, id, runId);
  await writeExclusive(join(rd, "terminal.json"), {
    kind: "abandoned",
    reason,
    at: Date.now(),
  });
}

async function latestSubmitted(
  root: string,
  id: string,
  runId: string,
): Promise<string> {
  const st = await taskState(root, id);
  if (st.runId !== runId) {
    throw new CoordError(`${id}/${runId} is not the latest run (${st.runId})`);
  }
  if (st.state !== "review") {
    throw new CoordError(`${id}/${runId} is ${st.state}, not review`);
  }
  return runDir(root, id, runId);
}

/** Orchestrator only: after review and integration into master. */
export async function accept(
  root: string,
  id: string,
  runId: string,
  integratedSha: string,
): Promise<void> {
  const rd = await latestSubmitted(root, id, runId);
  await writeExclusive(join(rd, "review.json"), {
    verdict: "accepted",
    integratedSha,
    at: Date.now(),
  });
  await writeExclusive(join(taskDir(root, id), "accepted.json"), {
    runId,
    integratedSha,
    at: Date.now(),
  });
}

/** Orchestrator only: the task returns to todo for a new attempt. */
export async function reject(
  root: string,
  id: string,
  runId: string,
  reason: string,
): Promise<void> {
  const rd = await latestSubmitted(root, id, runId);
  await writeExclusive(join(rd, "review.json"), {
    verdict: "rejected",
    reason,
    at: Date.now(),
  });
}

// ---------- questions ----------

export async function ask(
  root: string,
  text: string,
  opts: { task?: string | undefined; from?: string | undefined } = {},
): Promise<string> {
  await openRoot(root);
  if (opts.task && !ID_RE.test(opts.task)) {
    throw new CoordError(`bad task id: ${opts.task}`);
  }
  const qid = `q-${stamp()}-${crypto.randomUUID().slice(0, 8)}`;
  const header = stringifyYaml({
    id: qid,
    task: opts.task ?? null,
    from: opts.from ?? null,
    at: new Date().toISOString(),
  });
  await writeExclusive(
    join(root, "questions", `${qid}.md`),
    `---\n${header}---\n\n${text}\n`,
  );
  return qid;
}

export async function answer(
  root: string,
  qid: string,
  text: string,
): Promise<void> {
  if (!QID_RE.test(qid)) throw new CoordError(`bad question id: ${qid}`);
  if (!(await exists(join(root, "questions", `${qid}.md`)))) {
    throw new CoordError(`no question ${qid}`);
  }
  await writeExclusive(
    join(root, "questions", `${qid}.answer.md`),
    `${text}\n`,
  );
}

export async function openQuestions(
  root: string,
): Promise<{ id: string; task: string | null; text: string }[]> {
  await openRoot(root);
  const names = await listDir(join(root, "questions"));
  const out = [];
  for (const n of names) {
    const m = n.match(/^(q-.+)\.md$/);
    if (
      !m || n.endsWith(".answer.md") || names.includes(`${m?.[1]}.answer.md`)
    ) {
      continue;
    }
    const raw = await Deno.readTextFile(join(root, "questions", n));
    const hm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n\r?\n?([\s\S]*)$/);
    const h = hm?.[1]
      ? parseYaml(hm[1]) as { task: string | null }
      : { task: null };
    out.push({
      id: group(m, 1, n),
      task: h.task,
      text: (hm?.[2] ?? raw).trim(),
    });
  }
  return out;
}

// ---------- leases ----------

function leaseRoot(root: string, container: string): string {
  if (!NAME_RE.test(container)) {
    throw new CoordError(`bad container name: ${container}`);
  }
  return join(root, "leases", container);
}

export async function leaseHolder(
  root: string,
  container: string,
): Promise<
  { lane: string; attempt: string; at: number; hb?: number | undefined } | null
> {
  const lr = leaseRoot(root, container);
  const attempts = (await listDir(lr)).filter((a) => RUN_RE.test(a));
  if (attempts.length === 0) return null;
  const a = last(attempts, "lease attempts");
  const rec = await readJson<{ lane: string; at: number }>(
    join(lr, a, "lease.json"),
  );
  if (!rec) {
    throw new CoordError(
      `lease ${container}/${a} has no lease.json: unknown holder`,
    );
  }
  if (await exists(join(lr, a, "release.json"))) return null;
  const hb = await readJson<{ at: number }>(join(lr, a, "hb.json"));
  return { lane: rec.lane, attempt: a, at: rec.at, hb: hb?.at };
}

export async function lease(
  root: string,
  container: string,
  lane: string,
): Promise<{ attempt: string; token: string }> {
  await openRoot(root);
  if (!NAME_RE.test(lane)) throw new CoordError(`bad lane: ${lane}`);
  const lr = leaseRoot(root, container);
  await Deno.mkdir(lr, { recursive: true });
  const holder = await leaseHolder(root, container);
  if (holder) {
    throw new CoordError(
      `${container} held by ${holder.lane} since ${
        new Date(holder.at).toISOString()
      }`,
    );
  }
  const attempts = (await listDir(lr)).filter((a) => RUN_RE.test(a));
  const attempt = String(attempts.length + 1).padStart(3, "0");
  if (!(await mkdirExclusive(join(lr, attempt)))) {
    throw new CoordError(`${container} held (lost lease race)`);
  }
  const token = crypto.randomUUID();
  await writeExclusive(join(lr, attempt, "lease.json"), {
    lane,
    token,
    at: Date.now(),
  });
  return { attempt, token };
}

async function ownedLease(
  root: string,
  container: string,
  token: string,
): Promise<string> {
  const lr = leaseRoot(root, container);
  const holder = await leaseHolder(root, container);
  if (!holder) throw new CoordError(`${container} is not leased`);
  const rec = await readJson<{ token: string }>(
    join(lr, holder.attempt, "lease.json"),
  );
  if (rec?.token !== token) {
    throw new CoordError(`token mismatch for lease ${container}`);
  }
  return join(lr, holder.attempt);
}

export async function heartbeat(
  root: string,
  container: string,
  token: string,
): Promise<void> {
  const dir = await ownedLease(root, container, token);
  await writeReplace(join(dir, "hb.json"), { at: Date.now() });
}

export async function release(
  root: string,
  container: string,
  token: string,
): Promise<void> {
  const dir = await ownedLease(root, container, token);
  await writeExclusive(join(dir, "release.json"), { at: Date.now() });
}

// ---------- diagnostics ----------

export async function why(root: string, id: string): Promise<string[]> {
  await openRoot(root);
  const reasons: string[] = [];
  const seen = new Set<string>();
  async function walk(tid: string, depth: number) {
    if (seen.has(tid)) return;
    seen.add(tid);
    const pad = "  ".repeat(depth);
    if (!(await exists(join(taskDir(root, tid), "task.md")))) {
      reasons.push(`${pad}${tid}: missing task`);
      return;
    }
    const st = await taskState(root, tid);
    if (tid !== id && st.state === "accepted") return;
    const who = st.runLane ? ` by ${st.runLane} (run ${st.runId})` : "";
    const cp = st.checkpoint
      ? `, phase ${st.checkpoint.phase}${
        st.checkpoint.wait ? ` waiting on ${st.checkpoint.wait}` : ""
      }`
      : "";
    reasons.push(`${pad}${tid}: ${st.state}${who}${cp}`);
    for (const d of (await readHeader(root, tid)).deps) {
      await walk(d, depth + 1);
    }
  }
  await walk(id, 0);
  for (const q of await openQuestions(root)) {
    if (q.task && seen.has(q.task)) {
      reasons.push(
        `open question ${q.id} (${q.task}): ${q.text.split("\n")[0]}`,
      );
    }
  }
  return reasons;
}

export async function stale(
  root: string,
  opts: { now?: number } = {},
): Promise<string[]> {
  await openRoot(root);
  const now = opts.now ?? Date.now();
  const out: string[] = [];
  for (const st of await status(root)) {
    if (st.state !== "doing") continue;
    const last = st.checkpoint?.at ?? st.claimedAt ?? 0;
    const min = Math.floor((now - last) / 60000);
    if (min >= RUN_STALE_MIN) {
      out.push(
        `${st.id} run ${st.runId} (${st.runLane}): no checkpoint for ${min} min`,
      );
    }
  }
  for (const c of await listDir(join(root, "leases"))) {
    const h = await leaseHolder(root, c);
    if (!h) continue;
    const min = Math.floor((now - (h.hb ?? h.at)) / 60000);
    if (min >= LEASE_STALE_MIN) {
      out.push(
        `lease ${c} (${h.lane}): no heartbeat for ${min} min (report only, never transferred)`,
      );
    }
  }
  return out;
}

export async function doctor(root: string): Promise<string[]> {
  await openRoot(root);
  const issues: string[] = [];
  const ids = await taskIds(root);
  const graph = new Map<string, string[]>();
  for (const id of ids) {
    try {
      const h = await readHeader(root, id);
      graph.set(id, h.deps);
      for (const d of h.deps) {
        if (!ids.includes(d)) issues.push(`${id}: dep ${d} does not exist`);
      }
    } catch (e) {
      issues.push(`${id}: ${e instanceof Error ? e.message : e}`);
    }
    for (const r of await listDir(join(taskDir(root, id), "runs"))) {
      if (!RUN_RE.test(r)) continue;
      if (!(await exists(join(runDir(root, id, r), "claim.json")))) {
        issues.push(
          `${id}/${r}: run dir without claim.json (crash during claim? orchestrator: abandon)`,
        );
      }
    }
  }
  const color = new Map<string, number>();
  const visit = (n: string, path: string[]) => {
    if (color.get(n) === 2) return;
    if (color.get(n) === 1) {
      issues.push(`cycle: ${[...path, n].join(" -> ")}`);
      return;
    }
    color.set(n, 1);
    for (const d of graph.get(n) ?? []) {
      if (graph.has(d)) visit(d, [...path, n]);
    }
    color.set(n, 2);
  };
  for (const id of ids) visit(id, []);
  return issues;
}

// ---------- CLI ----------

function rootFromEnv(): string {
  const r = Deno.env.get("CG_COORD_ROOT");
  if (!r) throw new CoordError("CG_COORD_ROOT is not set");
  return r;
}

function printTable(rows: TaskState[]) {
  for (const r of rows) {
    const extra = [
      r.runLane ? `by ${r.runLane}` : "",
      r.checkpoint
        ? `phase=${r.checkpoint.phase}${
          r.checkpoint.wait ? ` wait=${r.checkpoint.wait}` : ""
        }`
        : "",
      r.terminal?.commit ? `commit=${r.terminal.commit.slice(0, 10)}` : "",
    ].filter(Boolean).join(" ");
    console.log(
      `${r.id.padEnd(8)} ${r.lane.padEnd(9)} ${r.state.padEnd(9)} run=${
        r.runId ?? "-"
      } ${extra}`,
    );
  }
}

function arg(rest: string[], i: number): string {
  const v = rest[i];
  if (v === undefined) throw new CoordError(`missing argument ${i + 1}`);
  return v;
}

async function main(args: string[]): Promise<number> {
  const a = parseArgs(args, {
    string: ["lane", "wait", "note", "task", "from", "campaign"],
    boolean: ["json"],
  });
  const [cmd, ...rest] = a._.map(String);
  const initDir = rest[0];
  const root = cmd === "init" && initDir ? initDir : rootFromEnv();
  const out = (v: unknown) => console.log(JSON.stringify(v, null, 2));
  switch (cmd) {
    case "init":
      await initRoot(root, a.campaign ?? "harness-bench");
      out({ ok: true, root });
      return 0;
    case "add": {
      const file = arg(rest, 0);
      const text = await Deno.readTextFile(file);
      const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
      if (!m) throw new CoordError(`${file}: missing YAML header`);
      await addTask(
        root,
        parseYaml(group(m, 1, file)) as TaskHeader,
        group(m, 2, file).trim(),
      );
      out({ ok: true });
      return 0;
    }
    case "status": {
      const rows = await status(root, a.lane);
      a.json ? out(rows) : printTable(rows);
      return 0;
    }
    case "next":
      out((await next(root, arg(rest, 0))).map((t) => t.id));
      return 0;
    case "why":
      console.log((await why(root, arg(rest, 0))).join("\n"));
      return 0;
    case "claim":
      out(await claim(root, arg(rest, 0), arg(rest, 1)));
      return 0;
    case "checkpoint":
      await checkpoint(
        root,
        arg(rest, 0),
        arg(rest, 1),
        arg(rest, 2),
        arg(rest, 3),
        {
          wait: a.wait,
          note: a.note,
        },
      );
      out({ ok: true });
      return 0;
    case "submit":
      await submit(
        root,
        arg(rest, 0),
        arg(rest, 1),
        arg(rest, 2),
        arg(rest, 3),
        arg(rest, 4),
      );
      out({ ok: true });
      return 0;
    case "fail":
      await fail(root, arg(rest, 0), arg(rest, 1), arg(rest, 2), arg(rest, 3));
      out({ ok: true });
      return 0;
    case "abandon":
      await abandon(root, arg(rest, 0), arg(rest, 1), arg(rest, 2));
      out({ ok: true });
      return 0;
    case "accept":
      await accept(root, arg(rest, 0), arg(rest, 1), arg(rest, 2));
      out({ ok: true });
      return 0;
    case "reject":
      await reject(root, arg(rest, 0), arg(rest, 1), arg(rest, 2));
      out({ ok: true });
      return 0;
    case "ask":
      out({
        id: await ask(root, arg(rest, 0), { task: a.task, from: a.from }),
      });
      return 0;
    case "answer":
      await answer(root, arg(rest, 0), arg(rest, 1));
      out({ ok: true });
      return 0;
    case "questions":
      out(await openQuestions(root));
      return 0;
    case "lease":
      out(await lease(root, arg(rest, 0), arg(rest, 1)));
      return 0;
    case "heartbeat":
      await heartbeat(root, arg(rest, 0), arg(rest, 1));
      out({ ok: true });
      return 0;
    case "release":
      await release(root, arg(rest, 0), arg(rest, 1));
      out({ ok: true });
      return 0;
    case "holder":
      out(await leaseHolder(root, arg(rest, 0)));
      return 0;
    case "stale":
      console.log((await stale(root)).join("\n") || "(nothing stale)");
      return 0;
    case "doctor": {
      const issues = await doctor(root);
      console.log(issues.join("\n") || "[OK] no issues");
      return issues.length ? 1 : 0;
    }
    default:
      console.error(
        "usage: coord <init|add|status|next|why|claim|checkpoint|submit|fail|abandon|accept|reject|ask|answer|questions|lease|heartbeat|release|holder|stale|doctor> ...",
      );
      return 2;
  }
}

if (import.meta.main) {
  try {
    Deno.exit(await main(Deno.args));
  } catch (e) {
    console.error(`[FAIL] ${e instanceof Error ? e.message : e}`);
    Deno.exit(e instanceof CoordError ? 1 : 3);
  }
}
