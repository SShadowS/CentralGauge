/**
 * cg-al backend (spec 1a section 5 item 4; M0-05 carryover): per-execution
 * token kept as a SHA-256 digest (constant-time compare); opaque execution
 * id mapped to one canonical approved workspace; live-safe snapshot copy;
 * snapshot validated against trusted app identities before any BC call;
 * streamed body with a hard limit; one request at a time per execution;
 * revocation drains the in-flight request; allowed bind addresses only.
 */

import { join, SEPARATOR } from "@std/path";
import { z } from "zod";
import type { SymbolPackage } from "./identity.ts";
import {
  HARNESS_FIXTURE_TEST_RANGE,
  HARNESS_FORBIDDEN_IDS,
  HARNESS_TEST_APP_RANGE,
} from "../constants.ts";
import { dockerContextEnv } from "../container/docker-context.ts";
import {
  ConfigurationError,
  ContainerError,
  ValidationError,
} from "../errors.ts";
import { isInfraError } from "../health/is-infra-error.ts";
import { InfraRetriesExhaustedError } from "../parallel/errors.ts";
import {
  type BcLane,
  buildApps,
  deployAndTest,
  type DeployContext,
  LaneCancelledError,
  type LockedSymbols,
  prepareApps,
} from "./bc-lane.ts";
import {
  CopyLimitError,
  type CopyLimits,
  exists,
  safeCopyTree,
  validatedDir,
} from "./fsutil.ts";
import { bounded, type DockerCli, OP_TIMEOUT_MS } from "./sandbox.ts";
import { hashTree, isTaskBuildArtifact } from "./hash.ts";
import { readAppGraph, readAppJson, type StagedApp } from "./staging.ts";
import { TEST_APP, testCodeunits, validateApps } from "./verdict-workspace.ts";

export const BACKEND_VERSION = "cg-al-backend@1";
export const MAX_BODY_BYTES = 64 * 1024;

export interface BackendGrant {
  executionId: string;
  /** Sandbox container paused for each snapshot; null only in unit tests without a sandbox. */
  sandbox: string | null;
  /** Called when the sandbox cannot be unpaused: the runner stops the execution. */
  onFault?(reason: string): void;
  workspace: string;
  pristine: string;
  /** The staged workspace's app identities: the only apps the backend builds. */
  trusted: StagedApp[];
  symbols: SymbolPackage[];
  lock: LockedSymbols;
  deploy: DeployContext;
  hostLog: string;
}

export interface HostLogLine {
  v: 1;
  request: string;
  execution: string;
  op: string;
  status: number;
  outcome: "ok" | "failed" | "infra" | "rejected" | "error";
  at: string;
  spans: Record<string, number>;
  apps_compiled: string[];
  per_app_compiles: number;
  diagnostics: number;
  tests_run: number;
  tests_failed: number;
  container: string | null;
  retries: number;
  message?: string;
}

export interface OpContext {
  grant: BackendGrant;
  snapshot: string;
  apps: StagedApp[];
  requestId: string;
  workDir: string;
  /** Aborted when the grant is revoked past its grace. */
  signal: AbortSignal;
}

export interface OpResult {
  body: Record<string, unknown>;
  log: Partial<HostLogLine> & { outcome: "ok" | "failed" };
}

export interface BackendOps {
  compile(ctx: OpContext, apps: string[]): Promise<OpResult>;
  test(ctx: OpContext, codeunits: number[]): Promise<OpResult>;
}

const agentCodeunit = (n: number) =>
  n >= HARNESS_TEST_APP_RANGE.start && n <= HARNESS_TEST_APP_RANGE.end &&
  !(n >= HARNESS_FIXTURE_TEST_RANGE.start &&
    n <= HARNESS_FIXTURE_TEST_RANGE.end) &&
  !(HARNESS_FORBIDDEN_IDS as readonly number[]).includes(n);

const CompileBody = z.strictObject({
  apps: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9 ]{0,63}$/)).max(32)
    .default([]),
});
const TestBody = z.strictObject({
  codeunits: z.array(
    z.number().int().refine(agentCodeunit, "not a visible test codeunit"),
  ).max(64).default([]),
});
const SymbolsBody = z.strictObject({});

export async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}

const NO_DIGEST = new Uint8Array(32);
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Identity and band checks of a snapshot against the trusted apps. */
export async function checkSnapshot(
  snapshot: string,
  trusted: StagedApp[],
  symbolIds: ReadonlySet<string>,
): Promise<string[]> {
  const v: string[] = [];
  let apps: StagedApp[];
  try {
    apps = await readAppGraph(snapshot);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    return [err.message];
  }
  const known = new Map(trusted.map((t) => [t.folder, t]));
  for (const a of apps) {
    if (!known.has(a.folder)) v.push(`${a.folder}: not an app of this task`);
  }
  for (const t of trusted) {
    const aj = await readAppJson(join(snapshot, t.folder, "app.json")).catch(
      () => null,
    );
    if (!aj) {
      v.push(`${t.folder}: app.json missing or unreadable`);
      continue;
    }
    if (aj.id.toLowerCase() !== t.id) {
      v.push(`${t.folder}: id changed from ${t.id} to ${aj.id}`);
    }
    if (aj.name !== t.name) {
      v.push(`${t.folder}: name changed from ${t.name} to ${aj.name}`);
    }
    if (aj.publisher !== t.publisher) v.push(`${t.folder}: publisher changed`);
    if (JSON.stringify(aj.idRanges) !== JSON.stringify(t.idRanges)) {
      v.push(`${t.folder}: idRanges changed`);
    }
  }
  v.push(...await validateApps(snapshot, trusted, apps, symbolIds));
  return v;
}

interface GrantState {
  g: BackendGrant;
  digest: Uint8Array;
  expiresAt: number;
  inflight: Promise<unknown> | null;
  seq: number;
  /** Rejections get their own ids (rejected_<n>), never reusing a request's. */
  rejections: number;
  canonical: string;
  /** Set synchronously by revoke; checked synchronously right before admission. */
  closing: boolean;
  abort: AbortController;
}

async function drainedWithin(
  p: Promise<unknown>,
  ms: number,
): Promise<boolean> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p.then(() => true, () => true),
      new Promise<boolean>((r) => (t = setTimeout(() => r(false), ms))),
    ]);
  } finally {
    clearTimeout(t);
  }
}

/** Read a body stream up to `max` bytes within `ms`; null when longer, "timeout" when it stalls. */
async function readLimited(
  req: Request,
  max: number,
  ms: number,
): Promise<string | null | "timeout"> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const deadline = performance.now() + ms;
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    let t: ReturnType<typeof setTimeout> | undefined;
    const next = await Promise.race([
      reader.read(),
      new Promise<"timeout">((
        r,
      ) => (t = setTimeout(
        () => r("timeout"),
        Math.max(0, deadline - performance.now()),
      ))),
    ]).finally(() => clearTimeout(t));
    if (next === "timeout") {
      await reader.cancel().catch(() => {});
      return "timeout";
    }
    if (next.done) break;
    n += next.value.length;
    if (n > max) {
      await reader.cancel();
      return null;
    }
    parts.push(next.value);
  }
  const all = new Uint8Array(n);
  let off = 0;
  for (const p of parts) {
    all.set(p, off);
    off += p.length;
  }
  return new TextDecoder().decode(all);
}

/** Drive-letter paths replaced before a message reaches the agent. */
function scrubHostPaths(message: string): string {
  return message.replace(/[A-Za-z]:[\\/][^\s"'`]*/g, "<host path>");
}

export class Backend {
  private readonly grants = new Map<string, GrantState>();
  /** Revoked executions whose request did not drain: their id cannot be granted again yet. */
  private readonly draining = new Set<string>();
  private readonly now: () => number;

  constructor(
    private readonly o: {
      approvedRoots: string[];
      workRoot: string;
      ops: BackendOps;
      /** Container-facing addresses the server may bind (the nat gateway; loopback in tests). */
      allowedHosts: string[];
      /** Pauses the sandbox for each snapshot (quiescence, review round 2 item 1). */
      docker?: DockerCli;
      opTimeoutMs?: number;
      bodyTimeoutMs?: number;
      revokeGraceMs?: number;
      /** End-to-end deadline of one request (compile admission, compiles, publish and tests). */
      requestDeadlineMs?: number;
      /** Limits of the snapshot copy (agent-controlled size): exceeding them is a 422. */
      copyLimits?: CopyLimits;
      now?: () => number;
    },
  ) {
    this.now = o.now ?? (() => Date.now());
  }

  async grant(g: BackendGrant, ttlMs: number): Promise<string> {
    const canonical = await validatedDir(g.workspace);
    const roots = await Promise.all(
      this.o.approvedRoots.map((r) => validatedDir(r)),
    );
    if (!roots.some((r) => canonical.startsWith(r + SEPARATOR))) {
      throw new ValidationError(
        `grant refused: ${canonical} is outside the approved roots`,
        [canonical],
      );
    }
    if (this.grants.has(g.executionId)) {
      throw new ValidationError(
        `grant refused: execution ${g.executionId} is already granted`,
        [g.executionId],
      );
    }
    if (this.draining.has(g.executionId)) {
      throw new ValidationError(
        `grant refused: execution ${g.executionId} is still draining a request`,
        [g.executionId],
      );
    }
    const token = [...crypto.getRandomValues(new Uint8Array(32))]
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    this.grants.set(g.executionId, {
      g: { ...g, workspace: canonical },
      digest: await sha256(token),
      expiresAt: this.now() + ttlMs,
      inflight: null,
      seq: 0,
      rejections: 0,
      canonical,
      closing: false,
      abort: new AbortController(),
    });
    return token;
  }

  /**
   * Stop accepting requests at once, wait for the one in flight up to the
   * grace, then abort it and wait once more. Returns whether it drained.
   */
  async revoke(executionId: string): Promise<boolean> {
    const st = this.grants.get(executionId);
    this.grants.delete(executionId);
    if (!st) return true;
    st.closing = true;
    if (!st.inflight) return true;
    const grace = this.o.revokeGraceMs ?? 30_000;
    if (await drainedWithin(st.inflight, grace)) return true;
    st.abort.abort(new Error("grant revoked"));
    const inflight = st.inflight;
    if (await drainedWithin(inflight, grace)) return true;
    // Not drained: the id stays unusable until that request settles.
    this.draining.add(executionId);
    void inflight.finally(() => this.draining.delete(executionId));
    return false;
  }

  private async append(g: BackendGrant, line: HostLogLine) {
    await Deno.mkdir(join(g.hostLog, ".."), { recursive: true });
    await Deno.writeTextFile(g.hostLog, JSON.stringify(line) + "\n", {
      append: true,
      create: true,
    });
  }

  private line(
    st: GrantState,
    op: string,
    status: number,
    outcome: HostLogLine["outcome"],
    t0: number,
    extra: Partial<HostLogLine> = {},
  ): HostLogLine {
    return {
      v: 1,
      request: `br_${st.seq}`,
      execution: st.g.executionId,
      op,
      status,
      outcome,
      at: new Date().toISOString(),
      apps_compiled: [],
      per_app_compiles: 0,
      diagnostics: 0,
      tests_run: 0,
      tests_failed: 0,
      container: null,
      retries: 0,
      ...extra,
      spans: { ...(extra.spans ?? {}), total_ms: performance.now() - t0 },
    };
  }

  private async reject(
    st: GrantState,
    op: string,
    status: number,
    message: string,
    t0: number,
  ) {
    await this.append(
      st.g,
      this.line(st, op, status, "rejected", t0, {
        request: `rejected_${++st.rejections}`,
        message,
      }),
    );
    return json(status, { error: message });
  }

  async handle(req: Request): Promise<Response> {
    const t0 = performance.now();
    const op = /^\/v1\/(compile|test|symbols)$/.exec(new URL(req.url).pathname)
      ?.[1];
    if (req.method !== "POST" || !op) return json(404, { error: "not found" });
    const st = this.grants.get(req.headers.get("x-cg-execution") ?? "");
    const auth = req.headers.get("authorization") ?? "";
    const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const same = timingSafeEqual(
      await sha256(presented),
      st?.digest ?? NO_DIGEST,
    );
    if (!st || presented === "" || !same || this.now() > st.expiresAt) {
      return json(401, { error: "unauthorized" });
    }
    // Admission is synchronous from here: no await between this check and setting inflight.
    if (st.closing || this.grants.get(st.g.executionId) !== st) {
      return json(401, { error: "unauthorized" });
    }
    if (st.inflight) {
      return await this.reject(
        st,
        op,
        429,
        "one request at a time per execution",
        t0,
      );
    }
    let done!: () => void;
    st.inflight = new Promise<void>((r) => (done = r));
    try {
      return await this.serveOp(st, op, req, t0);
    } finally {
      st.inflight = null;
      done();
    }
  }

  private async serveOp(
    st: GrantState,
    op: string,
    req: Request,
    t0: number,
  ): Promise<Response> {
    const text = await readLimited(
      req,
      MAX_BODY_BYTES,
      this.o.bodyTimeoutMs ?? 30_000,
    );
    if (text === "timeout") {
      return await this.reject(st, op, 408, "request body timed out", t0);
    }
    if (text === null) {
      return await this.reject(st, op, 413, "body too large", t0);
    }
    let raw: unknown;
    try {
      raw = text.trim() === "" ? {} : JSON.parse(text);
    } catch {
      return await this.reject(st, op, 400, "malformed JSON", t0);
    }
    const parsed =
      (op === "compile" ? CompileBody : op === "test" ? TestBody : SymbolsBody)
        .safeParse(raw);
    if (!parsed.success) {
      return await this.reject(
        st,
        op,
        400,
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
        t0,
      );
    }
    const folders = new Set(st.g.trusted.map((a) => a.folder));
    const apps = op === "compile"
      ? (parsed.data as unknown as { apps: string[] }).apps
      : [];
    const unknown = apps.filter((a) => !folders.has(a));
    if (unknown.length > 0) {
      return await this.reject(
        st,
        op,
        400,
        `unknown app(s): ${unknown.join(", ")}`,
        t0,
      );
    }

    const requestId = `br_${++st.seq}`;
    if (op === "symbols") {
      await this.append(
        st.g,
        this.line(st, op, 200, "ok", t0, { request: requestId }),
      );
      return json(200, {
        request: requestId,
        backend_version: BACKEND_VERSION,
        ok: true,
        packages: st.g.symbols.map((p) => ({
          name: p.name,
          publisher: p.publisher,
          version: p.version,
        })),
      });
    }
    // Unique per request even if an id is ever reused: a stale cleanup never hits a live snapshot.
    const snapshot = join(
      this.o.workRoot,
      st.g.executionId,
      `${requestId}-${crypto.randomUUID().slice(0, 8)}`,
    );
    const workDir = `${snapshot}-work`;
    // The per-request deadline covers the snapshot and its checks too.
    const signal = AbortSignal.any([
      st.abort.signal,
      AbortSignal.timeout(this.o.requestDeadlineMs ?? 30 * 60_000),
    ]);
    try {
      const ts = performance.now();
      const copy = await this.quiescentCopy(st, snapshot);
      const snapshot_ms = performance.now() - ts;
      const violations = [
        ...copy.ambiguous.map((p) => `case-ambiguous name: ${p}`),
        ...await checkSnapshot(
          copy.dst,
          st.g.trusted,
          new Set(st.g.symbols.map((s) => s.app_id.toLowerCase())),
        ),
      ];
      if (violations.length > 0) {
        await this.append(
          st.g,
          this.line(st, op, 200, "failed", t0, {
            request: requestId,
            message: violations.join("; "),
            spans: { snapshot_ms },
          }),
        );
        return json(200, {
          request: requestId,
          backend_version: BACKEND_VERSION,
          ok: false,
          violations,
          ignored_links: copy.refused,
        });
      }
      if (signal.aborted) throw new LaneCancelledError(signal.reason);
      if (op === "test") {
        // Only discovered, runnable test codeunits (Subtype = Test, at least
        // one [Test] procedure, no TestPage, agent band): anything else would
        // run zero tests, which is infra, and walk every container.
        const runnable = new Set(
          (await testCodeunits(join(copy.dst, TEST_APP)))
            .filter((t) =>
              !t.testPage && t.procedures.length > 0 &&
              agentCodeunit(t.codeunit)
            )
            .map((t) => t.codeunit),
        );
        const asked =
          (parsed.data as unknown as { codeunits: number[] }).codeunits;
        const bad = asked.filter((c) => !runnable.has(c));
        if (bad.length > 0) {
          return await this.reject(
            st,
            op,
            400,
            `not a runnable test codeunit of the Test app: ${bad.join(", ")}`,
            t0,
          );
        }
      }
      const ctx: OpContext = {
        grant: st.g,
        snapshot: copy.dst,
        apps: await readAppGraph(copy.dst),
        requestId,
        workDir,
        signal,
      };
      const r = op === "compile"
        ? await this.o.ops.compile(ctx, apps)
        : await this.o.ops.test(
          ctx,
          (parsed.data as unknown as { codeunits: number[] }).codeunits,
        );
      const line = this.line(st, op, 200, r.log.outcome, t0, {
        ...r.log,
        request: requestId,
        spans: { snapshot_ms, ...(r.log.spans ?? {}) },
      });
      await this.append(st.g, line);
      return json(200, {
        request: requestId,
        backend_version: BACKEND_VERSION,
        ok: r.log.outcome === "ok",
        ...r.body,
        ignored_links: copy.refused,
        backend_ms: line.spans["total_ms"],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof CopyLimitError) {
        // The agent's own workspace is too large: its fault (4xx), no host path in the answer.
        await this.append(
          st.g,
          this.line(st, op, 422, "rejected", t0, {
            request: requestId,
            message,
          }),
        );
        return json(422, {
          request: requestId,
          error:
            "workspace exceeds the snapshot limits (files, bytes, directories, entries or depth)",
        });
      }
      // A cancelled request (deadline or revocation) is a tool fault, not the
      // agent's: 503, like any infra fault (the lane itself never reroutes it).
      const infra = err instanceof InfraRetriesExhaustedError ||
        err instanceof LaneCancelledError || isInfraError(err);
      await this.append(
        st.g,
        this.line(st, op, infra ? 503 : 500, infra ? "infra" : "error", t0, {
          request: requestId,
          message,
        }),
      );
      if (!infra) {
        console.error(`[FAIL] cg-al backend ${requestId}: ${message}`);
      }
      // The agent never sees host paths or internal error text; the host log keeps them.
      return json(
        infra ? 503 : 500,
        infra ? { request: requestId, infra: scrubHostPaths(message) } : {
          request: requestId,
          error: "internal backend error; details are in the host log",
        },
      );
    } finally {
      await Deno.remove(snapshot, { recursive: true }).catch(() => {});
      await Deno.remove(workDir, { recursive: true }).catch(() => {});
    }
  }

  /** Pause the sandbox, copy, unpause (all bounded). A failed pause is infra: nothing is copied. */
  private async quiescentCopy(st: GrantState, snapshot: string) {
    const d = this.o.docker;
    const name = st.g.sandbox;
    const ms = this.o.opTimeoutMs ?? OP_TIMEOUT_MS;
    if (!d || !name) {
      return await safeCopyTree(st.canonical, snapshot, {
        skip: isTaskBuildArtifact,
        ...(this.o.copyLimits ? { limits: this.o.copyLimits } : {}),
      });
    }
    if (await bounded(d.pause(name), ms, `docker pause ${name}`) !== 0) {
      throw new ContainerError(
        `docker pause ${name} failed: snapshot refused`,
        name,
        "test",
      );
    }
    let copy;
    try {
      copy = await safeCopyTree(st.canonical, snapshot, {
        skip: isTaskBuildArtifact,
        ...(this.o.copyLimits ? { limits: this.o.copyLimits } : {}),
      });
    } finally {
      const code = await bounded(d.unpause(name), ms, `docker unpause ${name}`)
        .catch((e) => String(e));
      if (code !== 0) {
        const reason =
          `docker unpause ${name} failed (${code}): the sandbox may still be paused`;
        st.g.onFault?.(reason);
        // deno-lint-ignore no-unsafe-finally
        throw new ContainerError(reason, name, "test");
      }
    }
    return copy;
  }

  serve(
    hostname: string,
    port: number,
  ): { url: string; shutdown(): Promise<void> } {
    if (
      !this.o.allowedHosts.includes(hostname) ||
      ["0.0.0.0", "::", ""].includes(hostname)
    ) {
      throw new ConfigurationError(
        `cg-al backend refuses to bind "${hostname}": allowed are ${
          this.o.allowedHosts.join(", ")
        } (container-facing only)`,
      );
    }
    const server = Deno.serve(
      { hostname, port, onListen: () => {} },
      (r) => this.handle(r),
    );
    const addr = server.addr as Deno.NetAddr;
    return {
      url: `http://${addr.hostname}:${addr.port}`,
      shutdown: () => server.shutdown(),
    };
  }
}

function withDependencies(apps: StagedApp[], folders: string[]): StagedApp[] {
  const need = new Set(folders);
  for (const a of [...apps].reverse()) {
    if (need.has(a.folder)) a.depends.forEach((d) => need.add(d));
  }
  return apps.filter((a) => need.has(a.folder));
}

export function defaultBackendOps(lane: BcLane): BackendOps {
  return {
    async compile(ctx, apps) {
      const selected = apps.length === 0
        ? ctx.apps
        : withDependencies(ctx.apps, apps);
      const versions = new Map(
        ctx.grant.trusted.map((a) => [a.folder, a.version]),
      );
      const t0 = performance.now();
      const built = await lane.compile((c) =>
        buildApps(lane.bc, c, {
          srcDir: ctx.snapshot,
          apps: selected,
          versions,
          outDir: ctx.workDir,
          lock: ctx.grant.lock,
          signal: ctx.signal,
        }), ctx.signal);
      const ok = built.every((b) => b.ok);
      return {
        body: {
          apps: built.map((b) => ({
            app: b.folder,
            ok: b.ok,
            diagnostics: b.diagnostics,
          })),
        },
        log: {
          outcome: ok ? "ok" : "failed",
          apps_compiled: built.filter((b) => b.attempted).map((b) => b.folder),
          per_app_compiles: built.filter((b) => b.attempted).length,
          diagnostics: built.reduce((n, b) => n + b.diagnostics.length, 0),
          spans: { compile_ms: performance.now() - t0 },
        },
      };
    },
    async test(ctx, codeunits) {
      const changed: string[] = [];
      for (const a of ctx.grant.trusted) {
        const now = join(ctx.snapshot, a.folder);
        if (
          !await exists(now) ||
          await hashTree(join(ctx.grant.pristine, a.folder), "task") !==
            await hashTree(now, "task")
        ) changed.push(a.folder);
      }
      const prep = await prepareApps(lane, {
        pristine: ctx.grant.pristine,
        pristineApps: ctx.grant.trusted,
        candidateDir: ctx.snapshot,
        candidateApps: ctx.apps,
        changed,
        workDir: ctx.workDir,
        lock: ctx.grant.lock,
        signal: ctx.signal,
      });
      const compiled = prep.built.filter((b) => b.attempted).map((b) =>
        b.folder
      );
      if (!prep.buildOk) {
        return {
          body: {
            apps: prep.built.map((b) => ({
              app: b.folder,
              ok: b.ok,
              diagnostics: b.diagnostics,
            })),
          },
          log: {
            outcome: "failed",
            apps_compiled: compiled,
            per_app_compiles: prep.per_app_compiles,
            spans: { compile_ms: prep.compile_ms },
          },
        };
      }
      const discovered = await testCodeunits(join(ctx.snapshot, TEST_APP));
      const skipped = discovered.filter((t) => t.testPage).map((t) =>
        t.codeunit
      );
      const byCu = new Map(discovered.map((t) => [t.codeunit, t]));
      const units = codeunits.length > 0
        ? codeunits
        : discovered.filter((t) =>
          !t.testPage && t.procedures.length > 0 && agentCodeunit(t.codeunit)
        ).map((t) => t.codeunit);
      if (units.length === 0) {
        // Nothing runnable: no publish (zero results would be infra).
        return {
          body: { tests: [], messages: [], skipped_testpage: skipped },
          log: {
            outcome: "failed",
            apps_compiled: compiled,
            per_app_compiles: prep.per_app_compiles,
            message: "no runnable test codeunit in the Test app",
            spans: { compile_ms: prep.compile_ms },
          },
        };
      }
      const held = await lane.exclusive({
        taskId: ctx.grant.executionId,
        variantId: "cg-al",
        attemptNumber: 1,
      }, (c) =>
        deployAndTest(lane.bc, c, {
          wanted: prep.wanted,
          tests: units.map((u) => ({
            codeunit: u,
            procedures: byCu.get(u)?.procedures ?? null,
            target: "candidate",
          })),
          cleanupIds: [...prep.candidateIds].reverse(),
          ctx: ctx.grant.deploy,
        }), ctx.signal); // a failed cleanup is quarantined by the lane before release
      const rows = held.result.rows;
      const failed = rows.filter((r) => r.outcome !== "pass").length;
      return {
        body: {
          tests: rows,
          messages: held.result.messages,
          skipped_testpage: skipped,
        },
        log: {
          outcome: rows.length > 0 && failed === 0 ? "ok" : "failed",
          apps_compiled: compiled,
          per_app_compiles: prep.per_app_compiles,
          tests_run: rows.length,
          tests_failed: failed,
          container: held.container,
          retries: held.retries.length,
          spans: {
            compile_ms: prep.compile_ms,
            queue_ms: held.queue_ms,
            provisioning_ms: held.result.deployed.provisioning_ms,
            publish_ms: held.result.deployed.candidate_publish_ms,
            test_ms: held.result.test_ms,
          },
        },
      };
    },
  };
}

export async function resolveBackendHost(): Promise<string> {
  const out = await new Deno.Command("docker", {
    args: [
      "network",
      "inspect",
      "nat",
      "--format",
      "{{range .IPAM.Config}}{{.Gateway}}{{end}}",
    ],
    env: dockerContextEnv(),
    stdout: "piped",
    stderr: "piped",
  }).output();
  const ip = new TextDecoder().decode(out.stdout).trim();
  if (!out.success || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    throw new ConfigurationError(
      `cannot resolve the Docker nat gateway: ${
        new TextDecoder().decode(out.stderr).trim()
      }`,
    );
  }
  return ip;
}

export async function readHostLog(path: string): Promise<HostLogLine[]> {
  try {
    return (await Deno.readTextFile(path)).split(/\r?\n/).filter(Boolean).map((
      l,
    ) => JSON.parse(l) as HostLogLine);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
}
