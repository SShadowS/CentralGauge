import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { join } from "@std/path";
import { ConfigurationError, ValidationError } from "../../../src/errors.ts";
import {
  applyScript,
  blockedTcpRanges,
  COLLECT_PS,
  collectEgressState,
  combineObservation,
  decodeHnsBlob,
  type EgressState,
  evaluatePreflight,
  firewallPlan,
  type FirewallRule,
  hostsForRoutes,
  listenerProblems,
  loadRecordedHosts,
  parseHnsNetwork,
  parseProbeLines,
  PREFLIGHT_EXPECT,
  preflightExpect,
  PROXY_PORT,
  proxyCredentialForms,
  realEgressRuntime,
  RECORDED_HOSTS_PATH,
  recordedHostsJson,
  revertScript,
  ROUTE_HOSTS,
  RULE_GROUP,
  SANDBOX_NETWORK,
  sandboxSource,
  verifyEgressState,
} from "../../../src/harness/egress.ts";
import {
  isPrivateAddress,
  PROXY_ISOLATION,
  type RegisterOptions,
  type SharedEgressProxy,
  type SharedProxyOptions,
  startEgressProxy,
  startSharedEgressProxy,
} from "../../../src/harness/egress-proxy.ts";
import { blobB64, hns, networkBlob, REAL_HNS } from "../../utils/hns-blob.ts";

const IDX = 42;
const HNS_ID = "5F2A9C31-0B7E-4D12-9A3B-6C4D5E6F7A8B";

function goodState(): EgressState {
  return {
    network: {
      id: "net1",
      driver: "internal",
      subnet: SANDBOX_NETWORK.subnet,
      gateway: SANDBOX_NETWORK.gateway,
      hnsId: HNS_ID,
      networkName: "a1b2c3",
    },
    hns: {
      id: HNS_ID,
      name: "a1b2c3",
      type: "Internal",
      subnet: SANDBOX_NETWORK.subnet,
    },
    gatewayAdapter: { index: IDX, alias: "vEthernet (a1b2c3)", prefix: 24 },
    profiles: ["Domain", "Private", "Public"].map((name) => ({
      name,
      enabled: true,
      inbound: "Allow",
      outbound: "Allow",
    })),
    groupRules: firewallPlan(IDX),
    foreignBlockRules: [],
    marker: { state: "qualified", networkId: "net1", interfaceIndex: IDX },
  };
}

Deno.test("blockedTcpRanges: complementary ranges around the proxy and the backend", () => {
  assertEquals(blockedTcpRanges([3210, 3128]), [
    "1-3127",
    "3129-3209",
    "3211-65535",
  ]);
  assertEquals(blockedTcpRanges([1, 65535]), ["2-65534"]);
});

Deno.test("firewallPlan: enabled inbound blocks only, every protocol, on one interface index; never a TCP block over 3128 or 3210", () => {
  const plan = firewallPlan(IDX);
  assert(
    plan.every((r) =>
      r.enabled && r.direction === "Inbound" && r.action === "Block" &&
      r.profile === "Any" && r.interfaceIndex === IDX
    ),
  );
  assert(
    plan.every((r) =>
      r.remoteAddress === "Any" && r.localAddress === "Any" &&
      r.program === "Any" && r.service === "Any"
    ),
  );
  const tcp = plan.filter((r) => r.protocol === 6);
  assertEquals([tcp.length, tcp[0]!.localPorts], [1, [
    "1-3127",
    "3129-3209",
    "3211-65535",
  ]]);
  const others = plan.filter((r) => r.protocol !== 6).map((r) => r.protocol);
  assertEquals(others.length, 255);
  assert([1, 17, 58, 47].every((n) => others.includes(n)));
  assertThrows(() => firewallPlan(0), ConfigurationError);
});

Deno.test("applyScript: refuses before any change, inventories effective foreign blocks, defaults Allow before enabling, per-invocation rollback", () => {
  const s = applyScript(firewallPlan(IDX), {
    invocation: "inv1",
    dir: "C:\\cg\\fw",
    interfaceAlias: "vEthernet (a1b2c3)",
    hnsId: "hns1",
  });
  const at = (x: string) => s.indexOf(x);
  assert(
    at("Get-NetFirewallRule -Group") < at("Set-NetFirewallProfile"),
    "an existing group refuses before any change",
  );
  assert(
    at("-PolicyStore ActiveStore -Enabled True -Action Block") <
      at("Set-NetFirewallProfile"),
    "effective inventory before any change",
  );
  assertStringIncludes(s, "fw-block-inventory-inv1.json");
  assertStringIncludes(s, "owner decision required");
  assert(at("fw-snapshot-inv1.json") < at("Set-NetFirewallProfile"));
  assert(
    at("-DefaultInboundAction Allow -DefaultOutboundAction Allow") <
      at("Set-NetFirewallProfile -All -Enabled True"),
  );
  assertEquals(s.match(/New-NetFirewallRule/g)!.length, 256);
  assert(!/-Direction Outbound|-Action Allow |Set-NetFirewallHyperV/.test(s));
  assertStringIncludes(s, "fw-apply-inv1.json");
  assertStringIncludes(s, "$created"); // rollback removes only this invocation's rules
  assertStringIncludes(s, `-Group '${RULE_GROUP}'`);
});

Deno.test("revertScript: removes the group, restores the applied snapshot, archives the invocation files for a clean re-apply", () => {
  const s = revertScript("C:\\cg\\fw");
  assertStringIncludes(s, `Remove-NetFirewallRule -Group '${RULE_GROUP}'`);
  assertStringIncludes(
    s,
    "Set-NetFirewallProfile -Name $p.Name -Enabled $p.Enabled -DefaultInboundAction $p.DefaultInboundAction -DefaultOutboundAction $p.DefaultOutboundAction",
  );
  assertStringIncludes(s, ".reverted-");
});

Deno.test("verifyEgressState: effective-policy mutations are each a named problem", () => {
  assertEquals(verifyEgressState(goodState()), []);
  const cases: [string, (s: EgressState) => void][] = [
    ["network", (s) => (s.network = null)],
    ["internal", (s) => (s.network!.driver = "nat")],
    ["hns", (s) => (s.hns!.type = "NAT")],
    ["prefix", (s) => (s.gatewayAdapter!.prefix = 16)],
    ["vethernet", (s) => (s.gatewayAdapter!.alias = "Ethernet 2")],
    ["vethernet", (s) => (s.hns!.name = "other")],
    ["disabled", (s) => (s.groupRules[0]!.enabled = false)],
    ["direction", (s) => (s.groupRules[1]!.direction = "Outbound")],
    ["action", (s) => (s.groupRules[2]!.action = "Allow")],
    ["profile", (s) => (s.groupRules[3]!.profile = "Domain")],
    ["remote", (s) => (s.groupRules[0]!.remoteAddress = "10.0.0.0/8")],
    ["program", (s) => (s.groupRules[0]!.program = "C:\\x.exe")],
    ["interface", (s) => (s.groupRules[4]!.interfaceIndex = 7)],
    ["ports", (s) => (s.groupRules[0]!.localPorts = ["1-65535"])],
    ["missing rule", (s) => s.groupRules.pop()],
    [
      "extra rule",
      (s) => s.groupRules.push({ ...s.groupRules[1]!, name: "x" }),
    ],
    ["firewall profile", (s) => (s.profiles[2]!.enabled = false)],
    ["default inbound", (s) => (s.profiles[0]!.inbound = "Block")],
    ["default outbound", (s) => (s.profiles[1]!.outbound = "Block")],
    [
      "foreign block",
      (s) => (s.foreignBlockRules = ["Some app block (policy)"]),
    ],
    ["profiles", (s) => (s.profiles = [])],
    [
      "profiles",
      (s) => (s.profiles = [s.profiles[0]!, s.profiles[0]!, s.profiles[1]!]),
    ],
    ["recreated", (s) => (s.network!.id = "net2")],
    ["recreated", (s) => (s.gatewayAdapter!.index = 43)],
  ];
  for (const [word, mutate] of cases) {
    const s = goodState();
    mutate(s);
    const p = verifyEgressState(s);
    assert(
      p.length > 0 && p.join("\n").toLowerCase().includes(word),
      `${word}: ${p.join("; ")}`,
    );
  }
});

Deno.test("evaluatePreflight: every negative must fail, every positive pass, no probe missing", () => {
  const all = Object.entries(PREFLIGHT_EXPECT).map(([probe, ok]) => ({
    probe,
    ok,
  }));
  assertEquals(evaluatePreflight(all), []);
  for (
    const p of [
      "direct-https",
      "dns-1.1.1.1",
      "lan-router",
      "gw-smb-445",
      "gw-rdp-3389",
      "gw-winrm-5985",
      "gw-winrm-47001",
      "gw-ssh-22",
      "gw-docker-443",
      "gw-docker-3001",
      "gw-rpc-135",
      "gw-vmms-2179",
      "gw-udp-3202",
      "gw-icmp",
      "proxy-deny-example.com",
      "proxy-ip-literal",
    ]
  ) {
    assertEquals(PREFLIGHT_EXPECT[p], false, p);
  }
  assertEquals([
    PREFLIGHT_EXPECT["proxy-allow-api.anthropic.com"],
    PREFLIGHT_EXPECT["backend-3210"],
  ], [true, true]);
  assertStringIncludes(
    evaluatePreflight(
      all.map((l) => l.probe === "gw-smb-445" ? { ...l, ok: true } : l),
    ).join("\n"),
    "gw-smb-445",
  );
  assertStringIncludes(evaluatePreflight(all.slice(1)).join("\n"), "missing");
  const broken = all.map((l) =>
    l.probe === "gw-icmp"
      ? {
        ...l,
        ok: false,
        error:
          "The term 'Test-Connection' parameter TimeoutSeconds was not found",
      }
      : l
  );
  assertStringIncludes(evaluatePreflight(broken).join("\n"), "could not run");
});

Deno.test("collectEgressState: a failed or truncated observation throws; it is never an empty inventory", async () => {
  const run = (out: string) => () => Promise.resolve({ code: 0, stdout: out });
  await assertRejects(() => collectEgressState(run("")), Error, "egress");
  await assertRejects(
    () => collectEgressState(run('{"profiles":[')),
    Error,
    "egress",
  );
  await assertRejects(
    () =>
      collectEgressState(() =>
        Promise.resolve({ code: 1, stdout: "Access denied" })
      ),
    Error,
    "egress",
  );
});

Deno.test("egress-check.ps1 ships in the base image and bounds every probe itself", async () => {
  assertStringIncludes(
    await Deno.readTextFile("harness/images/base/Dockerfile.windows"),
    "COPY egress-check.ps1 C:/egress-check.ps1",
  );
  const ps = await Deno.readTextFile("harness/images/base/egress-check.ps1");
  assertStringIncludes(ps, ".Wait(3000)");
  assertStringIncludes(ps, "System.Net.NetworkInformation.Ping");
  assert(!ps.includes("Test-NetConnection") && !ps.includes("-TimeoutSeconds"));
  assertStringIncludes(ps, "error ="); // execution errors are reported separately from blocked connections
  for (const probe of Object.keys(PREFLIGHT_EXPECT)) {
    assertStringIncludes(ps, `'${probe}'`);
  }
});

Deno.test("proxy: exact allowlist, CONNECT 443 only, no IP literals, no private resolutions, gateway bind only", async () => {
  const lines: { decision: string; target: string; reason: string }[] = [];
  const resolve = (h: string) =>
    Promise.resolve(h === "internal.test" ? ["10.0.0.5"] : ["93.184.216.34"]);
  for (const h of ["0.0.0.0", "::", "192.168.2.99"]) {
    assertThrows(
      () =>
        startEgressProxy({
          hostname: h,
          port: 0,
          allow: [],
          log: () => {},
          allowedHosts: ["127.0.0.1"],
        }),
      ConfigurationError,
    );
  }
  const p = startEgressProxy({
    hostname: "127.0.0.1",
    port: 0,
    allow: ["allowed.test", "internal.test"],
    log: (l) => lines.push(l),
    resolve,
    allowedHosts: ["127.0.0.1"],
    dial: () => Promise.reject(new Error("no network in unit tests")),
  });
  try {
    const status = async (reqLine: string) => {
      const c = await Deno.connect({ hostname: "127.0.0.1", port: p.port });
      await c.write(new TextEncoder().encode(reqLine));
      const buf = new Uint8Array(64);
      const n = (await c.read(buf)) ?? 0;
      c.close();
      return new TextDecoder().decode(buf.subarray(0, n)).split(" ")[1];
    };
    assertEquals(
      await status(
        "CONNECT denied.test:443 HTTP/1.1\r\nHost: denied.test:443\r\n\r\n",
      ),
      "403",
    );
    assertEquals(
      await status(
        "CONNECT allowed.test:80 HTTP/1.1\r\nHost: allowed.test:80\r\n\r\n",
      ),
      "403",
    );
    assertEquals(
      await status("CONNECT 1.1.1.1:443 HTTP/1.1\r\nHost: 1.1.1.1:443\r\n\r\n"),
      "403",
    );
    assertEquals(
      await status(
        "CONNECT internal.test:443 HTTP/1.1\r\nHost: internal.test:443\r\n\r\n",
      ),
      "403",
    );
    assertEquals(
      await status(
        "GET http://allowed.test/ HTTP/1.1\r\nHost: allowed.test\r\n\r\n",
      ),
      "403",
    );
    assertEquals(
      await status(
        "CONNECT allowed.test:443 HTTP/1.1\r\nHost: allowed.test:443\r\n\r\n",
      ),
      "502",
    );
    assertEquals(lines.map((l) => l.reason), [
      "host not allowed",
      "port",
      "ip literal",
      "private address",
      "method",
      "dial failed",
    ]);
  } finally {
    await p.shutdown();
  }
});

// M1-33 amendment A1-A3 and the implementer's additions.

Deno.test("hostsForRoutes (A1): one route-to-host policy, fails closed on an unknown route and on an unrecorded OAuth route", () => {
  assertEquals(ROUTE_HOSTS["openrouter:api-key"], ["openrouter.ai"]);
  assertEquals(hostsForRoutes(["openrouter:api-key"], {}), ["openrouter.ai"]);
  assertEquals(hostsForRoutes([], {}), []);
  assertThrows(
    () => hostsForRoutes(["openai:api-key"], {}),
    ConfigurationError,
    "openai:api-key",
  );
  // Until M1-34 Step 11 records the OAuth hosts, an enforced Claude run is refused.
  assertThrows(
    () => hostsForRoutes(["anthropic:first-party-oauth"], {}),
    ConfigurationError,
    RECORDED_HOSTS_PATH,
  );
  assertEquals(
    hostsForRoutes([
      "anthropic:first-party-oauth",
      "anthropic:first-party-oauth",
    ], {
      "anthropic:first-party-oauth": ["b.example.test"],
    }),
    ["api.anthropic.com", "b.example.test"],
  );
  // An empty recording refuses like a missing one (review item 3).
  assertThrows(
    () =>
      hostsForRoutes(["anthropic:first-party-oauth"], {
        "anthropic:first-party-oauth": [],
      }),
    ConfigurationError,
    RECORDED_HOSTS_PATH,
  );
});

Deno.test("loadRecordedHosts: missing file is no recording; a malformed file or an unrecordable route is refused", async () => {
  const root = await Deno.realPath(await Deno.makeTempDir());
  assertEquals(await loadRecordedHosts(root), {});
  const path = join(root, ...RECORDED_HOSTS_PATH.split("/"));
  await Deno.mkdir(join(path, ".."), { recursive: true });
  const write = (v: unknown) => Deno.writeTextFile(path, JSON.stringify(v));
  await write({
    v: 1,
    source: "M1-34 Step 11",
    routes: { "anthropic:first-party-oauth": ["x.example.test"] },
  });
  assertEquals(await loadRecordedHosts(root), {
    "anthropic:first-party-oauth": ["x.example.test"],
  });
  for (
    const bad of [
      { v: 1, source: "s", routes: { "openrouter:api-key": ["x.test"] } },
      {
        v: 1,
        source: "s",
        routes: { "anthropic:first-party-oauth": ["1.2.3.4"] },
      },
      {
        v: 1,
        source: "s",
        routes: { "anthropic:first-party-oauth": ["*.x.test"] },
      },
      { v: 2, source: "s", routes: {} },
      { v: 1, source: "s", routes: { "anthropic:first-party-oauth": [] } },
    ]
  ) {
    await write(bad);
    await assertRejects(
      () => loadRecordedHosts(root),
      ConfigurationError,
      RECORDED_HOSTS_PATH,
    );
  }
  await Deno.writeTextFile(path, "{");
  await assertRejects(() => loadRecordedHosts(root), ConfigurationError);
});

Deno.test("preflightExpect (A2): the positive proxy probes are exactly the execution's hosts", () => {
  const pi = preflightExpect(["openrouter.ai"]);
  const allow = (e: Record<string, boolean>) =>
    Object.keys(e).filter((k) => k.startsWith("proxy-allow-"));
  assertEquals(allow(pi), ["proxy-allow-openrouter.ai"]);
  assertEquals(pi["proxy-allow-openrouter.ai"], true);
  assertEquals(allow(preflightExpect([])), []);
  assertEquals(PREFLIGHT_EXPECT, preflightExpect(["api.anthropic.com"]));
  // A Claude arm's positive probe is not accepted from a pi arm's lines.
  const lines = Object.entries(pi).map(([probe, ok]) => ({ probe, ok }));
  assertEquals(evaluatePreflight(lines, pi), []);
  assertStringIncludes(
    evaluatePreflight(lines).join("\n"),
    "proxy-allow-api.anthropic.com",
  );
  assertStringIncludes(
    evaluatePreflight([...lines, { probe: "proxy-allow-x.test", ok: true }], pi)
      .join("\n"),
    "unexpected",
  );
  assertStringIncludes(
    evaluatePreflight([...lines, lines[0]!], pi).join("\n"),
    "reported 2 times",
  );
  assertThrows(() => preflightExpect(["example.com"]), ConfigurationError);
  assertThrows(() => preflightExpect(["1.2.3.4"]), ConfigurationError);
});

Deno.test("parseProbeLines: every line is a probe result; anything else is named", () => {
  assertEquals(
    parseProbeLines('{"probe":"gw-icmp","ok":false,"error":null}\r\n\r\n'),
    [{ probe: "gw-icmp", ok: false }],
  );
  assertEquals(
    parseProbeLines('{"probe":"gw-icmp","ok":false,"error":"boom"}'),
    [{ probe: "gw-icmp", ok: false, error: "boom" }],
  );
  assertThrows(() => parseProbeLines(""), ValidationError, "no probe lines");
  assertThrows(
    () => parseProbeLines('{"probe":"gw-icmp","ok":false}\nWARNING x'),
    ValidationError,
    "line 2",
  );
  assertThrows(
    () => parseProbeLines('{"probe":"gw-icmp","ok":"False"}'),
    ValidationError,
    "line 1",
  );
});

Deno.test("listenerProblems: proxy and backend listen on the gateway only", () => {
  const gw = SANDBOX_NETWORK.gateway;
  assertEquals(
    listenerProblems([
      { port: 3128, address: gw },
      { port: 3210, address: gw },
    ]),
    [],
  );
  assertStringIncludes(
    listenerProblems([{ port: 3210, address: gw }]).join("\n"),
    "3128",
  );
  for (const wild of ["0.0.0.0", "::", "127.0.0.1"]) {
    assertStringIncludes(
      listenerProblems([
        { port: 3128, address: gw },
        { port: 3210, address: gw },
        { port: 3210, address: wild },
      ]).join("\n"),
      wild,
    );
  }
});

Deno.test("egress scripts are generated deterministically; revert touches only prefix-owned rules; inputs are checked", () => {
  const o = {
    invocation: "inv1",
    dir: "C:\\cg\\fw",
    interfaceAlias: "vEthernet (a1b2c3)",
    hnsId: "hns1",
  };
  assertEquals(
    applyScript(firewallPlan(IDX), o),
    applyScript(firewallPlan(IDX), o),
  );
  assertEquals(revertScript("C:\\cg\\fw"), revertScript("C:\\cg\\fw"));
  const s = applyScript(firewallPlan(IDX), o);
  assertStringIncludes(s, `InterfaceIndex -ne ${IDX}`); // the gateway's adapter must be the planned one
  const r = revertScript("C:\\cg\\fw");
  assertStringIncludes(r, `-notlike '${RULE_GROUP}-*'`);
  assert(
    r.indexOf(`-notlike '${RULE_GROUP}-*'`) <
      r.indexOf("Remove-NetFirewallRule"),
  );
  assertThrows(
    () => applyScript(firewallPlan(IDX), { ...o, invocation: "a b" }),
    ConfigurationError,
  );
  assertThrows(
    () => applyScript(firewallPlan(IDX), { ...o, interfaceAlias: "x\ny" }),
    ConfigurationError,
  );
  assertThrows(
    () => applyScript([], o),
    ConfigurationError,
  );
  assertStringIncludes(
    applyScript(firewallPlan(IDX), { ...o, interfaceAlias: "it's" }),
    "'it''s'",
  );
});

/** The HNS VolatileStore values the collector prints for docker's hnsid. */
function hnsValues(o: Partial<Parameters<typeof networkBlob>[0]> = {}) {
  return [{
    Name: HNS_ID,
    Kind: "Binary",
    Blob: blobB64(
      networkBlob({ id: HNS_ID, name: "a1b2c3", type: "Internal", ...o }),
    ),
  }];
}

/** The collector's raw observation of goodState(): rules and their filters read separately, in any order. */
function rawObservation() {
  const plan = firewallPlan(IDX);
  const each = <T extends object>(f: (r: FirewallRule) => T) =>
    plan.map((r) => ({ InstanceID: `{${r.name}}`, ...f(r) })).reverse();
  const raw = {
    network: {
      Id: "net1",
      Driver: "internal",
      Subnet: SANDBOX_NETWORK.subnet,
      Gateway: SANDBOX_NETWORK.gateway,
      HnsId: HNS_ID,
      NetworkName: "a1b2c3",
    },
    hns: hnsValues(),
    gatewayAdapter: { Index: IDX, Alias: "vEthernet (a1b2c3)", Prefix: 24 },
    profiles: ["Domain", "Private", "Public"].map((Name) => ({
      Name,
      Enabled: "True",
      DefaultInboundAction: "Allow",
      DefaultOutboundAction: "Allow",
    })),
    groupRules: plan.map((r) => ({
      InstanceID: `{${r.name}}`,
      Name: r.name,
      Enabled: "True",
      Direction: "Inbound",
      Action: "Block",
      Profile: "Any",
    })),
    filters: {
      port: each((r) => ({
        Protocol: r.protocol === 6
          ? "TCP"
          : r.protocol === 17
          ? "UDP"
          : String(r.protocol),
        LocalPort: r.localPorts === "Any"
          ? "Any" as string | string[]
          : [...r.localPorts].reverse(),
      })),
      address: each(() => ({ RemoteAddress: "Any", LocalAddress: "Any" })),
      application: each(() => ({ Program: "Any" })),
      service: each(() => ({ Service: "Any" })),
      interface: each(() => ({ InterfaceIndex: [IDX] as (number | null)[] })),
      interfaceType: each(() => ({ InterfaceType: "Any" })),
    },
    foreignBlockRules: [] as string[],
    marker: {
      v: 1,
      state: "qualified",
      network_id: "net1",
      interface_index: IDX,
    },
  };
  return raw;
}

Deno.test("collectEgressState: a complete observation is normalized; protocol names and port order do not matter", async () => {
  const raw = rawObservation();
  const s = await collectEgressState(() =>
    Promise.resolve({ code: 0, stdout: JSON.stringify(raw) })
  );
  assertEquals(verifyEgressState(s), []);
  assertEquals(s, goodState());
  const { groupRules: _g, ...partial } = raw;
  await assertRejects(
    () =>
      collectEgressState(() =>
        Promise.resolve({ code: 0, stdout: JSON.stringify(partial) })
      ),
    Error,
    "groupRules",
  );
  await assertRejects(
    () =>
      collectEgressState(() =>
        Promise.resolve({
          code: 0,
          stdout: JSON.stringify({ ...raw, marker: { state: "authorised" } }),
        })
      ),
    Error,
    "marker",
  );
});

Deno.test("proxy: the log never carries request bodies, paths or auth headers; a slow client is dropped", async () => {
  const lines: unknown[] = [];
  const p = startEgressProxy({
    hostname: "127.0.0.1",
    port: 0,
    allow: ["allowed.test"],
    log: (l) => lines.push(l),
    resolve: () => Promise.resolve(["93.184.216.34"]),
    allowedHosts: ["127.0.0.1"],
    dial: () => Promise.reject(new Error("no network")),
    headerTimeoutMs: 100,
  });
  try {
    const send = async (text: string) => {
      const c = await Deno.connect({ hostname: "127.0.0.1", port: p.port });
      await c.write(new TextEncoder().encode(text));
      const buf = new Uint8Array(64);
      const n = (await c.read(buf)) ?? 0;
      c.close();
      return new TextDecoder().decode(buf.subarray(0, n));
    };
    await send(
      "POST http://allowed.test/v1/x?key=SECRETQUERY HTTP/1.1\r\nProxy-Authorization: Basic SECRETAUTH\r\nContent-Length: 10\r\n\r\nSECRETBODY",
    );
    await send(
      "CONNECT denied.test:443 HTTP/1.1\r\nProxy-Authorization: Basic SECRETAUTH\r\n\r\n",
    );
    assertStringIncludes(
      await send("CONNECT allowed.test:443 HTTP/1.1\r\n"),
      "400",
    ); // no end of headers
    const text = JSON.stringify(lines);
    for (const s of ["SECRETQUERY", "SECRETAUTH", "SECRETBODY", "/v1/x"]) {
      assert(!text.includes(s), `${s} logged: ${text}`);
    }
    assertEquals(lines.length, 3);
  } finally {
    await p.shutdown();
  }
});

Deno.test("claude-code run.ps1 (A3) waits for ready, bounded, before reading the token", async () => {
  const run = await Deno.readTextFile("harness/images/claude-code/run.ps1");
  const wait = run.indexOf("Test-Path 'C:\\cg-secrets\\ready'");
  assert(wait > 0, "waits for C:\\cg-secrets\\ready");
  assert(
    wait < run.indexOf("C:\\cg-secrets\\claude-oauth-token"),
    "no token before ready",
  );
  assert(
    run.indexOf("settings.mcp must be") < wait,
    "settings validated first",
  );
  assertStringIncludes(run, "CG_READY_TIMEOUT_S");
  assertStringIncludes(run, "exit 3");
});

Deno.test("egress scripts (PS 5.1): JSON arrays are read by assignment, and a rollback problem never hides the failure", () => {
  const o = {
    invocation: "inv1",
    dir: "C:\\fw",
    interfaceAlias: "vEthernet (x)",
    hnsId: "hns1",
  };
  const both = applyScript(firewallPlan(IDX), o) + revertScript("C:\\fw");
  // Windows PowerShell 5.1 emits a JSON array from ConvertFrom-Json as one object.
  assert(
    !/@\([^)]*\| ConvertFrom-Json\)/.test(both),
    "no @(... | ConvertFrom-Json)",
  );
  const apply = applyScript(firewallPlan(IDX), o);
  const rollback = apply.slice(apply.indexOf("} catch {"));
  assertStringIncludes(rollback, "rollback incomplete");
  assert(!rollback.includes("-ErrorAction Continue"));
});

Deno.test("isPrivateAddress: IPv4 embedded in IPv6 (mapped, compatible, NAT64, 6to4) is judged by the IPv4", () => {
  for (
    const ip of [
      "10.0.0.5",
      "127.0.0.1",
      "169.254.1.1",
      "::1",
      "::",
      "fe80::1",
      "fd00::1",
      "::ffff:10.0.0.1",
      "::ffff:a00:1",
      "::10.0.0.1",
      "::7f00:1",
      "64:ff9b::10.0.0.1",
      "64:ff9b::a9fe:101",
      "2002:c0a8:101::1",
      "2002:0a00:0001:1::5",
      "not-an-ip",
      "1:2:3",
    ]
  ) {
    assert(isPrivateAddress(ip), ip);
  }
  for (
    const ip of [
      "93.184.216.34",
      "2606:4700::6810:84e5",
      "::ffff:93.184.216.34",
      "64:ff9b::5db8:d822",
      "2002:5db8:d822::1",
    ]
  ) {
    assert(!isPrivateAddress(ip), ip);
  }
});

Deno.test("proxy: concurrent connections are capped and idle tunnels are closed", async () => {
  const lines: { decision: string; reason: string }[] = [];
  const upstream = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const held: Deno.Conn[] = [];
  (async () => {
    for await (const c of upstream) held.push(c); // accepts and stays silent
  })();
  const p = startEgressProxy({
    hostname: "127.0.0.1",
    port: 0,
    allow: ["allowed.test"],
    log: (l) => lines.push(l),
    resolve: () => Promise.resolve(["93.184.216.34"]),
    allowedHosts: ["127.0.0.1"],
    dial: () =>
      Deno.connect({
        hostname: "127.0.0.1",
        port: (upstream.addr as Deno.NetAddr).port,
      }),
    maxConnections: 1,
    idleTimeoutMs: 150,
  });
  try {
    const a = await Deno.connect({ hostname: "127.0.0.1", port: p.port });
    await a.write(
      new TextEncoder().encode(
        "CONNECT allowed.test:443 HTTP/1.1\r\nHost: allowed.test:443\r\n\r\n",
      ),
    );
    const buf = new Uint8Array(64);
    const n = (await a.read(buf)) ?? 0;
    assertStringIncludes(new TextDecoder().decode(buf.subarray(0, n)), "200");
    // The cap: a second client while the tunnel is open is refused, not a violation.
    const b = await Deno.connect({ hostname: "127.0.0.1", port: p.port });
    const m = (await b.read(buf)) ?? 0;
    assertStringIncludes(new TextDecoder().decode(buf.subarray(0, m)), "503");
    b.close();
    // Idle: nothing flows, so the proxy closes the tunnel.
    const t0 = performance.now();
    assertEquals(await a.read(buf), null);
    assert(performance.now() - t0 < 5_000);
    a.close();
    assertEquals(lines.map((l) => [l.decision, l.reason]), [
      ["allow", "allowed"],
      ["error", "too many connections"],
      ["error", "idle timeout"],
    ]);
  } finally {
    await p.shutdown();
    upstream.close();
    for (const c of held) {
      try {
        c.close();
      } catch { /* closed */ }
    }
  }
});

Deno.test("proxy: a log sink that throws never turns a deny into an allow", async () => {
  const p = startEgressProxy({
    hostname: "127.0.0.1",
    port: 0,
    allow: [],
    log: () => {
      throw new Error("disk full");
    },
    allowedHosts: ["127.0.0.1"],
  });
  try {
    const c = await Deno.connect({ hostname: "127.0.0.1", port: p.port });
    await c.write(
      new TextEncoder().encode("CONNECT x.test:443 HTTP/1.1\r\n\r\n"),
    );
    const buf = new Uint8Array(64);
    const n = (await c.read(buf)) ?? 0;
    c.close();
    assertStringIncludes(new TextDecoder().decode(buf.subarray(0, n)), "403");
  } finally {
    await p.shutdown();
  }
});

Deno.test("applyScript (review item 4): the gateway's adapter must be the vEthernet of the inspected HNS network, checked before any change", () => {
  const o = {
    invocation: "inv1",
    dir: "C:\\fw",
    interfaceAlias: "vEthernet (a1b2c3)",
    hnsId: "hns1",
  };
  const s = applyScript(firewallPlan(IDX), o);
  const at = (x: string) => s.indexOf(x);
  assert(at("Get-HnsNetwork") > 0);
  assertStringIncludes(s, "'hns1'");
  assert(at("Get-HnsNetwork") < at("Set-NetFirewallProfile"));
  assert(at("Get-HnsNetwork") < at("New-NetFirewallRule"));
  assertStringIncludes(s, "not the vEthernet of HNS network");
  assertThrows(
    () => applyScript(firewallPlan(IDX), { ...o, hnsId: "" }),
    ConfigurationError,
  );
  assertThrows(
    () => applyScript(firewallPlan(IDX), { ...o, hnsId: "a'b" }),
    ConfigurationError,
  );
});

Deno.test("apply/revert (review item 5): the apply record with the profile snapshot exists before any profile change; revert restores from it even with no rule; an incomplete rollback keeps it", () => {
  const o = {
    invocation: "inv1",
    dir: "C:\\fw",
    interfaceAlias: "vEthernet (a1b2c3)",
    hnsId: "hns1",
  };
  const s = applyScript(firewallPlan(IDX), o);
  const at = (x: string) => s.indexOf(x);
  assert(at("Save-JsonAtomic $applied $record") > 0);
  assert(
    at("Save-JsonAtomic $applied $record") < at("Set-NetFirewallProfile"),
    "the record (with the snapshot) is written before the first profile change",
  );
  assertStringIncludes(s, "snapshot = $snapshot");
  const rollback = s.slice(at("} catch {"));
  assert(
    rollback.indexOf("if ($rollback.Count -eq 0)") <
      rollback.indexOf("Move-Item"),
    "files are archived only after a complete rollback",
  );
  const r = revertScript("C:\\fw");
  assertStringIncludes(r, "$record.snapshot");
  assertStringIncludes(r, "fw-snapshot-$inv.json");
});

// Review item 2: the OAuth host record mode (M1-34 Step 11).

Deno.test("record mode: the route policy, the preflight expectation and the record file", async () => {
  const oauth = "anthropic:first-party-oauth";
  assertThrows(() => hostsForRoutes([oauth], {}), ConfigurationError);
  assertEquals(hostsForRoutes([oauth], {}, { record: true }), [
    "api.anthropic.com",
  ]);
  assertThrows(
    () => hostsForRoutes(["openai:api-key"], {}, { record: true }),
    ConfigurationError,
  );
  const rec = preflightExpect(["api.anthropic.com"], { record: true });
  assertEquals(rec["proxy-deny-example.com"], true, "record mode allows it");
  assertEquals(rec["proxy-ip-literal"], false);
  assertEquals(
    { ...rec, "proxy-deny-example.com": false },
    preflightExpect(["api.anthropic.com"]),
  );
  const a = recordedHostsJson(
    ["statsig.example.test", "api.anthropic.com", "statsig.example.test"],
    "record mode execution x",
  );
  assertEquals(
    a,
    recordedHostsJson(
      ["api.anthropic.com", "statsig.example.test"],
      "record mode execution x",
    ),
  );
  const root = await Deno.realPath(await Deno.makeTempDir());
  const path = join(root, ...RECORDED_HOSTS_PATH.split("/"));
  await Deno.mkdir(join(path, ".."), { recursive: true });
  await Deno.writeTextFile(path, a);
  assertEquals(await loadRecordedHosts(root), {
    [oauth]: ["api.anthropic.com", "statsig.example.test"],
  });
  assertThrows(() => recordedHostsJson([], "s"), ConfigurationError);
  assertThrows(() => recordedHostsJson(["1.2.3.4"], "s"), ConfigurationError);
});

Deno.test("proxy record mode: any DNS name on 443 is allowed and logged; IP literals, private resolutions and other ports are still refused", async () => {
  const lines: { decision: string; target: string; reason: string }[] = [];
  const upstream = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const held: Deno.Conn[] = [];
  (async () => {
    for await (const c of upstream) held.push(c);
  })();
  const p = startEgressProxy({
    hostname: "127.0.0.1",
    port: 0,
    allow: ["api.anthropic.com"],
    recordMode: true,
    log: (l) => lines.push(l),
    resolve: (h) =>
      Promise.resolve(h === "internal.test" ? ["10.0.0.5"] : ["93.184.216.34"]),
    allowedHosts: ["127.0.0.1"],
    dial: () =>
      Deno.connect({
        hostname: "127.0.0.1",
        port: (upstream.addr as Deno.NetAddr).port,
      }),
  });
  try {
    const status = async (target: string) => {
      const c = await Deno.connect({ hostname: "127.0.0.1", port: p.port });
      await c.write(
        new TextEncoder().encode(`CONNECT ${target} HTTP/1.1\r\n\r\n`),
      );
      const buf = new Uint8Array(64);
      const n = (await c.read(buf)) ?? 0;
      c.close();
      return new TextDecoder().decode(buf.subarray(0, n)).split(" ")[1];
    };
    assertEquals(await status("statsig.example.test:443"), "200");
    assertEquals(await status("1.1.1.1:443"), "403");
    assertEquals(await status("internal.test:443"), "403");
    assertEquals(await status("statsig.example.test:80"), "403");
    assertEquals(lines.map((l) => [l.decision, l.target]), [
      ["allow", "statsig.example.test:443"],
      ["deny", "1.1.1.1:443"],
      ["deny", "internal.test:443"],
      ["deny", "statsig.example.test:80"],
    ]);
  } finally {
    await p.shutdown();
    upstream.close();
    for (const c of held) {
      try {
        c.close();
      } catch { /* closed */ }
    }
  }
});

Deno.test("fix B: the apply script derives the HNS id from the Docker sandbox network and refuses a differing caller id before any change", () => {
  const s = applyScript(firewallPlan(IDX), {
    invocation: "inv1",
    dir: "C:\\fw",
    interfaceAlias: "vEthernet (a1b2c3)",
    hnsId: "hns1",
  });
  const at = (x: string) => s.indexOf(x);
  assert(at("& docker") > 0, "docker is called");
  assertStringIncludes(s, `network inspect ${SANDBOX_NETWORK.name}`);
  assertStringIncludes(s, "com.docker.network.windowsshim.hnsid");
  assertStringIncludes(s, "differs from");
  for (
    const later of [
      "Get-HnsNetwork",
      "Set-NetFirewallProfile",
      "New-NetFirewallRule",
      "fw-snapshot-inv1.json",
    ]
  ) {
    assert(at("& docker") < at(later), later);
  }
  // PS 5.1 passes embedded double quotes badly to native programs: no --format template.
  assert(!/& docker[^\r\n]*--format/.test(s));
});

Deno.test("fix C: every apply-record write is atomic; the snapshot is its own file before the first change; revert falls back to it", () => {
  const s = applyScript(firewallPlan(IDX), {
    invocation: "inv1",
    dir: "C:\\fw",
    interfaceAlias: "vEthernet (a1b2c3)",
    hnsId: "hns1",
  });
  const at = (x: string) => s.indexOf(x);
  assert(!/Save-Json \$applied/.test(s), "no plain write of the apply record");
  assertEquals(
    s.match(/Save-JsonAtomic \$applied \$record/g)!.length,
    257,
    "the first write plus one per rule",
  );
  assert(at("Save-JsonAtomic (Join-Path $dir 'fw-snapshot-inv1.json')") > 0);
  assert(
    at("Save-JsonAtomic (Join-Path $dir 'fw-snapshot-inv1.json')") <
      at("Set-NetFirewallProfile"),
  );
  assertStringIncludes(s, "function Save-JsonAtomic");
  assertStringIncludes(s, "[IO.File]::Replace(");
  const r = revertScript("C:\\fw");
  assertStringIncludes(r, "fw-snapshot-");
  assert(
    r.indexOf("catch") > 0 &&
      r.indexOf("$record.snapshot") < r.lastIndexOf("fw-snapshot-$inv.json"),
    "an unparseable record falls back to the snapshot file",
  );
});

Deno.test("egress scripts (PS 5.1): no $name: inside a string (parsed as a scope-qualified variable)", () => {
  const both = applyScript(firewallPlan(IDX), {
    invocation: "inv1",
    dir: "C:\\fw",
    interfaceAlias: "vEthernet (a1b2c3)",
    hnsId: "hns1",
  }) + revertScript("C:\\fw") + COLLECT_PS;
  const bad = both.match(/\$(?!env:|global:|script:)[A-Za-z_][A-Za-z0-9_]*:/g);
  assertEquals(bad, null, String(bad));
});

Deno.test("verifyEgressState: HNS reports its type in lowercase ('internal', M1-34 AD-04); the type is compared case-insensitively, another type still fails (M1-34a)", async () => {
  const observe = async (
    mut: (r: ReturnType<typeof rawObservation>) => void,
  ) => {
    const raw = rawObservation();
    mut(raw);
    return verifyEgressState(
      await collectEgressState(() =>
        Promise.resolve({ code: 0, stdout: JSON.stringify(raw) })
      ),
    );
  };
  assertEquals(
    await observe((r) => (r.hns = hnsValues({ type: "internal" }))),
    [],
  );
  assertEquals(
    await observe((r) => (r.hns = hnsValues({ type: "INTERNAL" }))),
    [],
  );
  for (const t of ["nat", "transparent", "l2bridge", ""]) {
    assertEquals(
      await observe((r) => (r.hns = hnsValues({ type: t }))),
      [
        `hns network behind ${SANDBOX_NETWORK.name} is not the internal network of the plan`,
      ],
      t,
    );
  }
});

Deno.test("verifyEgressState: the HNS id and docker's hnsid are GUIDs, equal regardless of case; a different id still fails (M1-34a)", () => {
  const guid = "d9198b5b-3abb-475a-874e-2b052f37ccd6";
  const s = goodState();
  s.network!.hnsId = guid;
  s.hns!.id = guid.toUpperCase();
  s.gatewayAdapter!.alias = `vEthernet (${s.hns!.name})`;
  assertEquals(verifyEgressState(s), []);
  s.hns!.id = "00000000-0000-4000-8000-000000000000";
  assertEquals(verifyEgressState(s), [
    `hns network behind ${SANDBOX_NETWORK.name} is not the internal network of the plan`,
  ]);
});

// M1-33d G2/G3: the authenticated preflight, the credential forms, the sandbox source address.

/** Passing authenticated lines: CONNECT probes carry their status (200 allow, 403 deny, 407 no credential). */
function authLines(
  e: Record<string, boolean>,
): { probe: string; ok: boolean; status?: number }[] {
  return Object.entries(e).map(([probe, ok]) =>
    probe.startsWith("proxy-")
      ? {
        probe,
        ok,
        status: probe === "proxy-no-auth" ? 407 : ok ? 200 : 403,
      }
      : { probe, ok }
  );
}

Deno.test("evaluatePreflight (auth): 200 with the credential, 403 for a deny, 407 only without it", () => {
  const e = preflightExpect(["api.anthropic.com"], { auth: true });
  assertEquals(e["proxy-no-auth"], false);
  assert(!("proxy-no-auth" in preflightExpect(["api.anthropic.com"])));
  const good = authLines(e);
  assertEquals(evaluatePreflight(good, e), []);
  const set = (probe: string, v: { ok: boolean; status?: number }) =>
    good.map((l) => {
      if (l.probe !== probe) return l;
      const { status: _s, ...rest } = l;
      return { ...rest, ...v };
    });
  // A 407 on an authenticated probe is never a blocked negative.
  for (const p of ["proxy-deny-example.com", "proxy-ip-literal"]) {
    assertStringIncludes(
      evaluatePreflight(set(p, { ok: false, status: 407 }), e).join("\n"),
      `${p}: 407`,
    );
  }
  assertStringIncludes(
    evaluatePreflight(
      set("proxy-allow-api.anthropic.com", { ok: false, status: 407 }),
      e,
    ).join("\n"),
    "407",
  );
  // The no-credential probe must be refused with 407: 403 or 200 fails.
  for (const [ok, status] of [[false, 403], [true, 200]] as const) {
    assertStringIncludes(
      evaluatePreflight(set("proxy-no-auth", { ok, status }), e).join("\n"),
      "proxy-no-auth",
    );
  }
  // Blocked means the policy deny: a 502 or a missing status is not proof.
  assertStringIncludes(
    evaluatePreflight(
      set("proxy-deny-example.com", { ok: false, status: 502 }),
      e,
    ).join("\n"),
    "expected 403",
  );
  assertStringIncludes(
    evaluatePreflight(set("proxy-ip-literal", { ok: false }), e).join("\n"),
    "no status",
  );
  assertStringIncludes(
    evaluatePreflight(
      good.filter((l) => l.probe !== "proxy-no-auth"),
      e,
    ).join("\n"),
    "proxy-no-auth: missing",
  );
  // Record mode: example.com is open with the credential, IP literals still denied.
  const rec = preflightExpect(["api.anthropic.com"], {
    record: true,
    auth: true,
  });
  assertEquals(evaluatePreflight(authLines(rec), rec), []);
  // Without auth the lines need no status (the credentialless qualification probe).
  assertEquals(
    evaluatePreflight(
      Object.entries(PREFLIGHT_EXPECT).map(([probe, ok]) => ({ probe, ok })),
    ),
    [],
  );
});

Deno.test("parseProbeLines: a CONNECT probe's status is kept", () => {
  assertEquals(
    parseProbeLines(
      '{"probe":"proxy-no-auth","ok":false,"status":407,"error":null}',
    ),
    [{ probe: "proxy-no-auth", ok: false, status: 407 }],
  );
  assertEquals(
    parseProbeLines(
      '{"probe":"gw-icmp","ok":false,"status":null,"error":null}',
    ),
    [{ probe: "gw-icmp", ok: false }],
  );
  assertThrows(
    () =>
      parseProbeLines('{"probe":"proxy-no-auth","ok":false,"status":"407"}'),
    ValidationError,
  );
});

Deno.test("proxyCredentialForms: every form of the credential is a redaction value; the file value first", () => {
  const user = "0123456789abcdef0123456789abcdef";
  const pass = "Ab-_cdEFghIJklMNopQRstUVwxYZ0123456789abcde";
  const forms = proxyCredentialForms({ user, pass });
  assertEquals(forms[0], {
    name: "proxy-credential",
    value: `${user}:${pass}`,
  });
  const values = forms.map((f) => f.value);
  const url = `http://${user}:${pass}@${SANDBOX_NETWORK.gateway}:${PROXY_PORT}`;
  for (
    const v of [
      pass,
      `${user}:${pass}`,
      btoa(`${user}:${pass}`),
      `${encodeURIComponent(user)}%3A${encodeURIComponent(pass)}`,
      url,
      encodeURIComponent(url),
    ]
  ) assert(values.includes(v), v);
  assertEquals(new Set(forms.map((f) => f.name)).size, forms.length);
});

Deno.test("sandboxSource: exactly one IPv4 on the internal network, inside its subnet, never the gateway", () => {
  const net = SANDBOX_NETWORK.name;
  assertEquals(
    sandboxSource([{ network: net, ip: "172.30.60.17" }]),
    "172.30.60.17",
  );
  const bad: [string, { network: string; ip: string }[] | null][] = [
    ["no such container", null],
    ["no address", []],
    ["no address", [{ network: net, ip: "" }]],
    ["2 network", [{ network: net, ip: "172.30.60.17" }, {
      network: "nat",
      ip: "172.20.0.5",
    }]],
    ["not on", [{ network: "nat", ip: "172.30.60.17" }]],
    ["outside", [{ network: net, ip: "172.30.61.17" }]],
    ["outside", [{ network: net, ip: "fe80::1" }]],
    ["gateway", [{ network: net, ip: SANDBOX_NETWORK.gateway }]],
    ["outside", [{ network: net, ip: "172.30.60.255" }]],
    ["outside", [{ network: net, ip: "172.30.60.0" }]],
    ["outside", [{ network: net, ip: "172.30.60.256" }]],
  ];
  for (const [word, b] of bad) {
    assertThrows(() => sandboxSource(b), ValidationError, word, word);
  }
});

Deno.test("egress-check.ps1: reads the proxy credential file itself, sends it as Basic auth, reports each CONNECT status, adds the no-credential probe", async () => {
  const ps = await Deno.readTextFile("harness/images/base/egress-check.ps1");
  // Never a parameter: the credential is not in the docker exec argv.
  const param = ps.slice(
    ps.indexOf("param("),
    ps.indexOf(")", ps.indexOf("param(")),
  );
  assert(!/cred|auth|user|pass/i.test(param), param);
  assertStringIncludes(ps, "'C:\\cg-secrets\\proxy-credential'");
  assertStringIncludes(ps, "Proxy-Authorization: ");
  assertStringIncludes(ps, "'Basic ' + [Convert]::ToBase64String(");
  assertStringIncludes(ps, "status = $null");
  assertStringIncludes(ps, "$line.status = $r");
  assertStringIncludes(ps, "'proxy-no-auth'");
  assertStringIncludes(ps, "Test-Connect 'example.com:443' $false");
  // The credential never reaches an output line or an error message.
  assert(!/WriteLine\([^)]*\$(cred|proxyAuth)/i.test(ps));
  assert(!/throw[^\n]*\$(cred|proxyAuth)/i.test(ps));
  // No credential file (the credentialless qualification probe): no Basic
  // header and no no-credential probe.
  assertStringIncludes(
    ps,
    "if ($null -ne $proxyAuth) { $probes['proxy-no-auth']",
  );
});

Deno.test("realEgressRuntime (M1-33d): one shared proxy on the gateway, started with the runtime; register goes to it; no per-execution proxy; its failure and shutdown are the runtime's", async () => {
  const root = await Deno.makeTempDir();
  const started: SharedProxyOptions[] = [];
  const regs: RegisterOptions[] = [];
  let failed = false;
  let down = 0;
  const shared = (o: SharedProxyOptions): SharedEgressProxy => {
    started.push(o);
    return {
      port: o.port,
      get failed() {
        return failed;
      },
      register(r) {
        regs.push(r);
        return {
          credential: { user: "u".repeat(32), pass: "p".repeat(43) },
          reg: {
            source: r.source,
            failed: false,
            failure: null,
            unregister: () => Promise.resolve(),
          },
        };
      },
      shutdown() {
        down++;
        return Promise.resolve();
      },
    };
  };
  const markerPath = join(root, "egress-verified.json");
  const rt = await realEgressRuntime({ repoRoot: root, markerPath, shared });
  assertEquals(started.length, 1, "started with the runtime, once");
  assertEquals(
    [started[0]!.hostname, started[0]!.port, started[0]!.allowedHosts],
    [SANDBOX_NETWORK.gateway, PROXY_PORT, [SANDBOX_NETWORK.gateway]],
  );
  const r = rt.register({
    allow: ["api.anthropic.com"],
    log() {},
    source: "172.30.60.5",
  });
  assertEquals(r.reg.source, "172.30.60.5");
  assertEquals(regs.map((x) => x.allow), [["api.anthropic.com"]]);
  assertEquals(started.length, 1, "a registration starts no proxy");
  assertEquals(rt.proxyFailed, false);
  failed = true;
  assertEquals(rt.proxyFailed, true);
  // The per-execution proxy would bind the same address: refused.
  await assertRejects(
    () => rt.startProxy({ allowedHosts: [], log() {} }),
    ConfigurationError,
    "shared",
  );
  // Pre-auth reasons go to the host log (reason and source, never a header).
  await started[0]!.hostLog({
    at: "2026-09-26T00:00:00.000Z",
    reason: "missing credential",
    source: "172.30.60.5",
  });
  assertStringIncludes(
    await Deno.readTextFile(join(root, "egress-host.jsonl")),
    '"reason":"missing credential"',
  );
  await rt.shutdown();
  assertEquals(down, 1);
  // The credentialless qualification probe keeps its own per-execution proxy.
  const probe = await realEgressRuntime({
    repoRoot: root,
    markerPath,
    acceptCandidate: true,
    shared,
  });
  assertEquals(started.length, 1, "no shared proxy for the probe");
  assertThrows(
    () => probe.register({ allow: [], log() {}, source: "172.30.60.5" }),
    ConfigurationError,
    "qualification",
  );
  assertEquals(probe.proxyFailed, false);
  await probe.shutdown();
});

/** A shared proxy that binds nothing (M1-33d review tests). */
const inertShared = (o: SharedProxyOptions): SharedEgressProxy => ({
  port: o.port,
  failed: false,
  register: () => {
    throw new Error("not used");
  },
  shutdown: () => Promise.resolve(),
});

Deno.test("realEgressRuntime verify (M1-33d review): above concurrency 1 the marker's proxy_isolation must equal PROXY_ISOLATION; the value read is recorded; concurrency 1 ignores it", async () => {
  const root = await Deno.makeTempDir();
  const markerPath = join(root, "egress-verified.json");
  const runtime = async (concurrency: number, value: unknown) => {
    const raw = rawObservation();
    if (value !== undefined) {
      (raw.marker as Record<string, unknown>)["proxy_isolation"] = value;
    }
    const collect = () =>
      Promise.resolve({ code: 0, stdout: JSON.stringify(raw) });
    return await realEgressRuntime({
      repoRoot: root,
      markerPath,
      collect,
      shared: inertShared,
      concurrency,
    });
  };
  assertEquals(PROXY_ISOLATION, 2);
  const cases: [string, unknown][] = [
    ["missing", undefined],
    ["lower", 1],
    ["higher", 3],
    ["non-integer", 2.5],
    ["a string", "2"],
  ];
  for (const [word, value] of cases) {
    const rt = await runtime(2, value);
    assertEquals(
      rt.markerProxyIsolation,
      undefined,
      `${word}: nothing read yet`,
    );
    const p = await rt.verify();
    assertEquals(p.length, 1, word);
    assertStringIncludes(p[0]!, "proxy_isolation", word);
    assertStringIncludes(p[0]!, "concurrency 2", word);
    assertEquals(rt.markerProxyIsolation, value, word);
    // Concurrency 1 is unaffected by the field.
    const one = await runtime(1, value);
    assertEquals(await one.verify(), [], `${word}: concurrency 1`);
    assertEquals(one.markerProxyIsolation, value, `${word}: recorded at 1`);
  }
  const equal = await runtime(2, PROXY_ISOLATION);
  assertEquals(await equal.verify(), []);
  assertEquals(equal.markerProxyIsolation, PROXY_ISOLATION);
});

Deno.test("realEgressRuntime (M1-33d review): a shared proxy that cannot bind fails the runtime start, naming the gateway and port", async () => {
  const root = await Deno.makeTempDir();
  let listened = 0;
  await assertRejects(
    () =>
      realEgressRuntime({
        repoRoot: root,
        markerPath: join(root, "egress-verified.json"),
        shared: (o) =>
          startSharedEgressProxy({
            ...o,
            listen: () => {
              listened++;
              throw new Deno.errors.AddrInUse("Address already in use");
            },
          }),
      }),
    ConfigurationError,
    `${SANDBOX_NETWORK.gateway}:${PROXY_PORT}`,
  );
  assertEquals(listened, 1);
});

Deno.test("realEgressRuntime (M1-33d review): shutdown closes the shared proxy's listener", async () => {
  const root = await Deno.makeTempDir();
  const events: string[] = [];
  let stop = (_e: Error) => {};
  const rt = await realEgressRuntime({
    repoRoot: root,
    markerPath: join(root, "egress-verified.json"),
    shared: (o) =>
      startSharedEgressProxy({
        ...o,
        listen: (a) =>
          ({
            addr: { transport: "tcp", hostname: a.hostname, port: a.port },
            accept: () => new Promise<Deno.Conn>((_, rej) => stop = rej),
            close: () => {
              events.push("listener closed");
              stop(new Deno.errors.BadResource("closed"));
            },
          }) as unknown as Deno.Listener,
      }),
  });
  assertEquals(events, []);
  await rt.shutdown();
  assertEquals(events, ["listener closed"]);
  assertEquals(rt.proxyFailed, false, "a shutdown is not a failure");
});

// ---------------------------------------------------------------------------
// M1-34c: the non-elevated collector's contract (filters read per group rule,
// HNS from its VolatileStore value), review M1-34b-001 items 2 and 4.

type Raw = ReturnType<typeof rawObservation>;
const collectRaw = (raw: unknown) =>
  collectEgressState(() =>
    Promise.resolve({ code: 0, stdout: JSON.stringify(raw) })
  );
const verifyRaw = async (mut: (r: Raw) => void) => {
  const raw = rawObservation();
  mut(raw);
  return verifyEgressState(await collectRaw(raw));
};
const rejectsRaw = (mut: (r: Raw) => void, msg: string) => {
  const raw = rawObservation();
  mut(raw);
  return assertRejects(() => collectRaw(raw), ValidationError, msg);
};
const KINDS = [
  "port",
  "address",
  "application",
  "service",
  "interface",
  "interfaceType",
] as const;
// deno-lint-ignore no-explicit-any
const list = (r: Raw, k: (typeof KINDS)[number]) => r.filters[k] as any[];

Deno.test("collectEgressState (M1-34c): every group rule has each filter exactly once; a missing, duplicate or unowned filter refuses", async () => {
  for (const k of KINDS) {
    await rejectsRaw((r) => list(r, k).splice(7, 1), `no ${k} filter`);
    await rejectsRaw(
      (r) => list(r, k).push({ ...list(r, k)[3] }),
      `more than one ${k} filter`,
    );
    await rejectsRaw(
      (r) => list(r, k).push({ ...list(r, k)[0], InstanceID: "{other}" }),
      "belongs to no",
    );
    // A missing section is an incomplete observation, never an empty one.
    await rejectsRaw(
      // deno-lint-ignore no-explicit-any
      (r) => delete (r.filters as any)[k],
      `filters.${k}`,
    );
  }
  await rejectsRaw((r) => r.groupRules.push({ ...r.groupRules[5]! }), "twice");
});

Deno.test("collectEgressState (M1-34c): an empty group is never a pass; filters without a rule refuse", async () => {
  const p = await verifyRaw((r) => {
    r.groupRules = [];
    for (const k of KINDS) list(r, k).length = 0;
  });
  assertEquals(p.filter((x) => x.startsWith("missing rule")).length, 256);
  await rejectsRaw((r) => (r.groupRules = []), "belongs to no");
});

Deno.test("collectEgressState (M1-34c): a denied, errored or partial read refuses", async () => {
  for (
    const msg of [
      "host read failed: cannot read the group rules: Access is denied.",
      "host read failed: Get-NetFirewallPortFilter : Access is denied.",
      "host read failed: Requested registry access is not allowed.",
      "host read failed: Cannot find path 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\hns\\State\\HostComputeNetwork\\VolatileStore\\Network' because it does not exist.",
    ]
  ) {
    await assertRejects(
      () => collectEgressState(() => Promise.resolve({ code: 1, stdout: msg })),
      ValidationError,
      "egress observation failed",
    );
  }
  const full = JSON.stringify(rawObservation());
  const cut = full.slice(0, full.indexOf('"interfaceType"') + 40);
  await assertRejects(
    () => collectEgressState(() => Promise.resolve({ code: 0, stdout: cut })),
    ValidationError,
    "egress",
  );
  // A filter list shorter than the group (a read that stopped early) is a missing filter.
  await rejectsRaw((r) => r.filters.port.splice(100), "no port filter");
});

Deno.test("collectEgressState (M1-34c): changed group rules and a foreign block rule are problems", async () => {
  const cases: [string, (r: Raw) => void][] = [
    ["ports", (r) => (r.filters.port[0]!.LocalPort = ["1-65535"])],
    ["protocol", (r) => (r.filters.port[1]!.Protocol = "UDP")],
    [
      "remote address",
      (r) => (r.filters.address[2]!.RemoteAddress = "10.0.0.0/8"),
    ],
    [
      "local address",
      (r) => (r.filters.address[2]!.LocalAddress = "172.30.60.1"),
    ],
    ["program", (r) => (r.filters.application[3]!.Program = "C:\\x.exe")],
    ["service", (r) => (r.filters.service[4]!.Service = "dnscache")],
    ["interface", (r) => (r.filters.interface[5]!.InterfaceIndex = [7])],
    ["interface", (r) => (r.filters.interface[5]!.InterfaceIndex = [null])],
    [
      "interface",
      (r) => (r.filters.interface[5]!.InterfaceIndex = [IDX, 7]),
    ],
    [
      "interface type",
      (r) => (r.filters.interfaceType[6]!.InterfaceType = "Wireless"),
    ],
    ["disabled", (r) => (r.groupRules[7]!.Enabled = "False")],
    ["action", (r) => (r.groupRules[8]!.Action = "Allow")],
    ["missing rule", (r) => {
      const id = r.groupRules.pop()!.InstanceID;
      for (const k of KINDS) {
        const kept = list(r, k).filter((f) => f.InstanceID !== id);
        list(r, k).splice(0, Infinity, ...kept);
      }
    }],
    ["extra rule", (r) => {
      r.groupRules.push({ ...r.groupRules[0]!, InstanceID: "{x}", Name: "x" });
      for (const k of KINDS) {
        list(r, k).push({ ...list(r, k)[0], InstanceID: "{x}" });
      }
    }],
    [
      "foreign block rule is effective",
      (r) => (r.foreignBlockRules = ["Block all [x, Inbound, GroupPolicy]"]),
    ],
  ];
  for (const [word, mut] of cases) {
    const p = await verifyRaw(mut);
    assert(
      p.length > 0 && p.join("\n").toLowerCase().includes(word),
      `${word}: ${p.join("; ")}`,
    );
  }
});

Deno.test("decodeHnsBlob / parseHnsNetwork (M1-34c): the real VolatileStore value decodes exactly", () => {
  const root = decodeHnsBlob(REAL_HNS.blob);
  assertEquals(root.get("Name"), REAL_HNS.name);
  assertEquals(parseHnsNetwork(REAL_HNS.id, REAL_HNS.blob), {
    id: REAL_HNS.id,
    name: REAL_HNS.name,
    type: "internal",
    subnet: "172.30.60.0/24",
  });
  // The value name is docker's hnsid (any case); the blob's own ID must agree.
  assertEquals(
    parseHnsNetwork(REAL_HNS.id.toLowerCase(), REAL_HNS.blob).id,
    REAL_HNS.id.toLowerCase(),
  );
  assertThrows(() => parseHnsNetwork(HNS_ID, REAL_HNS.blob), Error, "ID");
});

Deno.test("parseHnsNetwork (M1-34c): format drift refuses, never a partial network", () => {
  const n = (o: Partial<Parameters<typeof networkBlob>[0]>) =>
    networkBlob({ id: HNS_ID, name: "a", ...o });
  const good = n({});
  assertEquals(parseHnsNetwork(HNS_ID, good).name, "a");
  const drift: [string, Uint8Array][] = [
    ["truncated", good.subarray(0, good.length - 3)],
    ["trailing", new Uint8Array([...good, 0, 0])],
    ["object start", good.subarray(2)],
    ["value type", n({ extra: [["New", hns.raw(9, new Uint8Array(4))]] })],
    ["flags", hns.obj([["ID", hns.guid(HNS_ID)]], 0x40).b],
    ["duplicate", n({ extra: [["Name", hns.str("b")]] })],
    ["bool", n({ extra: [["X", hns.raw(1, new Uint8Array([2, 0, 0, 0]))]] })],
    ["Name", n({ drop: ["Name"] })],
    ["Type", n({ drop: ["Type"] })],
    ["ID", n({ drop: ["ID"] })],
    ["Subnets", n({ drop: ["Subnets"] })],
    ["Subnets", n({ subnets: [] })],
    ["Subnets", n({ subnets: ["172.30.60.0/24", "10.0.0.0/8"] })],
    ["Name", n({ drop: ["Name"], extra: [["Name", hns.u32(1)]] })],
    ["ID", n({ drop: ["ID"], extra: [["ID", hns.str(HNS_ID)]] })],
    [
      "object start",
      n({ extra: [["Dns", hns.raw(8, new Uint8Array([1, 0, 0, 0, 5, 0]))]] }),
    ],
    [
      "string",
      n({
        extra: [[
          "S",
          hns.raw(5, new Uint8Array([2, 0, 0, 0, 65, 0, 66, 0])),
        ]],
      }),
    ],
  ];
  for (const [word, b] of drift) {
    assertThrows(() => parseHnsNetwork(HNS_ID, b), Error, word, word);
  }
});

Deno.test("collectEgressState (M1-34c): the HNS value must be one Binary value that parses; missing is a problem, never a pass", async () => {
  await rejectsRaw(
    (r) => r.hns.push({ ...r.hns[0]!, Name: HNS_ID.toLowerCase() }),
    "values",
  );
  await rejectsRaw((r) => (r.hns[0]!.Kind = "String"), "Binary");
  await rejectsRaw((r) => (r.hns[0]!.Blob = "not base64!"), "hns");
  await rejectsRaw((r) => (r.hns[0]!.Blob = ""), "hns");
  await rejectsRaw(
    (r) => (r.hns[0]!.Blob = blobB64(n40())),
    "hns",
  );
  // A value under another name than docker's hnsid is not this network.
  await rejectsRaw((r) => (r.hns[0]!.Name = REAL_HNS.id), "hns");
  const missing = await verifyRaw((r) => (r.hns = []));
  assert(
    missing.includes(
      `hns network behind ${SANDBOX_NETWORK.name} is not the internal network of the plan`,
    ),
    missing.join("; "),
  );
});
const n40 = () => networkBlob({ id: HNS_ID, name: "a1b2c3" }).subarray(0, 40);

Deno.test("verifyEgressState (M1-34c): HNS id, name, type and subnet must match docker, the plan and the gateway adapter", async () => {
  const HNS_PROBLEM =
    `hns network behind ${SANDBOX_NETWORK.name} is not the internal network of the plan`;
  const has = async (mut: (r: Raw) => void) =>
    (await verifyRaw(mut)).includes(HNS_PROBLEM);
  assertEquals(await verifyRaw(() => {}), []);
  // id: docker's hnsid differs from the value (and blob) read: refused as an
  // observation; with no value under docker's hnsid, a problem.
  await rejectsRaw((r) => (r.network.HnsId = REAL_HNS.id), "docker's hnsid");
  assert(
    await has((r) => {
      r.network.HnsId = REAL_HNS.id;
      r.hns = [];
    }),
  );
  // name: docker's windowsshim.networkname differs from the HNS name.
  assert(await has((r) => (r.network.NetworkName = "other")));
  assert(await has((r) => (r.network.NetworkName = "")));
  // type and subnet come from the blob.
  assert(await has((r) => (r.hns = hnsValues({ type: "nat" }))));
  assert(
    await has((r) => (r.hns = hnsValues({ subnets: ["172.30.61.0/24"] }))),
  );
  // The gateway adapter: its alias must be the vEthernet of that HNS network,
  // its index the rules' and the marker's.
  const alias = await verifyRaw((
    r,
  ) => (r.gatewayAdapter.Alias = "vEthernet (other)"));
  assert(
    alias.some((x) => x.includes("is not the vEthernet of HNS network")),
    alias.join("; "),
  );
  const renamed = await verifyRaw((r) => (r.hns = hnsValues({ name: "zzz" })));
  assert(
    renamed.includes(HNS_PROBLEM) &&
      renamed.some((x) => x.includes("vEthernet")),
    renamed.join("; "),
  );
  const index = await verifyRaw((r) => (r.gatewayAdapter.Index = IDX + 1));
  assert(
    index.some((x) => x.includes("recreated")) &&
      index.some((x) => x.includes("interface is")),
    index.join("; "),
  );
});

Deno.test("COLLECT_PS (M1-34c): non-elevated reads only; filters by association from the group's rules; HNS from its VolatileStore value", () => {
  assert(!/\s-All\b/.test(COLLECT_PS), "no class-wide -All enumeration");
  assert(!COLLECT_PS.includes("Get-HnsNetwork"), "no HNS service query");
  for (
    const c of [
      "Get-NetFirewallPortFilter",
      "Get-NetFirewallAddressFilter",
      "Get-NetFirewallApplicationFilter",
      "Get-NetFirewallServiceFilter",
      "Get-NetFirewallInterfaceFilter",
      "Get-NetFirewallInterfaceTypeFilter",
    ]
  ) {
    assertStringIncludes(COLLECT_PS, `$rules | ${c} -ErrorAction Stop`);
  }
  assertStringIncludes(
    COLLECT_PS,
    "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\hns\\State\\HostComputeNetwork\\VolatileStore\\Network",
  );
  for (const w of ["Set-", "New-", "Remove-", "Enable-", "Disable-"]) {
    assert(!COLLECT_PS.includes(w), `read-only: no ${w}`);
  }
});

Deno.test("combineObservation (M1-34c run 002): docker's network and the marker are authoritative; unexpected PowerShell keys refuse", () => {
  const network = { Id: "docker-id", HnsId: "docker-hns" };
  const marker = { state: "candidate" };
  const host = {
    hns: [],
    gatewayAdapter: null,
    profiles: [],
    groupRules: [],
    filters: {},
    foreignBlockRules: [],
  };
  const ok = JSON.parse(
    combineObservation(network, JSON.stringify(host), marker),
  );
  assertEquals(ok.network, network);
  assertEquals(ok.marker, marker);
  assertEquals(ok.groupRules, []);
  for (const key of ["network", "marker", "extra"]) {
    assertThrows(
      () =>
        combineObservation(
          network,
          JSON.stringify({ ...host, [key]: { Id: "forged" } }),
          marker,
        ),
      Error,
      `unexpected key ${key}`,
    );
  }
  for (const bad of ["[]", "null", "1", '"x"']) {
    assertThrows(
      () => combineObservation(network, bad, marker),
      Error,
      "not an object",
    );
  }
});
