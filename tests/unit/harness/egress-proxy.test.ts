import { assert, assertEquals, assertThrows } from "@std/assert";
import { ConfigurationError } from "../../../src/errors.ts";
import {
  type EgressLogLine,
  type HostLogLine,
  MAX_CONNECTIONS,
  PRE_AUTH_PER_SOURCE,
  PROXY_ISOLATION,
  type SharedProxyOptions,
  startSharedEgressProxy,
} from "../../../src/harness/egress-proxy.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const A = "172.30.60.10";
const B = "172.30.60.11";

/** A shared proxy on loopback; sourceOf takes the next queued fake source (connects are sequential). */
function setup(o: Partial<SharedProxyOptions> = {}) {
  const host: HostLogLine[] = [];
  const sources: string[] = [];
  const upstream = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const held: Deno.Conn[] = [];
  (async () => {
    for await (const c of upstream) held.push(c);
  })();
  const proxy = startSharedEgressProxy({
    hostname: "127.0.0.1",
    port: 0,
    allowedHosts: ["127.0.0.1"],
    hostLog: (l) => {
      host.push(l);
    },
    resolve: () => Promise.resolve(["93.184.216.34"]),
    dial: () =>
      Deno.connect({
        hostname: "127.0.0.1",
        port: (upstream.addr as Deno.NetAddr).port,
      }),
    authDelayMs: 0,
    sourceOf: () => sources.shift() ?? "127.0.0.1",
    ...o,
  });
  return {
    proxy,
    host,
    sources,
    held,
    async close() {
      await proxy.shutdown();
      upstream.close();
      for (const c of held) {
        try {
          c.close();
        } catch { /* closed */ }
      }
    },
  };
}

function lines() {
  const out: EgressLogLine[] = [];
  return { out, log: (l: EgressLogLine) => (out.push(l), Promise.resolve()) };
}

type Cred = { user: string; pass: string };

async function open(
  port: number,
  target: string,
  auth: Cred | string | null,
): Promise<Deno.Conn> {
  const c = await Deno.connect({ hostname: "127.0.0.1", port });
  const h = auth === null
    ? ""
    : typeof auth === "string"
    ? `Proxy-Authorization: ${auth}\r\n`
    : `Proxy-Authorization: Basic ${btoa(`${auth.user}:${auth.pass}`)}\r\n`;
  await c.write(
    enc.encode(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${h}\r\n`),
  );
  return c;
}

/** The status code of the first reply, or "EOF" when the socket closes first. */
async function status(c: Deno.Conn): Promise<string> {
  let text = "";
  const buf = new Uint8Array(512);
  for (;;) {
    let n: number | null;
    try {
      n = await c.read(buf);
    } catch {
      n = null;
    }
    if (n === null) break;
    text += dec.decode(buf.subarray(0, n));
    if (text.includes("\r\n")) break;
  }
  return text ? text.split(" ")[1]! : "EOF";
}

async function readToEnd(c: Deno.Conn): Promise<string> {
  let text = "";
  const buf = new Uint8Array(512);
  for (;;) {
    const n = await c.read(buf).catch(() => null);
    if (n === null) return text;
    text += dec.decode(buf.subarray(0, n));
  }
}

const done = (c: Deno.Conn) => {
  try {
    c.close();
  } catch { /* closed */ }
};

Deno.test("shared proxy: PROXY_ISOLATION is 2", () => {
  assertEquals(PROXY_ISOLATION, 2);
});

Deno.test("shared proxy register: random credential, one registration per source, a source is required and fixed", async () => {
  const s = setup();
  try {
    const a = lines();
    const { credential, reg } = s.proxy.register({
      allow: ["a.test"],
      log: a.log,
      source: A,
    });
    assert(/^[0-9a-f]{32}$/.test(credential.user), credential.user);
    assert(/^[A-Za-z0-9_-]{43}$/.test(credential.pass), credential.pass);
    assertEquals(reg.source, A);
    assertEquals(reg.failed, false);
    const other = s.proxy.register({ allow: [], log: a.log, source: B });
    assert(other.credential.user !== credential.user);
    assert(other.credential.pass !== credential.pass);
    for (const source of ["", "not-an-ip", A]) {
      assertThrows(
        () => s.proxy.register({ allow: [], log: a.log, source }),
        ConfigurationError,
      );
    }
    assertThrows(
      () =>
        s.proxy.register({
          allow: [],
          log: a.log,
          source: undefined as unknown as string,
        }),
      ConfigurationError,
    );
    assertThrows(
      () =>
        s.proxy.register({
          allow: ["1.1.1.1"],
          log: a.log,
          source: "10.1.1.1",
        }),
      ConfigurationError,
    );
    assertThrows(() => {
      (reg as { source: string }).source = B;
    });
    s.sources.push(A);
    const c = await open(s.proxy.port, "a.test:443", credential);
    assertEquals(await status(c), "200");
    done(c);
    await reg.unregister();
    // Freed: the source can be registered again.
    s.proxy.register({ allow: [], log: a.log, source: A });
  } finally {
    await s.close();
  }
});

Deno.test("shared proxy auth: missing, malformed, non-Basic, unknown and revoked get one identical, delayed 407 and never reach resolve or dial", async () => {
  let reached = 0;
  const s = setup({
    authDelayMs: 150,
    resolve: () => {
      reached++;
      throw new Error("resolve must not run");
    },
    dial: () => {
      reached++;
      throw new Error("dial must not run");
    },
  });
  try {
    const live = lines();
    const gone = lines();
    s.proxy.register({ allow: ["a.test"], log: live.log, source: A });
    const r = s.proxy.register({ allow: ["a.test"], log: gone.log, source: B });
    await r.reg.unregister();
    const unknown = { user: "0".repeat(32), pass: "x".repeat(43) };
    const replies: string[] = [];
    for (
      const auth of [
        null,
        "Basic !!!not-base64",
        `Bearer ${btoa(`${r.credential.user}:${r.credential.pass}`)}`,
        unknown,
        r.credential,
      ]
    ) {
      s.sources.push(A);
      const t0 = performance.now();
      const c = await open(s.proxy.port, "a.test:443", auth);
      replies.push(await readToEnd(c));
      assert(performance.now() - t0 >= 140, "minimum delay");
      done(c);
    }
    assert(replies[0]!.startsWith("HTTP/1.1 407 "), replies[0]);
    assert(replies[0]!.includes('Proxy-Authenticate: Basic realm="cg"\r\n'));
    for (const x of replies) assertEquals(x, replies[0]);
    assertEquals(reached, 0);
    assertEquals(live.out, []);
    assertEquals(gone.out, []);
    assertEquals(s.host.map((l) => l.reason), [
      "missing credential",
      "malformed credential",
      "not basic",
      "unknown credential",
      "unknown credential",
    ]);
    const text = JSON.stringify(s.host);
    assert(!text.includes(r.credential.pass), "no secret in the host log");
  } finally {
    await s.close();
  }
});

Deno.test("shared proxy policy: each registration's own allowlist, lines only in its own log; record mode per registration", async () => {
  const s = setup({
    resolve: (h) =>
      Promise.resolve(h === "internal.test" ? ["10.0.0.5"] : ["93.184.216.34"]),
  });
  try {
    const a = lines();
    const b = lines();
    const r = lines();
    const ra = s.proxy.register({ allow: ["a.test"], log: a.log, source: A });
    const rb = s.proxy.register({ allow: ["b.test"], log: b.log, source: B });
    const rr = s.proxy.register({
      allow: [],
      log: r.log,
      record: true,
      source: "172.30.60.12",
    });
    const probe = async (src: string, target: string, cred: Cred) => {
      s.sources.push(src);
      const c = await open(s.proxy.port, target, cred);
      const code = await status(c);
      done(c);
      return code;
    };
    assertEquals(await probe(A, "b.test:443", ra.credential), "403");
    assertEquals(await probe(A, "a.test:443", ra.credential), "200");
    assertEquals(await probe(B, "b.test:443", rb.credential), "200");
    assertEquals(await probe(B, "a.test:443", rb.credential), "403");
    assertEquals(
      await probe("172.30.60.12", "any.example.test:443", rr.credential),
      "200",
    );
    assertEquals(
      await probe("172.30.60.12", "1.1.1.1:443", rr.credential),
      "403",
    );
    assertEquals(
      await probe("172.30.60.12", "internal.test:443", rr.credential),
      "403",
    );
    assertEquals(a.out.map((l) => [l.decision, l.target, l.reason]), [
      ["deny", "b.test:443", "host not allowed"],
      ["allow", "a.test:443", "allowed"],
    ]);
    assertEquals(b.out.map((l) => [l.decision, l.target, l.reason]), [
      ["allow", "b.test:443", "allowed"],
      ["deny", "a.test:443", "host not allowed"],
    ]);
    assertEquals(r.out.map((l) => [l.decision, l.reason]), [
      ["allow", "allowed"],
      ["deny", "ip literal"],
      ["deny", "private address"],
    ]);
  } finally {
    await s.close();
  }
});

Deno.test("shared proxy: the registration log is awaited before 200 and before 403", async () => {
  const s = setup();
  try {
    let release = () => {};
    const seen: EgressLogLine[] = [];
    const { credential } = s.proxy.register({
      allow: ["a.test"],
      log: (l) => {
        seen.push(l);
        return new Promise<void>((r) => release = r);
      },
      source: A,
    });
    for (
      const [target, want] of [["a.test:443", "200"], ["x.test:443", "403"]]
    ) {
      s.sources.push(A);
      const c = await open(s.proxy.port, target!, credential);
      const buf = new Uint8Array(64);
      const pending = c.read(buf);
      const early = await Promise.race([
        pending,
        sleep(200).then(() => "wait"),
      ]);
      assertEquals(early, "wait", `no ${want} before the log line is written`);
      assertEquals(seen.length > 0, true);
      release();
      const n = (await pending) ?? 0;
      assertEquals(dec.decode(buf.subarray(0, n)).split(" ")[1], want);
      done(c);
    }
  } finally {
    await s.close();
  }
});

Deno.test("shared proxy: a rejected log write closes without a status, fails and revokes the registration", async () => {
  for (const target of ["a.test:443", "x.test:443"]) {
    const s = setup();
    try {
      const failures: string[] = [];
      const { credential, reg } = s.proxy.register({
        allow: ["a.test"],
        log: () => Promise.reject(new Error("disk full")),
        source: A,
        onFailure: (f) => failures.push(f),
      });
      s.sources.push(A);
      const c = await open(s.proxy.port, target, credential);
      assertEquals(await status(c), "EOF", target);
      done(c);
      assertEquals(reg.failed, true);
      assertEquals(reg.failure, "egress_log_failed");
      assertEquals(failures, ["egress_log_failed"]);
      // Revoked: the source is no longer admitted at all.
      s.sources.push(A);
      const again = await open(s.proxy.port, "a.test:443", credential);
      assertEquals(await status(again), "EOF");
      done(again);
    } finally {
      await s.close();
    }
  }
});

Deno.test("shared proxy: revoked while the allow line is written, the dialed socket is closed and no 200 is sent", async () => {
  const s = setup({ unregisterTimeoutMs: 100 });
  try {
    let release = () => {};
    let logged = () => {};
    const inLog = new Promise<void>((r) => logged = r);
    const { credential, reg } = s.proxy.register({
      allow: ["a.test"],
      log: () => {
        logged();
        return new Promise<void>((r) => release = r);
      },
      source: A,
    });
    s.sources.push(A);
    const c = await open(s.proxy.port, "a.test:443", credential);
    await inLog;
    await reg.unregister();
    release();
    assert((await readToEnd(c)).indexOf(" 200 ") < 0);
    done(c);
    await sleep(50);
    // The recheck before 200 saw the revocation.
    assertEquals(s.host.map((l) => l.reason), ["revoked"]);
    assertEquals(s.held.length, 1);
    assertEquals(
      await s.held[0]!.read(new Uint8Array(8)).catch(() => null),
      null,
    );
  } finally {
    await s.close();
  }
});

Deno.test("shared proxy unregister: a pending dial is aborted and nothing is sent", async () => {
  let signal: AbortSignal | undefined;
  let dialing = () => {};
  const inDial = new Promise<void>((r) => dialing = r);
  const s = setup({
    unregisterTimeoutMs: 2_000,
    dial: (_a, _p, sig) => {
      signal = sig;
      dialing();
      return new Promise<Deno.Conn>(() => {}); // never settles by itself
    },
  });
  try {
    const a = lines();
    const { credential, reg } = s.proxy.register({
      allow: ["a.test"],
      log: a.log,
      source: A,
    });
    s.sources.push(A);
    const c = await open(s.proxy.port, "a.test:443", credential);
    await inDial;
    const t0 = performance.now();
    await reg.unregister();
    assert(
      performance.now() - t0 < 1_000,
      "unregister did not wait out the bound",
    );
    assertEquals(signal?.aborted, true);
    assert((await readToEnd(c)).indexOf(" 200 ") < 0);
    done(c);
    assertEquals(a.out, []);
  } finally {
    await s.close();
  }
});

Deno.test("shared proxy admission: unregistered sources are closed unread; a source's pre-auth quota never starves another source", async () => {
  const s = setup({ headerTimeoutMs: 5_000 });
  const open_: Deno.Conn[] = [];
  try {
    const b = lines();
    s.proxy.register({ allow: [], log: lines().log, source: A });
    const rb = s.proxy.register({ allow: ["b.test"], log: b.log, source: B });
    const attackers = ["172.30.60.20", "172.30.60.21", "172.30.60.22"];
    for (const x of attackers) {
      s.proxy.register({ allow: [], log: lines().log, source: x });
    }
    s.sources.push("172.30.60.99");
    const stranger = await open(s.proxy.port, "b.test:443", rb.credential);
    assertEquals(await status(stranger), "EOF");
    done(stranger);
    // (a) A holds its quota of silent sockets; 60 more from A are refused.
    for (let i = 0; i < PRE_AUTH_PER_SOURCE; i++) {
      s.sources.push(A);
      open_.push(
        await Deno.connect({ hostname: "127.0.0.1", port: s.proxy.port }),
      );
    }
    for (let i = 0; i < 60; i++) {
      s.sources.push(A);
      const c = await Deno.connect({
        hostname: "127.0.0.1",
        port: s.proxy.port,
      });
      assertEquals(await status(c), "503");
      done(c);
    }
    // (b) Three more attacker sources, each at its quota, plus one over it.
    for (const x of attackers) {
      for (let i = 0; i < PRE_AUTH_PER_SOURCE; i++) {
        s.sources.push(x);
        open_.push(
          await Deno.connect({ hostname: "127.0.0.1", port: s.proxy.port }),
        );
      }
      s.sources.push(x);
      const c = await Deno.connect({
        hostname: "127.0.0.1",
        port: s.proxy.port,
      });
      assertEquals(await status(c), "503");
      done(c);
    }
    s.sources.push(B);
    const c = await open(s.proxy.port, "b.test:443", rb.credential);
    assertEquals(await status(c), "200");
    done(c);
  } finally {
    for (const c of open_) done(c);
    await s.close();
  }
});

Deno.test("shared proxy admission: a registration at its post-auth cap gets 503, another registration is unaffected", async () => {
  assertEquals(MAX_CONNECTIONS, 64);
  const s = setup({ maxConnections: 1 });
  const tunnels: Deno.Conn[] = [];
  try {
    const a = lines();
    const ra = s.proxy.register({ allow: ["a.test"], log: a.log, source: A });
    const rb = s.proxy.register({
      allow: ["b.test"],
      log: lines().log,
      source: B,
    });
    s.sources.push(A);
    tunnels.push(await open(s.proxy.port, "a.test:443", ra.credential));
    assertEquals(await status(tunnels[0]!), "200");
    s.sources.push(A);
    const over = await open(s.proxy.port, "a.test:443", ra.credential);
    assertEquals(await status(over), "503");
    done(over);
    s.sources.push(B);
    tunnels.push(await open(s.proxy.port, "b.test:443", rb.credential));
    assertEquals(await status(tunnels[1]!), "200");
    assertEquals(a.out.map((l) => [l.decision, l.reason]), [
      ["allow", "allowed"],
      ["error", "too many connections"],
    ]);
  } finally {
    for (const c of tunnels) done(c);
    await s.close();
  }
});

Deno.test("shared proxy failed: a host-log failure revokes every registration as egress_proxy_failed and refuses new CONNECTs", async () => {
  const s = setup({
    hostLog: () => Promise.reject(new Error("host log disk full")),
  });
  try {
    const failures: string[] = [];
    const ra = s.proxy.register({
      allow: ["a.test"],
      log: lines().log,
      source: A,
      onFailure: (f) => failures.push(f),
    });
    const rb = s.proxy.register({
      allow: ["b.test"],
      log: lines().log,
      source: B,
    });
    s.sources.push(A);
    const c = await open(s.proxy.port, "a.test:443", null);
    await readToEnd(c);
    done(c);
    assertEquals(s.proxy.failed, true);
    for (const r of [ra.reg, rb.reg]) {
      assertEquals(r.failed, true);
      assertEquals(r.failure, "egress_proxy_failed");
    }
    assertEquals(failures, ["egress_proxy_failed"]);
    s.sources.push(B);
    const after = await open(s.proxy.port, "b.test:443", rb.credential);
    assertEquals(await status(after), "503");
    done(after);
    assertThrows(() =>
      s.proxy.register({ allow: [], log: lines().log, source: "172.30.60.30" })
    );
  } finally {
    await s.close();
  }
});

Deno.test("shared proxy failed: a listener error fails the proxy and every registration", async () => {
  let breakAccept = (_e: Error) => {};
  const real = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const s = setup({
    listen: () =>
      ({
        addr: real.addr,
        accept: () => new Promise<Deno.Conn>((_, rej) => breakAccept = rej),
        close: () => real.close(),
      }) as unknown as Deno.Listener,
  });
  try {
    const { reg } = s.proxy.register({
      allow: [],
      log: lines().log,
      source: A,
    });
    await sleep(10);
    breakAccept(new Error("listener broke"));
    await sleep(10);
    assertEquals(s.proxy.failed, true);
    assertEquals(reg.failure, "egress_proxy_failed");
  } finally {
    await s.close();
  }
});

Deno.test("shared proxy admission: over-cap requests stay charged to the source's pre-auth quota while their log line blocks; another registration still gets 200", async () => {
  const s = setup({ maxConnections: 1 });
  const held: Deno.Conn[] = [];
  let unblock = () => {};
  const blocked = new Promise<void>((r) => unblock = r);
  try {
    const ra = s.proxy.register({
      allow: ["a.test"],
      log: (l) => l.decision === "error" ? blocked : Promise.resolve(),
      source: A,
    });
    const rb = s.proxy.register({
      allow: ["b.test"],
      log: lines().log,
      source: B,
    });
    s.sources.push(A);
    held.push(await open(s.proxy.port, "a.test:443", ra.credential));
    assertEquals(await status(held[0]!), "200");
    let lingering = 0;
    let refused = 0;
    for (let i = 0; i < PRE_AUTH_PER_SOURCE + 6; i++) {
      s.sources.push(A);
      const c = await open(s.proxy.port, "a.test:443", ra.credential);
      const got = await Promise.race([status(c), sleep(150).then(() => "")]);
      if (got === "") {
        lingering++;
        held.push(c);
      } else {
        assertEquals(got, "503");
        refused++;
        done(c);
      }
    }
    assertEquals(lingering, PRE_AUTH_PER_SOURCE);
    assertEquals(refused, 6);
    s.sources.push(B);
    const b = await open(s.proxy.port, "b.test:443", rb.credential);
    assertEquals(await status(b), "200");
    held.push(b);
  } finally {
    unblock();
    for (const c of held) done(c);
    await s.close();
  }
});
