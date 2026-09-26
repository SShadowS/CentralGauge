/**
 * The allowlisting egress proxy (M1-33): CONNECT to port 443 of an exactly
 * allowed DNS name, nothing else. It resolves the name itself, refuses any
 * private, loopback or link-local resolution, dials the address it checked
 * (no second lookup), binds one allowed address (never a wildcard), and logs
 * every decision as { at, decision, target, reason }: the authority only,
 * never a path, a header or a body.
 */

import { ConfigurationError } from "../errors.ts";

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

async function defaultResolve(host: string): Promise<string[]> {
  const out: string[] = [];
  for (const t of ["A", "AAAA"] as const) {
    try {
      out.push(...await Deno.resolveDns(host, t));
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
  }
  return out;
}

const reply = (status: string) =>
  new TextEncoder().encode(
    `HTTP/1.1 ${status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
  );

/** p or a timeout; a late settlement of p is observed (never an unhandled rejection) and handed to late. */
async function within<T>(
  p: Promise<T>,
  ms: number,
  late: (v: T) => void = () => {},
): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  p.then((v) => timedOut && late(v), () => {});
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rej) => {
        t = setTimeout(() => {
          timedOut = true;
          rej(new Error(`timed out after ${ms} ms`));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(t);
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

export function startEgressProxy(
  o: ProxyOptions,
): { port: number; shutdown(): Promise<void> } {
  if (
    ["0.0.0.0", "::", ""].includes(o.hostname) ||
    !o.allowedHosts.includes(o.hostname)
  ) {
    throw new ConfigurationError(
      `egress proxy refuses to bind ${o.hostname || "(empty)"}: only ${
        o.allowedHosts.join(", ")
      }`,
    );
  }
  const allow = new Set<string>();
  for (const h of o.allow) {
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
  const resolve = o.resolve ?? defaultResolve;
  const dial = o.dial ??
    ((address: string, port: number) =>
      Deno.connect({ hostname: address, port }));
  const headMs = o.headerTimeoutMs ?? 10_000;
  const dialMs = o.dialTimeoutMs ?? 5_000;
  const listener = Deno.listen({ hostname: o.hostname, port: o.port });
  const conns = new Set<Deno.Conn>();
  const handlers = new Set<Promise<void>>();
  const maxConns = o.maxConnections ?? MAX_CONNECTIONS;
  const idleMs = o.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
  let clients = 0;
  // A throwing sink never changes a decision: the deny response still goes out.
  const log = (
    decision: EgressLogLine["decision"],
    target: string,
    reason: string,
  ) => {
    try {
      o.log({ at: new Date().toISOString(), decision, target, reason });
    } catch { /* the sink reports its own failure (execution.ts) */ }
  };
  const close = (c: Deno.Conn) => {
    conns.delete(c);
    try {
      c.close();
    } catch { /* already closed */ }
  };

  async function handle(c: Deno.Conn): Promise<void> {
    let upstream: Deno.Conn | null = null;
    try {
      const req = await readHead(c, headMs);
      if (!req) {
        log("deny", "-", "malformed");
        await c.write(reply("400 Bad Request")).catch(() => {});
        return;
      }
      const [method = "", target = ""] = req.head.split("\r\n")[0]!.split(" ");
      const deny = async (t: string, reason: string) => {
        log("deny", t, reason);
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
      if (!allow.has(host)) return await deny(t, "host not allowed");
      let addrs: string[];
      try {
        addrs = await within(resolve(host), dialMs);
      } catch {
        log("error", t, "resolve failed");
        await c.write(reply("502 Bad Gateway")).catch(() => {});
        return;
      }
      if (addrs.length === 0) {
        log("error", t, "resolve failed");
        await c.write(reply("502 Bad Gateway")).catch(() => {});
        return;
      }
      if (addrs.some(isPrivateAddress)) return await deny(t, "private address");
      const addr = addrs.find((a) => IPV4.test(a)) ?? addrs[0]!;
      try {
        upstream = await within(dial(addr, port), dialMs, (late) => {
          try {
            late.close();
          } catch { /* closed */ }
        });
      } catch {
        log("error", t, "dial failed");
        await c.write(reply("502 Bad Gateway")).catch(() => {});
        return;
      }
      conns.add(upstream);
      log("allow", t, "allowed");
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
          close(up);
          close(c);
        }, idleMs);
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
      if (idle) log("error", t, "idle timeout");
    } catch {
      // A reset mid-tunnel ends the connection; nothing more to log.
    } finally {
      if (upstream) close(upstream);
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
        log("error", "-", "too many connections");
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
