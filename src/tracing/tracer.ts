/**
 * Bench tracer.
 *
 * Emits Chrome Trace Event Format JSON for drag-drop into
 * https://ui.perfetto.dev. Spec: docs/superpowers/specs/2026-05-15-bench-tracing.md.
 *
 * Off-by-default. `Tracer.disabled` is a singleton that allocates nothing
 * and reads no clocks. Production callers always go through this module,
 * which selects between the real tracer and the disabled stub at module
 * load based on `CENTRALGAUGE_TRACE_FILE` / CLI flags.
 *
 * Time base — two origins captured at init:
 *   originPerfMicros = performance.now() * 1000   // monotonic
 *   originUnixMicros = Date.now() * 1000          // wall-clock anchor for pwsh
 * TS event ts = (performance.now() * 1000) - originPerfMicros.
 * PowerShell receives originUnixMicros via `CG_TRACE_BENCH_START_UNIX_MICROS`
 * and computes ts the same way.
 */

import { redactSensitive } from "../health/redact.ts";

/** Maximum length for any free-form string in args (post-redaction). */
const MAX_ARG_STRING_LEN = 200;

/** Periodic flush trigger: events buffered. */
const FLUSH_EVENTS = 1000;

/** Periodic flush trigger: milliseconds since last flush. */
const FLUSH_INTERVAL_MS = 1000;

/** Chrome Trace Event Format event. */
export interface TraceEvent {
  name: string;
  cat?: string;
  ph: "X" | "B" | "E" | "i" | "b" | "n" | "e" | "M";
  ts?: number;
  dur?: number;
  pid: number;
  tid: number;
  id?: string;
  args?: Record<string, unknown>;
  s?: "g" | "p" | "t"; // scope for instants
}

/** Reserved numeric tids. Container slots use 100 + i*10 (see tidForLane). */
const TID_ORCHESTRATOR = 1;
const TID_COMPILE_QUEUE = 2;
const TID_LLM_POOL = 3;

/** Options passed to span/instant call sites. */
export interface SpanOptions {
  /** Logical lane. Use container name ("Cronus281"), "orchestrator", etc. */
  tid?: string;
  /** Sub-lane suffix: "slot" | "pwsh" | "soap". Defaults to "slot" for containers. */
  sublane?: "slot" | "pwsh" | "soap";
  /** Comma-separated categories. */
  cat?: string | string[];
  /** Free-form metadata. Strings go through redactSensitive + 200-char cap. */
  args?: Record<string, unknown>;
}

/** Handle returned by start() / beginAsync() — call end() to close the span. */
export interface SpanHandle {
  /** Close the span. No-op if already ended. */
  end(extra?: { args?: Record<string, unknown>; ok?: boolean }): void;
}

/**
 * Public tracer surface. Both the real implementation and the disabled stub
 * conform to this so call sites can treat them identically.
 */
export interface TracerAPI {
  readonly enabled: boolean;
  /** Run `body` wrapped in an `X` (complete) span. Auto-ends even on throw. */
  span<T>(name: string, opts: SpanOptions, body: () => Promise<T>): Promise<T>;
  span<T>(name: string, opts: SpanOptions, body: () => T): T;
  /** Begin a span; caller must call `.end()` on the returned handle. */
  start(name: string, opts: SpanOptions): SpanHandle;
  /** Emit an instant ("i") event. */
  instant(name: string, opts: SpanOptions): void;
  /** Begin an async span (overlapping spans on the same tid). */
  beginAsync(name: string, opts: SpanOptions): SpanHandle;
  /** Flush and close (writes final trace file). Idempotent. */
  close(): Promise<void>;
  /**
   * Push a pre-formed event from a non-host emitter (e.g. the pwsh-side
   * `CG-Trace` helper, parsed via `parseTraceLines`). The pwsh helper has
   * already computed bench-relative `ts` / `dur` (using the wall-clock
   * origin TS exposed via `CG_TRACE_BENCH_START_UNIX_MICROS`), so we
   * forward as-is. Lanes get a default `thread_name` registered on first
   * sight if the caller didn't already declare them.
   */
  pushPreformed(ev: TraceEvent, defaultLaneName?: string): void;
}

/**
 * Disabled tracer: zero clock reads, zero allocations beyond the
 * already-allocated args object the caller passed. Used when tracing is off.
 */
const DISABLED_HANDLE: SpanHandle = { end: () => {} };
const DISABLED_TRACER: TracerAPI = {
  enabled: false,
  span<T>(_name: string, _opts: SpanOptions, body: () => T | Promise<T>) {
    return body() as T;
  },
  start() {
    return DISABLED_HANDLE;
  },
  instant() {},
  beginAsync() {
    return DISABLED_HANDLE;
  },
  close() {
    return Promise.resolve();
  },
  pushPreformed() {},
};

/** Real implementation, allocated only when tracing is enabled. */
class ActiveTracer implements TracerAPI {
  readonly enabled = true;
  private readonly originPerfMicros: number;
  /** Wall-clock anchor exposed to pwsh via env. */
  readonly originUnixMicros: number;

  private events: TraceEvent[] = [];
  /** lane name -> numeric tid */
  private laneTids: Map<string, number> = new Map();
  private nextContainerSlotTid = 100;
  private nextAsyncId = 1;

  private flushTimer: number | null = null;
  private closed = false;
  private writeFailed = false;
  private signalHandler: (() => void) | null = null;

  constructor(private readonly outFile: string) {
    this.originPerfMicros = performance.now() * 1000;
    this.originUnixMicros = Date.now() * 1000;

    // Reserve the well-known lane ids up front so they're stable across runs.
    this.laneTids.set("orchestrator", TID_ORCHESTRATOR);
    this.laneTids.set("compile-queue", TID_COMPILE_QUEUE);
    this.laneTids.set("llm-pool", TID_LLM_POOL);

    this.emitMetadata("process_name", 0, undefined, {
      name: "centralgauge-bench",
    });
    this.emitMetadata("thread_name", 0, TID_ORCHESTRATOR, {
      name: "orchestrator",
    });
    this.emitMetadata("thread_name", 0, TID_COMPILE_QUEUE, {
      name: "compile-queue",
    });
    this.emitMetadata("thread_name", 0, TID_LLM_POOL, { name: "llm-pool" });

    this.installSignalHandler();
  }

  private installSignalHandler(): void {
    // Best-effort flush on SIGINT. Windows SIGINT support in Deno is limited;
    // hard kill (taskkill) may still lose buffered tail. Periodic flushes
    // mitigate this since the on-disk file is always valid.
    try {
      const handler = () => {
        // Fire-and-forget — Deno's signal listener can't be async.
        this.close().catch(() => {});
      };
      Deno.addSignalListener("SIGINT", handler);
      this.signalHandler = handler;
    } catch {
      // SIGINT not supported on this platform; rely on periodic flush.
    }
  }

  /** Resolve a logical lane name + optional sublane to a stable numeric tid. */
  private resolveTid(
    laneName: string,
    sublane?: "slot" | "pwsh" | "soap",
  ): number {
    const key = sublane ? `${laneName}:${sublane}` : laneName;
    const cached = this.laneTids.get(key);
    if (cached !== undefined) return cached;

    let id: number;
    let label: string;
    if (
      key === "orchestrator" || key === "compile-queue" || key === "llm-pool"
    ) {
      // Already reserved; unreachable here because they were pre-seeded.
      id = this.laneTids.get(key)!;
      label = key;
    } else if (sublane) {
      // Container sublane. Allocate group of 10 ids; offsets: slot=0, pwsh=1, soap=2.
      let groupBase = this.laneTids.get(`${laneName}:slot`);
      if (groupBase === undefined) {
        groupBase = this.nextContainerSlotTid;
        this.nextContainerSlotTid += 10;
        this.laneTids.set(`${laneName}:slot`, groupBase);
        this.emitMetadata("thread_name", 0, groupBase, {
          name: `${laneName} (slot)`,
        });
      }
      const offset = sublane === "slot" ? 0 : sublane === "pwsh" ? 1 : 2;
      id = groupBase + offset;
      label = `${laneName} (${sublane})`;
      this.laneTids.set(key, id);
      if (offset !== 0) {
        this.emitMetadata("thread_name", 0, id, { name: label });
      }
    } else {
      // Bare container name → its slot lane.
      return this.resolveTid(laneName, "slot");
    }

    return id;
  }

  /** Microseconds since bench start, monotonic. */
  private nowMicros(): number {
    return Math.round(performance.now() * 1000 - this.originPerfMicros);
  }

  /** Sanitize args: redact strings, cap length, drop non-serializable. */
  private sanitizeArgs(
    args?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    if (!args) return undefined;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      if (typeof v === "string") {
        const redacted = redactSensitive(v);
        out[k] = redacted.length > MAX_ARG_STRING_LEN
          ? redacted.slice(0, MAX_ARG_STRING_LEN) + "…"
          : redacted;
      } else if (
        typeof v === "number" || typeof v === "boolean" || v === null
      ) {
        out[k] = v;
      } else if (typeof v === "bigint") {
        out[k] = v.toString();
      } else if (typeof v === "function" || typeof v === "symbol") {
        // Drop silently.
      } else {
        // Try JSON-roundtrip; on failure, replace with marker.
        try {
          const s = JSON.stringify(v);
          out[k] = s.length > MAX_ARG_STRING_LEN
            ? s.slice(0, MAX_ARG_STRING_LEN) + "…"
            : v;
        } catch {
          out[k] = { _serializationFailed: true };
        }
      }
    }
    return out;
  }

  private normalizeCat(cat?: string | string[]): string | undefined {
    if (!cat) return undefined;
    return Array.isArray(cat) ? cat.join(",") : cat;
  }

  private push(ev: TraceEvent): void {
    this.events.push(ev);
    this.maybeFlush();
  }

  private emitMetadata(
    name: string,
    pid: number,
    tid: number | undefined,
    args: Record<string, unknown>,
  ): void {
    const ev: TraceEvent = {
      name,
      ph: "M",
      pid,
      tid: tid ?? 0,
      args,
    };
    this.events.push(ev);
  }

  span<T>(
    name: string,
    opts: SpanOptions,
    body: () => T | Promise<T>,
  ): T | Promise<T> {
    const handle = this.start(name, opts);
    let result: T | Promise<T>;
    try {
      result = body();
    } catch (e) {
      handle.end({
        args: {
          errorType: e instanceof Error ? e.constructor.name : "unknown",
          errorMessage: e instanceof Error ? e.message : String(e),
        },
        ok: false,
      });
      throw e;
    }
    if (result instanceof Promise) {
      return result.then(
        (v) => {
          handle.end({ ok: true });
          return v;
        },
        (e) => {
          handle.end({
            args: {
              errorType: e instanceof Error ? e.constructor.name : "unknown",
              errorMessage: e instanceof Error ? e.message : String(e),
            },
            ok: false,
          });
          throw e;
        },
      );
    }
    handle.end({ ok: true });
    return result;
  }

  start(name: string, opts: SpanOptions): SpanHandle {
    const tid = this.resolveTid(opts.tid ?? "orchestrator", opts.sublane);
    const startTs = this.nowMicros();
    const cat = this.normalizeCat(opts.cat);
    const startingArgs = this.sanitizeArgs(opts.args);
    let ended = false;
    return {
      end: (extra) => {
        if (ended) return;
        ended = true;
        const endTs = this.nowMicros();
        const mergedArgs: Record<string, unknown> = { ...(startingArgs ?? {}) };
        if (extra?.args) {
          for (
            const [k, v] of Object.entries(this.sanitizeArgs(extra.args) ?? {})
          ) {
            mergedArgs[k] = v;
          }
        }
        if (extra?.ok !== undefined && mergedArgs["ok"] === undefined) {
          mergedArgs["ok"] = extra.ok;
        }
        const ev: TraceEvent = {
          name,
          ph: "X",
          ts: startTs,
          dur: Math.max(0, endTs - startTs),
          pid: 0,
          tid,
        };
        if (cat) ev.cat = cat;
        if (Object.keys(mergedArgs).length > 0) ev.args = mergedArgs;
        this.push(ev);
      },
    };
  }

  instant(name: string, opts: SpanOptions): void {
    const tid = this.resolveTid(opts.tid ?? "orchestrator", opts.sublane);
    const ts = this.nowMicros();
    const ev: TraceEvent = {
      name,
      ph: "i",
      ts,
      pid: 0,
      tid,
      s: "t",
    };
    const cat = this.normalizeCat(opts.cat);
    if (cat) ev.cat = cat;
    const args = this.sanitizeArgs(opts.args);
    if (args && Object.keys(args).length > 0) ev.args = args;
    this.push(ev);
  }

  beginAsync(name: string, opts: SpanOptions): SpanHandle {
    const tid = this.resolveTid(opts.tid ?? "orchestrator", opts.sublane);
    const id = String(this.nextAsyncId++);
    const cat = this.normalizeCat(opts.cat);
    const startArgs = this.sanitizeArgs(opts.args);
    const beginEv: TraceEvent = {
      name,
      ph: "b",
      ts: this.nowMicros(),
      pid: 0,
      tid,
      id,
    };
    if (cat) beginEv.cat = cat;
    if (startArgs && Object.keys(startArgs).length > 0) {
      beginEv.args = startArgs;
    }
    this.push(beginEv);

    let ended = false;
    return {
      end: (extra) => {
        if (ended) return;
        ended = true;
        const endEv: TraceEvent = {
          name,
          ph: "e",
          ts: this.nowMicros(),
          pid: 0,
          tid,
          id,
        };
        if (cat) endEv.cat = cat;
        const endArgs = this.sanitizeArgs(extra?.args);
        if (extra?.ok !== undefined) {
          (endArgs ?? {})["ok"] = extra.ok;
        }
        if (endArgs && Object.keys(endArgs).length > 0) endEv.args = endArgs;
        this.push(endEv);
      },
    };
  }

  /** Schedule a flush if buffer is large enough or interval elapsed. */
  private maybeFlush(): void {
    if (this.events.length >= FLUSH_EVENTS) {
      this.flushNow();
      return;
    }
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushNow();
    }, FLUSH_INTERVAL_MS);
  }

  /**
   * Atomically rewrite the full valid Chrome Trace JSON to disk.
   * Writes a temp file then renames so the on-disk file is always valid.
   */
  private flushNow(): void {
    if (this.writeFailed) return;
    const payload = JSON.stringify({
      traceEvents: this.events,
      displayTimeUnit: "ms",
    });
    const tmp = this.outFile + ".tmp";
    try {
      Deno.writeTextFileSync(tmp, payload);
      Deno.renameSync(tmp, this.outFile);
    } catch (e) {
      // Disable further writes; keep going.
      this.writeFailed = true;
      console.error(
        `[tracer] trace file write failed (${this.outFile}): ${
          e instanceof Error ? e.message : String(e)
        }. Disabling tracing for remainder of run.`,
      );
    }
  }

  /**
   * Accept a pre-formed event from the pwsh `[TRACE]` parser. The event
   * already has bench-relative `ts` (and `dur` for `X` phases) computed
   * via `CG_TRACE_BENCH_START_UNIX_MICROS`, so we forward as-is. Args are
   * still sanitized through `sanitizeArgs` to enforce redaction + length
   * caps. If the tid hasn't been seen before, register a default
   * `thread_name` so Perfetto labels the lane.
   */
  pushPreformed(ev: TraceEvent, defaultLaneName?: string): void {
    // Register lane metadata if this tid is new.
    const seenAsLane = Array.from(this.laneTids.values()).includes(ev.tid);
    if (!seenAsLane) {
      const label = defaultLaneName ?? `tid-${ev.tid}`;
      // We can't easily reverse-map a numeric tid back to a lane name, so
      // just stash a synthetic key so we don't re-emit metadata.
      this.laneTids.set(`numeric:${ev.tid}`, ev.tid);
      this.emitMetadata("thread_name", ev.pid ?? 0, ev.tid, { name: label });
    }
    const sanitized = this.sanitizeArgs(ev.args);
    const cleaned: TraceEvent = {
      name: ev.name,
      ph: ev.ph,
      pid: ev.pid ?? 0,
      tid: ev.tid,
      ...(ev.cat !== undefined ? { cat: ev.cat } : {}),
      ...(ev.ts !== undefined ? { ts: ev.ts } : {}),
      ...(ev.dur !== undefined ? { dur: ev.dur } : {}),
      ...(ev.id !== undefined ? { id: ev.id } : {}),
      ...(ev.s !== undefined ? { s: ev.s } : {}),
      ...(sanitized && Object.keys(sanitized).length > 0
        ? { args: sanitized }
        : {}),
    };
    this.push(cleaned);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.signalHandler) {
      try {
        Deno.removeSignalListener("SIGINT", this.signalHandler);
      } catch {
        // ignore
      }
      this.signalHandler = null;
    }
    this.flushNow();
    await Promise.resolve(); // satisfy async signature
  }
}

/**
 * The mutable singleton callers use. Default to disabled; init() swaps in
 * the real tracer.
 */
let _tracer: TracerAPI = DISABLED_TRACER;

/** Get the active tracer (active or disabled stub). */
export function getTracer(): TracerAPI {
  return _tracer;
}

/** Initialize the tracer with an output path. Idempotent on the same path. */
export function initTracer(outFile: string): TracerAPI {
  if (_tracer.enabled) {
    return _tracer;
  }
  _tracer = new ActiveTracer(outFile);
  return _tracer;
}

/** Close + reset to disabled. Used by tests and bench teardown. */
export async function closeTracer(): Promise<void> {
  if (_tracer.enabled) {
    await _tracer.close();
    _tracer = DISABLED_TRACER;
  }
}

/**
 * Resolve the trace output path from CLI/env precedence:
 *   1. `--no-trace`          → null (disabled)
 *   2. `--trace-file <path>` → path
 *   3. `--trace`             → `${defaultDir}/trace.json`
 *   4. env CENTRALGAUGE_TRACE_FILE
 *   5. unset → null
 */
export function resolveTracePath(opts: {
  noTrace?: boolean | undefined;
  trace?: boolean | undefined;
  traceFile?: string | undefined;
  defaultDir?: string | undefined;
}): string | null {
  if (opts.noTrace) return null;
  if (opts.traceFile) return opts.traceFile;
  if (opts.trace) {
    const dir = opts.defaultDir ?? "results";
    return `${dir}/trace.json`;
  }
  const env = Deno.env.get("CENTRALGAUGE_TRACE_FILE");
  if (env && env.length > 0) return env;
  return null;
}

/**
 * Convenience: get the Unix-microsecond origin for passing to PowerShell.
 * Returns null when tracer is disabled.
 */
export function getUnixOriginMicros(): number | null {
  if (!_tracer.enabled) return null;
  return (_tracer as ActiveTracer).originUnixMicros;
}
