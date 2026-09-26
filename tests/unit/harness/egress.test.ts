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
  type EgressState,
  evaluatePreflight,
  firewallPlan,
  hostsForRoutes,
  listenerProblems,
  loadRecordedHosts,
  parseProbeLines,
  PREFLIGHT_EXPECT,
  preflightExpect,
  RECORDED_HOSTS_PATH,
  recordedHostsJson,
  revertScript,
  ROUTE_HOSTS,
  RULE_GROUP,
  SANDBOX_NETWORK,
  verifyEgressState,
} from "../../../src/harness/egress.ts";
import {
  isPrivateAddress,
  startEgressProxy,
} from "../../../src/harness/egress-proxy.ts";

const IDX = 42;

function goodState(): EgressState {
  return {
    network: {
      id: "net1",
      driver: "internal",
      subnet: SANDBOX_NETWORK.subnet,
      gateway: SANDBOX_NETWORK.gateway,
      hnsId: "hns1",
    },
    hns: {
      id: "hns1",
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

Deno.test("collectEgressState: a complete observation is normalized; protocol names and port order do not matter", async () => {
  const rules = firewallPlan(IDX).map((r) => ({
    Name: r.name,
    Enabled: "True",
    Direction: "Inbound",
    Action: "Block",
    Profile: "Any",
    Protocol: r.protocol === 6
      ? "TCP"
      : r.protocol === 17
      ? "UDP"
      : String(r.protocol),
    LocalPort: r.localPorts === "Any" ? "Any" : [...r.localPorts].reverse(),
    RemoteAddress: "Any",
    LocalAddress: "Any",
    Program: "Any",
    Service: "Any",
    InterfaceIndex: [IDX],
  }));
  const raw = {
    network: {
      Id: "net1",
      Driver: "internal",
      Subnet: SANDBOX_NETWORK.subnet,
      Gateway: SANDBOX_NETWORK.gateway,
      HnsId: "hns1",
    },
    hns: {
      Id: "hns1",
      Name: "a1b2c3",
      Type: "Internal",
      Subnet: SANDBOX_NETWORK.subnet,
    },
    gatewayAdapter: { Index: IDX, Alias: "vEthernet (a1b2c3)", Prefix: 24 },
    profiles: ["Domain", "Private", "Public"].map((Name) => ({
      Name,
      Enabled: "True",
      DefaultInboundAction: "Allow",
      DefaultOutboundAction: "Allow",
    })),
    groupRules: rules,
    foreignBlockRules: [],
    marker: {
      v: 1,
      state: "qualified",
      network_id: "net1",
      interface_index: IDX,
    },
  };
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
