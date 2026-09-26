/**
 * The allowlisting egress proxy (M1-33): CONNECT to port 443 of an exactly
 * allowed DNS name, nothing else. It resolves the name itself, refuses any
 * private, loopback or link-local resolution, dials the address it checked
 * (no second lookup), binds one allowed address (never a wildcard), and logs
 * every decision as { at, decision, target, reason }: the authority only,
 * never a path, a header or a body.
 *
 * Two modes share that core: startEgressProxy (one execution, no credential)
 * and startSharedEgressProxy (M1-33c: one proxy per placed environment; each
 * execution registers, authenticates with its own credential, and gets its
 * own allowlist, log and connection pools).
 */

import { createHash, randomBytes } from "node:crypto";
import { ConfigurationError, StateError } from "../errors.ts";

export interface EgressLogLine {
  at: string;
  /** deny: refused by policy (a violation during a run); error: allowed but not delivered. */
  decision: "allow" | "deny" | "error";
  target: string;
  reason: string;
}

export interface ProxyOptions {
  hostname: string;
  port: number;
  /** Exact DNS names allowed (the execution's route hosts). */
  allow: string[];
  /**
   * Record mode (M1-34 Step 11, supervised): any DNS name on 443 is allowed
   * and logged; IP literals and private resolutions are still refused.
   */
  recordMode?: boolean;
  log(l: EgressLogLine): void;
  /** Addresses the proxy may bind (the sandbox gateway). */
  allowedHosts: string[];
  resolve?: (host: string) => Promise<string[]>;
  dial?: (address: string, port: number) => Promise<Deno.Conn>;
  /** Deadline for the request head (default 10 s) and for the dial (default 5 s). */
  headerTimeoutMs?: number;
  dialTimeoutMs?: number;
  /** Concurrent client connections (default MAX_CONNECTIONS); more are refused with 503. */
  maxConnections?: number;
  /** A tunnel with no bytes either way for this long is closed (default IDLE_TIMEOUT_MS). */
  idleTimeoutMs?: number;
}

export const MAX_CONNECTIONS = 64;
/** Long enough for a model's silent thinking between streamed events. */
export const IDLE_TIMEOUT_MS = 10 * 60_000;

const MAX_HEAD = 8192;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Eight 16-bit groups of an IPv6 address (an embedded dotted IPv4 tail allowed), or null. */
function v6Groups(ip: string): number[] | null {
  let s = ip;
  const tail = s.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (tail) {
    const b = tail[1]!.split(".").map(Number);
    if (b.some((x) => x > 255)) return null;
    s = s.slice(0, -tail[1]!.length) +
      `${((b[0]! << 8) | b[1]!).toString(16)}:${
        ((b[2]! << 8) | b[3]!).toString(16)
      }`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const part = (h: string) => h === "" ? [] : h.split(":");
  const head = part(halves[0]!);
  const rest = halves.length === 2 ? part(halves[1]!) : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  const all = [
    ...head,
    ...Array(halves.length === 2 ? fill : 0).fill("0"),
    ...rest,
  ];
  if (!all.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => parseInt(g, 16));
}

const v4Of = (hi: number, lo: number) =>
  `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

function v4Private(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
}

/** Private, loopback, link-local, CGNAT, multicast, reserved or unspecified. */
export function isPrivateAddress(ip: string): boolean {
  const s = ip.toLowerCase();
  if (IPV4.test(s)) {
    return s.split(".").some((x) => Number(x) > 255) || v4Private(s);
  }
  const g = v6Groups(s);
  if (!g) return true; // unparseable: fail closed
  const zero = (from: number, to: number) =>
    g.slice(from, to).every((x) => x === 0);
  // ::/96 (unspecified, loopback, IPv4-compatible) and ::ffff:0:0/96 (mapped).
  if (zero(0, 5) && (g[5] === 0 || g[5] === 0xffff)) {
    return g[5] === 0 && g[6] === 0 && g[7]! <= 1 ||
      v4Private(v4Of(g[6]!, g[7]!));
  }
  // NAT64 64:ff9b::/96 and 6to4 2002::/16 carry an IPv4.
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) {
    return v4Private(v4Of(g[6]!, g[7]!));
  }
  if (g[0] === 0x2002) return v4Private(v4Of(g[1]!, g[2]!));
  const top = g[0]!;
  return (top & 0xfe00) === 0xfc00 || (top & 0xffc0) === 0xfe80 ||
    (top & 0xff00) === 0xff00;
}

/** Version of the proxy isolation model (M1-33c: shared, authenticating). */
export const PROXY_ISOLATION = 2;
/** Sockets one registered source may hold before they authenticate. */
export const PRE_AUTH_PER_SOURCE = 4;

async function defaultResolve(
  host: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const out: string[] = [];
  for (const t of ["A", "AAAA"] as const) {
    try {
      out.push(...await Deno.resolveDns(host, t, signal ? { signal } : {}));
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  }
  return out;
}

const defaultDial = (address: string, port: number) =>
  Deno.connect({ hostname: address, port });

const reply = (status: string) =>
  new TextEncoder().encode(
    `HTTP/1.1 ${status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
  );

const AUTH_BODY = "Proxy authentication required.\n";
const AUTH_REQUIRED = new TextEncoder().encode(
  `HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="cg"\r\nContent-Length: ${AUTH_BODY.length}\r\nConnection: close\r\n\r\n${AUTH_BODY}`,
);

/**
 * p, or a timeout or an abort; a late settlement of p is observed (never an
 * unhandled rejection) and handed to late.
 */
async function within<T>(
  p: Promise<T>,
  ms: number,
  late: (v: T) => void = () => {},
  signal?: AbortSignal,
): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  let abandoned = false;
  let onAbort = () => {};
  p.then((v) => abandoned && late(v), () => {});
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rej) => {
        const stop = (why: string) => {
          abandoned = true;
          rej(new Error(why));
        };
        t = setTimeout(() => stop(`timed out after ${ms} ms`), ms);
        onAbort = () => stop("aborted");
        if (signal?.aborted) onAbort();
        else signal?.addEventListener("abort", onAbort);
      }),
    ]);
  } finally {
    clearTimeout(t);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Read the request head (up to the blank line), bounded in size and time. */
async function readHead(
  c: Deno.Conn,
  ms: number,
): Promise<{ head: string; rest: Uint8Array } | null> {
  let buf = new Uint8Array(0);
  const deadline = performance.now() + ms;
  for (;;) {
    const text = new TextDecoder("latin1").decode(buf);
    const end = text.indexOf("\r\n\r\n");
    if (end >= 0) {
      return { head: text.slice(0, end), rest: buf.subarray(end + 4) };
    }
    if (buf.length >= MAX_HEAD) return null;
    const left = deadline - performance.now();
    if (left <= 0) return null;
    const chunk = new Uint8Array(MAX_HEAD);
    let n: number | null;
    try {
      n = await within(c.read(chunk), left);
    } catch {
      return null;
    }
    if (n === null) return null;
    const next = new Uint8Array(buf.length + n);
    next.set(buf);
    next.set(chunk.subarray(0, n), buf.length);
    buf = next;
  }
}

/** host:port of a request target, never its path or query. */
function authority(target: string): string {
  try {
    const u = new URL(target);
    return u.host;
  } catch {
    return target.split("/")[0]!.slice(0, 255);
  }
}

function checkBind(hostname: string, allowedHosts: string[]): void {
  if (
    ["0.0.0.0", "::", ""].includes(hostname) || !allowedHosts.includes(hostname)
  ) {
    throw new ConfigurationError(
      `egress proxy refuses to bind ${hostname || "(empty)"}: only ${
        allowedHosts.join(", ")
      }`,
    );
  }
}

function allowSet(hosts: string[]): Set<string> {
  const allow = new Set<string>();
  for (const h of hosts) {
    if (
      h !== h.toLowerCase() || IPV4.test(h) || h.includes(":") ||
      !h.includes(".")
    ) {
      throw new ConfigurationError(
        `egress proxy allowlist entry ${h} is not a DNS name`,
      );
    }
    allow.add(h);
  }
  return allow;
}

/** A registration log write that failed: the connection ends with no status. */
class LogFailed extends Error {}

/** What one CONNECT is judged by, and where its decisions go. */
interface Policy {
  allow: Set<string>;
  record: boolean;
  /** Awaited before any status goes out; a rejection ends the connection without one. */
  log(l: EgressLogLine): Promise<void>;
  signal?: AbortSignal;
  /** Checked immediately before 200. */
  active(): boolean;
  /** The reply once the registration is gone (the dialed socket is already closed). */
  revoked(): Promise<void>;
  track(upstream: Deno.Conn): void;
}

interface Env {
  resolve(host: string, signal?: AbortSignal): Promise<string[]>;
  dial(address: string, port: number, signal?: AbortSignal): Promise<Deno.Conn>;
  dialMs: number;
  idleMs: number;
  close(c: Deno.Conn): void;
}

/** Judge a parsed request and, if allowed, tunnel it. Throws only LogFailed. */
async function serve(
  c: Deno.Conn,
  req: { head: string; rest: Uint8Array },
  p: Policy,
  e: Env,
): Promise<void> {
  let upstream: Deno.Conn | null = null;
  const log = async (
    decision: EgressLogLine["decision"],
    target: string,
    reason: string,
  ) => {
    try {
      await p.log({ at: new Date().toISOString(), decision, target, reason });
    } catch (err) {
      throw new LogFailed(err instanceof Error ? err.message : String(err));
    }
  };
  const fail502 = async (t: string, reason: string) => {
    await log("error", t, reason);
    await c.write(reply("502 Bad Gateway")).catch(() => {});
  };
  try {
    const [method = "", target = ""] = req.head.split("\r\n")[0]!.split(" ");
    const deny = async (t: string, reason: string) => {
      await log("deny", t, reason);
      await c.write(reply("403 Forbidden")).catch(() => {});
    };
    if (method !== "CONNECT") return await deny(authority(target), "method");
    const m = target.match(/^(\[[^\]]+\]|[^:]+):(\d{1,5})$/);
    if (!m) return await deny("-", "malformed");
    const host = m[1]!.toLowerCase().replace(/\.$/, "");
    const port = Number(m[2]);
    const t = `${host}:${port}`;
    if (port !== 443) return await deny(t, "port");
    if (IPV4.test(host) || host.startsWith("[")) {
      return await deny(t, "ip literal");
    }
    const dnsName = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host);
    if (!p.allow.has(host) && !(p.record && dnsName)) {
      return await deny(t, "host not allowed");
    }
    let addrs: string[];
    try {
      addrs = await within(
        e.resolve(host, p.signal),
        e.dialMs,
        undefined,
        p.signal,
      );
    } catch {
      if (p.signal?.aborted) return await p.revoked();
      addrs = [];
    }
    if (addrs.length === 0) return await fail502(t, "resolve failed");
    if (addrs.some(isPrivateAddress)) return await deny(t, "private address");
    const addr = addrs.find((a) => IPV4.test(a)) ?? addrs[0]!;
    try {
      upstream = await within(
        e.dial(addr, port, p.signal),
        e.dialMs,
        (late) => {
          try {
            late.close();
          } catch { /* closed */ }
        },
        p.signal,
      );
    } catch {
      if (p.signal?.aborted) return await p.revoked();
      return await fail502(t, "dial failed");
    }
    p.track(upstream);
    await log("allow", t, "allowed");
    if (!p.active()) {
      e.close(upstream);
      return await p.revoked();
    }
    await c.write(
      new TextEncoder().encode("HTTP/1.1 200 Connection Established\r\n\r\n"),
    );
    if (req.rest.length > 0) await upstream.write(req.rest);
    const up = upstream;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let idle = false;
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        idle = true;
        e.close(up);
        e.close(c);
      }, e.idleMs);
    };
    const watch = () =>
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, ctl) {
          touch();
          ctl.enqueue(chunk);
        },
      });
    touch();
    try {
      await Promise.allSettled([
        c.readable.pipeThrough(watch()).pipeTo(up.writable),
        up.readable.pipeThrough(watch()).pipeTo(c.writable),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (idle) await log("error", t, "idle timeout");
  } catch (err) {
    // A reset mid-tunnel ends the connection; a failed log write is the caller's.
    if (err instanceof LogFailed) throw err;
  } finally {
    if (upstream) e.close(upstream);
  }
}

function closer(conns: Set<Deno.Conn>) {
  return (c: Deno.Conn) => {
    conns.delete(c);
    try {
      c.close();
    } catch { /* already closed */ }
  };
}

export function startEgressProxy(
  o: ProxyOptions,
): { port: number; shutdown(): Promise<void> } {
  checkBind(o.hostname, o.allowedHosts);
  const allow = allowSet(o.allow);
  const listener = Deno.listen({ hostname: o.hostname, port: o.port });
  const conns = new Set<Deno.Conn>();
  const handlers = new Set<Promise<void>>();
  const maxConns = o.maxConnections ?? MAX_CONNECTIONS;
  const headMs = o.headerTimeoutMs ?? 10_000;
  const close = closer(conns);
  const env: Env = {
    resolve: o.resolve ?? defaultResolve,
    dial: o.dial ?? defaultDial,
    dialMs: o.dialTimeoutMs ?? 5_000,
    idleMs: o.idleTimeoutMs ?? IDLE_TIMEOUT_MS,
    close,
  };
  let clients = 0;
  // A throwing sink never changes a decision: the deny response still goes out.
  const log = (l: EgressLogLine) => {
    try {
      o.log(l);
    } catch { /* the sink reports its own failure (execution.ts) */ }
    return Promise.resolve();
  };
  const line = (
    decision: EgressLogLine["decision"],
    target: string,
    reason: string,
  ) => log({ at: new Date().toISOString(), decision, target, reason });
  const policy: Policy = {
    allow,
    record: o.recordMode === true,
    log,
    active: () => true,
    revoked: () => Promise.resolve(),
    track: (u) => conns.add(u),
  };

  async function handle(c: Deno.Conn): Promise<void> {
    try {
      const req = await readHead(c, headMs);
      if (!req) {
        await line("deny", "-", "malformed");
        await c.write(reply("400 Bad Request")).catch(() => {});
        return;
      }
      await serve(c, req, policy, env);
    } catch {
      /* the sink never throws here */
    } finally {
      close(c);
    }
  }

  const accepting = (async () => {
    for (;;) {
      let c: Deno.Conn;
      try {
        c = await listener.accept();
      } catch {
        return; // listener closed
      }
      conns.add(c);
      if (clients >= maxConns) {
        line("error", "-", "too many connections");
        c.write(reply("503 Service Unavailable")).catch(() => {}).finally(() =>
          close(c)
        );
        continue;
      }
      clients++;
      const h = handle(c).finally(() => clients--);
      handlers.add(h);
      h.finally(() => handlers.delete(h));
    }
  })();

  return {
    port: (listener.addr as Deno.NetAddr).port,
    async shutdown() {
      try {
        listener.close();
      } catch { /* closed */ }
      for (const c of [...conns]) close(c);
      await within(Promise.allSettled([accepting, ...handlers]), 10_000).catch(
        () => {},
      );
    },
  };
}

/** A pre-auth event: the reason goes here only, never to a registration's log. */
export interface HostLogLine {
  at: string;
  reason: string;
  source: string;
}

export type RegistrationFailure = "egress_log_failed" | "egress_proxy_failed";

export interface RegisterOptions {
  allow: string[];
  /** Awaited before every status line; a rejection fails the registration. */
  log(l: EgressLogLine): Promise<void> | void;
  record?: boolean;
  /** The sandbox's IPv4 on the internal network: a quota key, never attribution. */
  source: string;
  onFailure?(f: RegistrationFailure): void;
}

export interface Registration {
  readonly source: string;
  readonly failed: boolean;
  readonly failure: RegistrationFailure | null;
  /** Blocks admission at once, aborts pending resolves and dials, closes its tunnels. */
  unregister(): Promise<void>;
}

export interface ProxyCredential {
  user: string;
  pass: string;
}

export interface SharedProxyOptions {
  hostname: string;
  port: number;
  /** Addresses the proxy may bind (the sandbox gateway). */
  allowedHosts: string[];
  /** A throw or rejection fails the whole proxy. */
  hostLog(l: HostLogLine): Promise<void> | void;
  resolve?: (host: string, signal?: AbortSignal) => Promise<string[]>;
  dial?: (
    address: string,
    port: number,
    signal?: AbortSignal,
  ) => Promise<Deno.Conn>;
  headerTimeoutMs?: number;
  dialTimeoutMs?: number;
  /** Authenticated connections per registration (default MAX_CONNECTIONS). */
  maxConnections?: number;
  idleTimeoutMs?: number;
  /** Minimum time from the request head to any 407 (default 250 ms). */
  authDelayMs?: number;
  /** How long unregister waits for its connections before it returns (default 10 s). */
  unregisterTimeoutMs?: number;
  sourceOf?: (c: Deno.Conn) => string;
  listen?: (o: { hostname: string; port: number }) => Deno.Listener;
}

export interface SharedEgressProxy {
  port: number;
  readonly failed: boolean;
  register(
    o: RegisterOptions,
  ): { credential: ProxyCredential; reg: Registration };
  shutdown(): Promise<void>;
}

interface Entry {
  key: string;
  source: string;
  allow: Set<string>;
  record: boolean;
  log: RegisterOptions["log"];
  onFailure?: RegisterOptions["onFailure"];
  controller: AbortController;
  conns: Set<Deno.Conn>;
  clients: number;
  pending: Set<Promise<void>>;
  failure: RegistrationFailure | null;
  closing: Promise<void> | null;
}

const digest = (s: string) =>
  createHash("sha256").update(s, "latin1").digest("hex");

export function startSharedEgressProxy(
  o: SharedProxyOptions,
): SharedEgressProxy {
  checkBind(o.hostname, o.allowedHosts);
  let listener: Deno.Listener;
  try {
    listener = (o.listen ?? ((a) => Deno.listen(a)))({
      hostname: o.hostname,
      port: o.port,
    });
  } catch (err) {
    throw new ConfigurationError(
      `the shared egress proxy cannot listen on ${o.hostname}:${o.port}: ${
        err instanceof Error ? err.message : err
      }`,
    );
  }
  const conns = new Set<Deno.Conn>();
  const handlers = new Set<Promise<void>>();
  const close = closer(conns);
  const env: Env = {
    resolve: o.resolve ?? defaultResolve,
    dial: o.dial ?? defaultDial,
    dialMs: o.dialTimeoutMs ?? 5_000,
    idleMs: o.idleTimeoutMs ?? IDLE_TIMEOUT_MS,
    close,
  };
  const headMs = o.headerTimeoutMs ?? 10_000;
  const maxConns = o.maxConnections ?? MAX_CONNECTIONS;
  const authDelayMs = o.authDelayMs ?? 250;
  const unregisterMs = o.unregisterTimeoutMs ?? 10_000;
  const sourceOf = o.sourceOf ??
    ((c: Deno.Conn) => (c.remoteAddr as Deno.NetAddr).hostname);
  const registry = new Map<string, Entry>(); // sha256(user:pass) -> entry
  const bySource = new Map<string, Entry>();
  const preAuth = new Map<string, number>();
  let failed = false;
  let stopping = false;

  const unPre = (source: string) => {
    const n = (preAuth.get(source) ?? 1) - 1;
    if (n > 0) preAuth.set(source, n);
    else preAuth.delete(source);
  };

  function revoke(e: Entry, failure?: RegistrationFailure): Promise<void> {
    if (failure && !e.failure) {
      e.failure = failure;
      try {
        e.onFailure?.(failure);
      } catch { /* the cell reads reg.failure too */ }
    }
    if (e.closing) return e.closing;
    if (registry.get(e.key) === e) registry.delete(e.key);
    if (bySource.get(e.source) === e) bySource.delete(e.source);
    e.controller.abort();
    for (const c of [...e.conns]) close(c);
    e.closing = within(Promise.allSettled([...e.pending]), unregisterMs).then(
      () => {},
      () => {},
    );
    return e.closing;
  }

  function fail(): void {
    if (failed) return;
    failed = true;
    for (const e of [...registry.values()]) {
      void revoke(e, "egress_proxy_failed");
    }
  }

  async function hostLog(reason: string, source: string): Promise<void> {
    try {
      await o.hostLog({ at: new Date().toISOString(), reason, source });
    } catch {
      fail();
    }
  }

  /** The one reply for every credential problem, never earlier than authDelayMs after the head. */
  async function refuse(c: Deno.Conn, since: number): Promise<void> {
    const wait = authDelayMs - (performance.now() - since);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    await c.write(AUTH_REQUIRED).catch(() => {});
  }

  function authenticate(head: string): Entry | string {
    const values = head.split("\r\n").slice(1)
      .filter((l) => /^proxy-authorization:/i.test(l))
      .map((l) => l.slice(l.indexOf(":") + 1).trim());
    if (values.length === 0) return "missing credential";
    const m = values.length === 1 ? values[0]!.match(/^(\S+)\s+(\S+)$/) : null;
    if (!m) return "malformed credential";
    if (m[1]!.toLowerCase() !== "basic") return "not basic";
    let decoded: string;
    try {
      decoded = atob(m[2]!);
    } catch {
      return "malformed credential";
    }
    return registry.get(digest(decoded)) ?? "unknown credential";
  }

  async function handle(c: Deno.Conn, source: string): Promise<void> {
    let pre = true;
    let owner: Entry | undefined;
    let counted = false;
    const mine: Deno.Conn[] = [c];
    const finished = Promise.withResolvers<void>();
    try {
      const req = await readHead(c, headMs);
      if (!req) {
        await hostLog("malformed head", source);
        await c.write(reply("400 Bad Request")).catch(() => {});
        return;
      }
      const since = performance.now();
      const auth = authenticate(req.head);
      if (typeof auth === "string") {
        await hostLog(auth, source);
        return await refuse(c, since);
      }
      owner = auth;
      // An over-cap request keeps its pre-auth slot until its 503 is written
      // and the socket closed, so a slow log cannot let it escape every bound.
      if (auth.clients >= maxConns) {
        await auth.log({
          at: new Date().toISOString(),
          decision: "error",
          target: "-",
          reason: "too many connections",
        });
        await c.write(reply("503 Service Unavailable")).catch(() => {});
        return;
      }
      // One synchronous section: leave the source's pre-auth quota and take a
      // place in the registration's pool.
      unPre(source);
      pre = false;
      auth.clients++;
      counted = true;
      auth.conns.add(c);
      auth.pending.add(finished.promise);
      const e = auth;
      await serve(c, req, {
        allow: e.allow,
        record: e.record,
        log: async (l) => await e.log(l),
        signal: e.controller.signal,
        active: () => !failed && registry.get(e.key) === e,
        revoked: async () => {
          await hostLog("revoked", source);
          await refuse(c, since);
        },
        track: (u) => {
          mine.push(u);
          e.conns.add(u);
          conns.add(u);
        },
      }, env);
    } catch {
      // serve throws only LogFailed; the over-cap line throws the sink's error.
      if (owner) void revoke(owner, "egress_log_failed");
    } finally {
      if (pre) unPre(source);
      if (owner && counted) {
        owner.clients--;
        for (const x of mine) owner.conns.delete(x);
        owner.pending.delete(finished.promise);
      }
      close(c);
      finished.resolve();
    }
  }

  const busy = (c: Deno.Conn) => {
    c.write(reply("503 Service Unavailable")).catch(() => {}).finally(() =>
      close(c)
    );
  };

  const accepting = (async () => {
    for (;;) {
      let c: Deno.Conn;
      try {
        c = await listener.accept();
      } catch {
        if (!stopping) fail();
        return;
      }
      conns.add(c);
      if (failed) {
        busy(c);
        continue;
      }
      const source = sourceOf(c);
      if (!bySource.has(source)) {
        close(c); // unregistered: closed unread
        continue;
      }
      const n = preAuth.get(source) ?? 0;
      if (n >= PRE_AUTH_PER_SOURCE) {
        busy(c);
        continue;
      }
      preAuth.set(source, n + 1);
      const h = handle(c, source);
      handlers.add(h);
      h.finally(() => handlers.delete(h));
    }
  })();

  return {
    port: (listener.addr as Deno.NetAddr).port,
    get failed() {
      return failed;
    },
    register(r) {
      if (failed) {
        throw new StateError("egress proxy has failed", "failed", "running");
      }
      const source = typeof r.source === "string" ? r.source : "";
      if (
        !IPV4.test(source) || source.split(".").some((x) => Number(x) > 255)
      ) {
        throw new ConfigurationError(
          `egress proxy registration needs the sandbox IPv4 source, got ${
            source || "(empty)"
          }`,
        );
      }
      if (bySource.has(source)) {
        throw new ConfigurationError(
          `egress proxy source ${source} is already registered`,
        );
      }
      const allow = allowSet(r.allow);
      const user = randomBytes(16).toString("hex");
      const pass = randomBytes(32).toString("base64url");
      const key = digest(`${user}:${pass}`);
      if (registry.has(key)) {
        throw new StateError("egress proxy credential collision", "active");
      }
      const e: Entry = {
        key,
        source,
        allow,
        record: r.record === true,
        log: r.log,
        onFailure: r.onFailure,
        controller: new AbortController(),
        conns: new Set(),
        clients: 0,
        pending: new Set(),
        failure: null,
        closing: null,
      };
      registry.set(key, e);
      bySource.set(source, e);
      const reg: Registration = Object.freeze({
        source,
        get failed() {
          return e.failure !== null;
        },
        get failure() {
          return e.failure;
        },
        unregister: () => revoke(e),
      });
      return { credential: { user, pass }, reg };
    },
    async shutdown() {
      stopping = true;
      try {
        listener.close();
      } catch { /* closed */ }
      for (const e of [...registry.values()]) void revoke(e);
      for (const c of [...conns]) close(c);
      await within(Promise.allSettled([accepting, ...handlers]), 10_000).catch(
        () => {},
      );
    },
  };
}
