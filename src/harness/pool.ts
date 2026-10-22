/**
 * H-41 (design-final 6, 9): the `auto` judging pool. A pooled BcLane whose
 * members join and leave while the run goes on. Inert until bound to a
 * campaign; refresh is single-flight and every join checks an epoch, so a
 * starved queue or a closed pool never gains a member. Each check is bounded.
 *
 * Join: precheck (allocated, not refused or an agent's, not blocked, running,
 * no foreign record, admissible env_fp, pin), claim (the in-use record),
 * setup, revalidation (same provider and container id, env_fp, env pin,
 * still allocated and not blocked), then lane add and health register.
 * Leave (drain marker, coord lease, allocation removed, a departure the lane
 * retired): retire, quiesced, dispose, release. A quarantined container
 * keeps its record; a record the pool cannot prove released is kept.
 */

import * as colors from "@std/fmt/colors";
import { BcLane, type HarnessBc, type Reconciled } from "./bc-lane.ts";
import { bounded } from "./sandbox.ts";

/** H-41 (C4): the bounds; tests inject smaller ones. */
export interface PoolBounds {
  /** Each precheck, revalidation and reconcile step. */
  stepMs: number;
  /** A joining container's setup. */
  setupMs: number;
  /** close() waits this long for in-flight joins and releases. */
  closeMs: number;
  /** The judge queue's refresh poll. */
  pollMs: number;
  /** --pool-wait-min: no member this long with work queued starves the queue. */
  waitMs: number;
}

export const POOL_BOUNDS: PoolBounds = {
  stepMs: 30_000,
  setupMs: 120_000,
  closeMs: 120_000,
  pollMs: 10_000,
  waitMs: 10 * 60_000,
};

/** H-41 (9): what the gated judge queue needs of its pool. */
export interface JudgeGate {
  /** Members now (0 until bound and after close). */
  width(): number;
  /** Re-read the pool (single-flight); never throws. */
  refresh(signal?: AbortSignal): Promise<void>;
  /** Bump the epoch: an in-flight join adds no member. */
  invalidate(): void;
  /** The queue's poll tick (null clears it); close clears it too. */
  poll(tick: (() => void) | null): void;
  readonly bounds: Pick<PoolBounds, "waitMs" | "pollMs">;
}

/** What the pool reads and does outside itself (openHarnessEnv's closures; tests fake them). */
export interface PoolDeps {
  /** allocatedContainers(): the campaign's allocation now. */
  allocated(): Promise<string[]>;
  /** Why the container is never eligible (refused, an agent container), or null. */
  excluded(c: string): string | null;
  /** laneBlocked with the drain dir: a foreign coord lease or a drain marker. */
  blocked(c: string): string | null;
  /** Docker reports it running. */
  running(c: string): Promise<boolean>;
  /** Why another record (another run, a quarantine, a recover) refuses it, or null. */
  foreign(c: string): Promise<string | null>;
  /** checkEnvironments on this container alone. */
  admissible(c: string): Promise<{ env_fp: string } | { why: string }>;
  /** The campaign pin's env_fp, or null (throws when the pin refuses this lineage). */
  pinned(campaign: string): Promise<string | null>;
  /** ensurePin: load or create the campaign pin with this env_fp; throws on a mismatch. */
  ensurePin(campaign: string, envFp: string): Promise<void>;
  /** claimContainer: the in-use record (added to the env's claimed list), or why not. */
  claim(c: string): Promise<{ id: string } | { why: string }>;
  /** releaseOwned, and the claimed entry dropped. */
  release(c: string, id: string): Promise<void>;
  /** The record stays (the env closer does not release it). */
  keep(c: string, why: string): void;
  containerId(c: string): Promise<string>;
  /** setupContainers([c]); its bc must be the lane's; dispose = its slot only. */
  join(c: string): Promise<{ bc: HarnessBc; dispose(): Promise<void> }>;
  /** ContainerHealthMonitor.register. */
  register(c: string): void;
}

type LaneOpts = Omit<
  NonNullable<ConstructorParameters<typeof BcLane>[2]>,
  "pool" | "blocked"
>;

const msg = (err: unknown) => err instanceof Error ? err.message : String(err);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export class JudgePool implements JudgeGate {
  readonly lane: BcLane;
  readonly bounds: PoolBounds;
  private readonly deps: PoolDeps;
  private campaign: string | null = null;
  private closed = false;
  private epoch = 0;
  private inflight: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  /** Members this pool joined: their record id and slot dispose. */
  private readonly joined = new Map<
    string,
    { id: string; dispose(): Promise<void> }
  >();
  private readonly joining = new Set<string>();
  private readonly leaving = new Set<string>();
  /** Records kept: never rejoined in this environment. */
  private readonly kept = new Set<string>();
  /** Given up at close: a late completion touches nothing. */
  private readonly abandoned = new Set<string>();
  private readonly said = new Map<string, string>();
  private readonly work = new Set<Promise<unknown>>();
  private closing: Promise<void> | null = null;

  constructor(o: {
    bc: HarnessBc;
    deps: PoolDeps;
    bounds?: Partial<PoolBounds>;
    lane?: LaneOpts;
  }) {
    this.deps = o.deps;
    this.bounds = { ...POOL_BOUNDS, ...o.bounds };
    this.lane = new BcLane(o.bc, [], {
      ...o.lane,
      pool: this,
      blocked: (c) => this.blockedWhy(c),
    });
  }

  /** H-41 (10): enable the pool for this campaign (a pin of another lineage refuses). */
  async bind(campaign: string): Promise<void> {
    await this.deps.pinned(campaign);
    this.campaign = campaign;
  }

  width(): number {
    return this.campaign === null || this.closed
      ? 0
      : this.lane.members().length;
  }

  invalidate(): void {
    this.epoch++;
  }

  poll(tick: (() => void) | null): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = tick && !this.closed
      ? setInterval(tick, this.bounds.pollMs)
      : undefined;
  }

  refresh(signal?: AbortSignal): Promise<void> {
    return this.inflight ??= this.pass(signal)
      .catch((err) => this.say("*", `refresh failed: ${msg(err)}`))
      .finally(() => {
        this.inflight = null;
      });
  }

  /** H-41 (5, 14): the lane's departure reconcile: three bounded checks per container. */
  async reconcile(
    cs: string[],
  ): Promise<Readonly<Record<string, Reconciled>>> {
    const alloc = this.step(
      "allocation",
      "the pool",
      () => this.deps.allocated(),
    );
    alloc.catch(() => {});
    const out: Record<string, Reconciled> = {};
    await Promise.all(cs.map(async (c) => {
      out[c] = await this.check(c, alloc);
    }));
    return out;
  }

  /** H-41 (9): the first closer: no join after this; in-flight work gets closeMs. */
  close(): Promise<void> {
    return this.closing ??= this.shut();
  }

  private async shut(): Promise<void> {
    this.closed = true;
    this.poll(null);
    this.epoch++;
    let t: ReturnType<typeof setTimeout> | undefined;
    const late = await Promise.race([
      Promise.allSettled([...this.work, this.inflight]).then(() => false),
      new Promise<boolean>((
        r,
      ) => (t = setTimeout(() => r(true), this.bounds.closeMs))),
    ]);
    clearTimeout(t);
    if (!late) return;
    for (const c of new Set([...this.joining, ...this.leaving])) {
      this.abandoned.add(c);
      this.keep(c, `unresolved at close after ${this.bounds.closeMs} ms`);
    }
  }

  private async pass(signal?: AbortSignal): Promise<void> {
    if (this.campaign === null || this.closed) return;
    const ep = this.epoch;
    const live = () => !this.closed && ep === this.epoch && !signal?.aborted;
    let alloc: string[];
    try {
      alloc = await this.step(
        "allocation",
        "the pool",
        () => this.deps.allocated(),
      );
    } catch (err) {
      this.say("*", msg(err));
      return;
    }
    if (!live()) return;
    const allocated = (c: string) => alloc.some((a) => same(a, c));
    // Leaves first: a member blocked, unallocated or retired by the lane.
    for (const c of [...this.joined.keys()]) {
      if (this.leaving.has(c) || this.lane.quarantined.has(c)) continue;
      const why = !this.lane.containers.includes(c)
        ? "left the lane"
        : !allocated(c)
        ? "no longer allocated"
        : this.blockedWhy(c);
      if (why) this.track(this.release(c, why));
    }
    for (const c of alloc) {
      if (!live()) return;
      if (this.joined.has(c) || this.joining.has(c) || this.kept.has(c)) {
        continue;
      }
      const a = await this.precheck(c);
      if ("why" in a) {
        this.say(c, a.why);
        continue;
      }
      if (!live()) return;
      this.joining.add(c);
      const p = this.join(c, a.env_fp, ep).finally(() =>
        this.joining.delete(c)
      );
      this.track(p);
      await p;
    }
  }

  private async precheck(
    c: string,
  ): Promise<{ env_fp: string } | { why: string }> {
    const ex = this.deps.excluded(c);
    if (ex) return { why: ex };
    const q = this.lane.quarantined.get(c);
    if (q !== undefined) return { why: `quarantined: ${q}` };
    const b = this.blockedWhy(c);
    if (b) return { why: b };
    try {
      if (!await this.step("running check", c, () => this.deps.running(c))) {
        return { why: "not running" };
      }
      const f = await this.step("record check", c, () => this.deps.foreign(c));
      if (f) return { why: f };
      const a = await this.step(
        "environment check",
        c,
        () => this.deps.admissible(c),
      );
      if ("why" in a) return a;
      const pin = await this.step(
        "pin check",
        c,
        () => this.deps.pinned(this.campaign!),
      );
      if (pin !== null && pin !== a.env_fp) {
        return {
          why:
            `env_fp ${a.env_fp} differs from campaign ${this.campaign}'s pin ${pin}`,
        };
      }
      return a;
    } catch (err) {
      return { why: msg(err) };
    }
  }

  private async join(c: string, fp: string, ep: number): Promise<void> {
    const stale = () => this.closed || ep !== this.epoch;
    let claim: { id: string } | { why: string };
    try {
      claim = await this.step("claim", c, () => this.deps.claim(c));
    } catch (err) {
      this.say(c, msg(err));
      return;
    }
    if ("why" in claim) {
      this.say(c, claim.why);
      return;
    }
    // Before setup nothing touched the container: the record goes.
    if (stale()) return await this.drop(c, claim.id);
    let ready: { bc: HarnessBc; dispose(): Promise<void> };
    try {
      ready = await bounded(
        this.deps.join(c),
        this.bounds.setupMs,
        `setup of ${c}`,
      );
    } catch (err) {
      if (!this.abandoned.has(c)) this.keep(c, `setup failed: ${msg(err)}`);
      return;
    }
    if (this.abandoned.has(c)) return;
    if (stale()) return await this.dispose(c, ready, claim.id);
    const why = await this.revalidate(c, claim.id, fp, ready.bc);
    if (this.abandoned.has(c)) return;
    if (why) {
      await ready.dispose().catch(() => {});
      this.keep(c, `revalidation failed: ${why}`);
      return;
    }
    if (stale()) return await this.dispose(c, ready, claim.id);
    this.lane.add(c);
    this.deps.register(c);
    this.joined.set(c, { id: claim.id, dispose: ready.dispose });
    this.said.delete(c);
    console.log(
      `${colors.green("[JOIN]")} judging pool: ${c} (env_fp ${
        fp.slice(0, 12)
      })`,
    );
  }

  private async revalidate(
    c: string,
    id: string,
    fp: string,
    bc: HarnessBc,
  ): Promise<string | null> {
    if (bc !== this.lane.bc) {
      return "setup returned another BC provider than the lane's";
    }
    try {
      const now = await this.step(
        "container id",
        c,
        () => this.deps.containerId(c),
      );
      if (now !== id) return `container id changed from ${id} to ${now}`;
      const a = await this.step(
        "environment check",
        c,
        () => this.deps.admissible(c),
      );
      if ("why" in a) return a.why;
      if (a.env_fp !== fp) {
        return `env_fp changed from ${fp} to ${a.env_fp} since the precheck`;
      }
      await this.step(
        "env pin",
        c,
        () => this.deps.ensurePin(this.campaign!, a.env_fp),
      );
      const alloc = await this.step(
        "allocation",
        c,
        () => this.deps.allocated(),
      );
      if (!alloc.some((x) => same(x, c))) return "no longer allocated";
      return this.blockedWhy(c);
    } catch (err) {
      return msg(err);
    }
  }

  private async release(c: string, why: string): Promise<void> {
    this.leaving.add(c);
    try {
      this.lane.retire(c);
      console.log(`${colors.cyan("[LEAVE]")} judging pool: ${c}: ${why}`);
      await this.lane.quiesced(c);
      const m = this.joined.get(c);
      if (!m || this.abandoned.has(c)) return;
      try {
        await m.dispose();
      } catch (err) {
        this.keep(c, `dispose failed: ${msg(err)}`);
        return;
      }
      await this.drop(c, m.id);
      this.joined.delete(c);
    } finally {
      this.leaving.delete(c);
    }
  }

  /** Dispose a set-up slot nobody will use, then release its record. */
  private async dispose(
    c: string,
    ready: { dispose(): Promise<void> },
    id: string,
  ): Promise<void> {
    try {
      await ready.dispose();
    } catch (err) {
      this.keep(c, `dispose failed: ${msg(err)}`);
      return;
    }
    await this.drop(c, id);
  }

  private async drop(c: string, id: string): Promise<void> {
    try {
      await this.deps.release(c, id);
    } catch (err) {
      this.keep(c, `release failed: ${msg(err)}`);
    }
  }

  private keep(c: string, why: string): void {
    this.kept.add(c);
    this.deps.keep(c, why);
    console.warn(
      `${
        colors.yellow("[WARN]")
      } judging pool: ${c}: in-use record kept (${why}); it refuses ${c} until harness recover`,
    );
  }

  private async check(
    c: string,
    alloc: Promise<string[]>,
  ): Promise<Reconciled> {
    const ask = async <T>(check: string, p: () => Promise<T>) => {
      try {
        return { v: await p() };
      } catch (err) {
        return { check, error: msg(err) };
      }
    };
    const [run, al] = await Promise.all([
      ask(
        "running",
        () => this.step("running check", c, () => this.deps.running(c)),
      ),
      ask("allocation", () => alloc),
    ]);
    let blocked: string | null = null;
    let blockedErr: string | null = null;
    try {
      blocked = this.deps.blocked(c);
    } catch (err) {
      blockedErr = msg(err);
    }
    if ("v" in run && !run.v) {
      return { state: "departed", reason: "not running" };
    }
    if ("v" in al && !al.v.some((x) => same(x, c))) {
      return { state: "departed", reason: "no longer allocated" };
    }
    if (blocked) return { state: "departed", reason: blocked };
    if (!("v" in run)) return { state: "unanswered", ...run };
    if (!("v" in al)) return { state: "unanswered", ...al };
    if (blockedErr) {
      return { state: "unanswered", check: "blocked", error: blockedErr };
    }
    return { state: "ok" };
  }

  /** The lane's blocked predicate; an unreadable state blocks (fail closed). */
  private blockedWhy(c: string): string | null {
    try {
      return this.deps.blocked(c);
    } catch (err) {
      return `blocked check failed: ${msg(err)}`;
    }
  }

  private async step<T>(
    what: string,
    c: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const name = `${what} of ${c}`;
    try {
      return await bounded(fn(), this.bounds.stepMs, name);
    } catch (err) {
      const m = msg(err);
      throw new Error(m.includes(name) ? m : `${name}: ${m}`);
    }
  }

  private say(c: string, why: string): void {
    if (this.said.get(c) === why) return;
    this.said.set(c, why);
    console.warn(
      `${colors.yellow("[WARN]")} judging pool: ${
        c === "*" ? why : `${c} not admitted: ${why}`
      }`,
    );
  }

  private track(p: Promise<unknown>): void {
    this.work.add(p);
    void p.finally(() => this.work.delete(p)).catch(() => {});
  }
}
