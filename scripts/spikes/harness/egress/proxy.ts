// SPIKE (throwaway): harness bench M1-31 egress feasibility
// Minimal allowlisting HTTPS CONNECT proxy. Logs every request as one JSON line.
// Usage: deno run --allow-all scripts/spikes/harness/egress/proxy.ts <port> <logFile> <host[,host...]>
// Refuses: non-CONNECT requests, ports other than 443, IP-literal targets, hosts not on
// the list (exact match), and hosts that resolve to private/loopback/link-local addresses.
const [portArg, logFile, hostsArg] = Deno.args;
if (!portArg || !logFile || !hostsArg) throw new Error("usage: see header");
const allow = new Set(hostsArg.split(",").map((h) => h.trim().toLowerCase()));
const log = await Deno.open(logFile, { append: true, create: true });
const enc = new TextEncoder();
const dec = new TextDecoder();

function record(o: Record<string, unknown>) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...o });
  console.log(line);
  log.writeSync(enc.encode(line + "\n"));
}

function isPrivate(ip: string): boolean {
  return /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/
    .test(ip) ||
    ip === "::1" || /^f[cd]/i.test(ip) || /^fe80/i.test(ip);
}

async function handle(conn: Deno.Conn) {
  const peer = (conn.remoteAddr as Deno.NetAddr).hostname;
  const buf = new Uint8Array(8192);
  let head = "";
  while (!head.includes("\r\n\r\n")) {
    const n = await conn.read(buf);
    if (n === null) return conn.close();
    head += dec.decode(buf.subarray(0, n));
    if (head.length > 16384) return conn.close();
  }
  const [method, target] = head.split("\r\n")[0]!.split(" ");
  const deny = async (reason: string) => {
    record({ peer, method, target, verdict: "deny", reason });
    await conn.write(
      enc.encode("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n"),
    ).catch(() => {});
    conn.close();
  };
  if (method !== "CONNECT" || !target) return deny("not CONNECT");
  const m = target.match(/^([^:\[\]]+):(\d+)$/);
  if (!m) return deny("bad target");
  const host = m[1]!.toLowerCase();
  const port = Number(m[2]);
  if (port !== 443) return deny("port");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return deny("ip literal");
  if (!allow.has(host)) return deny("host not allowed");
  let addrs: string[];
  try {
    addrs = await Deno.resolveDns(host, "A");
  } catch (e) {
    return deny(`dns: ${(e as Error).message}`);
  }
  if (addrs.length === 0 || addrs.some(isPrivate)) {
    return deny("private address");
  }
  let upstream: Deno.Conn;
  try {
    upstream = await Deno.connect({ hostname: addrs[0]!, port });
  } catch (e) {
    return deny(`upstream: ${(e as Error).message}`);
  }
  record({ peer, method, target, verdict: "allow", ip: addrs[0] });
  await conn.write(enc.encode("HTTP/1.1 200 Connection Established\r\n\r\n"));
  await Promise.allSettled([
    conn.readable.pipeTo(upstream.writable),
    upstream.readable.pipeTo(conn.writable),
  ]);
}

const listener = Deno.listen({ hostname: "0.0.0.0", port: Number(portArg) });
record({ event: "listening", port: Number(portArg), allow: [...allow] });
for await (const conn of listener) handle(conn).catch(() => conn.close());
