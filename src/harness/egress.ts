/**
 * Egress enforcement (M1-33; decision 2026-09-25-egress as amended, accept-M1-31,
 * round 2 item 7, round 3 B5, M1-33 amendment A1-A3). One internal Docker
 * network with no uplink; the host's firewall keeps default Allow on every
 * profile plus inbound Block rules on the sandbox vEthernet only (TCP as
 * ranges around the proxy and backend ports, every other IP protocol
 * whole); an allowlisting proxy per execution; the effective policy is
 * verified, never assumed, and every incomplete observation fails closed.
 * The harness never elevates: it generates the scripts ops run elevated
 * (M1-34) and only reads the host state.
 */

import { join } from "@std/path";
import { z } from "zod";
import { dockerContextEnv } from "../container/docker-context.ts";
import { ConfigurationError, ValidationError } from "../errors.ts";
import { startEgressProxy } from "./egress-proxy.ts";
import type { EgressLogLine } from "./egress-proxy.ts";
import { dockerChildEnv } from "./sandbox.ts";

export type { EgressLogLine } from "./egress-proxy.ts";

export const SANDBOX_NETWORK = {
  name: "cg-harness-sandbox",
  subnet: "172.30.60.0/24",
  gateway: "172.30.60.1",
} as const;
export const PROXY_PORT = 3128;
export const BACKEND_PORT = 3210;
export const RULE_GROUP = "cg-harness-egress";
export const MARKER_FILE = "egress-verified.json";
export const MARKER_STATES = ["candidate", "qualified", "authorized"] as const;
export type MarkerState = (typeof MARKER_STATES)[number];
/** The proxy env of a placed sandbox (the backend is reached directly on the gateway). */
export const PROXY_ENV: Record<string, string> = {
  HTTPS_PROXY: `http://${SANDBOX_NETWORK.gateway}:${PROXY_PORT}`,
  HTTP_PROXY: `http://${SANDBOX_NETWORK.gateway}:${PROXY_PORT}`,
  NO_PROXY: SANDBOX_NETWORK.gateway,
};

const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
/** A DNS name the proxy may allow: lowercase, dotted, never an IP literal or a wildcard. */
export const isAllowableHost = (h: string) => HOSTNAME.test(h) && !IPV4.test(h);

// ---------------------------------------------------------------------------
// A1: one route-to-host policy.

/**
 * Hosts each provider route needs. The first-party OAuth route's list is
 * incomplete until M1-34 Step 11 records the OAuth hosts Claude Code uses
 * (RECORDED_HOSTS_PATH); until then an enforced Claude run is refused.
 */
export const ROUTE_HOSTS: Record<string, string[]> = {
  "anthropic:first-party-oauth": ["api.anthropic.com"],
  "openrouter:api-key": ["openrouter.ai"],
};
/** Routes whose host list must be completed by an ops recording before any enforced run. */
export const RECORDED_ROUTES: readonly string[] = [
  "anthropic:first-party-oauth",
];
/** Written by M1-34 Step 11 (ops), committed with its evidence; never invented here. */
export const RECORDED_HOSTS_PATH = "harness/egress/recorded-hosts.json";
export type RecordedHosts = Record<string, string[]>;

/** The recording file text (sorted, unique, strict schema, non-empty): deterministic for the same hosts and source. */
export function recordedHostsJson(hosts: string[], source: string): string {
  const list = [...new Set(hosts)].sort();
  const v = {
    v: 1,
    source,
    routes: { [RECORDED_ROUTES[0]!]: list },
  };
  const r = RecordedSchema.safeParse(v);
  if (!r.success || list.length === 0) {
    throw new ConfigurationError(
      `cannot record ${JSON.stringify(list)} for ${RECORDED_HOSTS_PATH}: ${
        r.success ? "no host" : r.error.issues[0]?.message
      }`,
    );
  }
  return JSON.stringify(v, null, 2) + "\n";
}

const RecordedSchema = z.object({
  v: z.literal(1),
  source: z.string().min(1),
  routes: z.record(
    z.string().refine((r) => RECORDED_ROUTES.includes(r), {
      message: `only ${RECORDED_ROUTES.join(", ")} take a recording`,
    }),
    z.array(z.string().refine(isAllowableHost, { message: "not a hostname" }))
      .min(1),
  ),
}).strict();

/** The ops recording; a missing file is no recording (routes that need one then refuse). */
export async function loadRecordedHosts(
  repoRoot: string,
): Promise<RecordedHosts> {
  const path = join(repoRoot, ...RECORDED_HOSTS_PATH.split("/"));
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return {};
    throw new ConfigurationError(
      `cannot read ${RECORDED_HOSTS_PATH}: ${(err as Error).message}`,
    );
  }
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (err) {
    throw new ConfigurationError(
      `${RECORDED_HOSTS_PATH} is not JSON: ${(err as Error).message}`,
    );
  }
  const r = RecordedSchema.safeParse(v);
  if (!r.success) {
    throw new ConfigurationError(
      `${RECORDED_HOSTS_PATH} is invalid: ${
        r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(
          "; ",
        )
      }`,
    );
  }
  return r.data.routes;
}

/**
 * The proxy allowlist of one execution: exactly its routes' hosts, sorted;
 * unknown or unrecorded routes refuse. In record mode (M1-34 Step 11) the
 * recorded routes contribute their fixed hosts only: the proxy then allows
 * any DNS name and the run writes the recording.
 */
export function hostsForRoutes(
  routes: string[],
  recorded: RecordedHosts,
  o: { record?: boolean } = {},
): string[] {
  const out = new Set<string>();
  for (const r of routes) {
    const base = Object.hasOwn(ROUTE_HOSTS, r) ? ROUTE_HOSTS[r] : undefined;
    if (!base) {
      throw new ConfigurationError(
        `provider route ${r} has no egress host policy (ROUTE_HOSTS); refusing`,
      );
    }
    base.forEach((h) => out.add(h));
    if (RECORDED_ROUTES.includes(r) && !o.record) {
      const rec = Object.hasOwn(recorded, r) ? recorded[r] : undefined;
      if (!rec || rec.length === 0) {
        throw new ConfigurationError(
          `provider route ${r} needs the hosts M1-34 Step 11 records in ${RECORDED_HOSTS_PATH}; none recorded, refusing an enforced run`,
        );
      }
      rec.forEach((h) => out.add(h));
    }
  }
  return [...out].sort();
}

// ---------------------------------------------------------------------------
// The firewall plan and the scripts ops run elevated.

export interface FirewallRule {
  name: string;
  enabled: boolean;
  direction: "Inbound" | "Outbound";
  action: "Block" | "Allow";
  profile: string;
  protocol: number;
  localPorts: string[] | "Any";
  remoteAddress: string;
  localAddress: string;
  program: string;
  service: string;
  interfaceIndex: number;
}

export function blockedTcpRanges(allowed: number[]): string[] {
  const out: string[] = [];
  let from = 1;
  for (const p of [...new Set(allowed)].sort((a, b) => a - b)) {
    if (p > from) out.push(p - 1 === from ? `${from}` : `${from}-${p - 1}`);
    from = p + 1;
  }
  if (from <= 65535) out.push(from === 65535 ? "65535" : `${from}-65535`);
  return out;
}

/** TCP as complementary ranges (a block rule overrides any allow); every other IP protocol blocked whole. */
export function firewallPlan(interfaceIndex: number): FirewallRule[] {
  if (!Number.isInteger(interfaceIndex) || interfaceIndex <= 0) {
    throw new ConfigurationError(
      `refusing rules without a real interface index (got ${interfaceIndex})`,
    );
  }
  const base = {
    enabled: true,
    direction: "Inbound" as const,
    action: "Block" as const,
    profile: "Any",
    remoteAddress: "Any",
    localAddress: "Any",
    program: "Any",
    service: "Any",
    interfaceIndex,
  };
  const rules: FirewallRule[] = [{
    ...base,
    name: `${RULE_GROUP}-tcp`,
    protocol: 6,
    localPorts: blockedTcpRanges([PROXY_PORT, BACKEND_PORT]),
  }];
  for (let n = 0; n <= 255; n++) {
    if (n !== 6) {
      rules.push({
        ...base,
        name: `${RULE_GROUP}-proto-${n}`,
        protocol: n,
        localPorts: "Any",
      });
    }
  }
  return rules;
}

/** A PowerShell single-quoted literal; refuses what cannot be one line. */
function psq(s: string, what: string): string {
  if (/[\r\n\0]/.test(s) || s === "") {
    throw new ConfigurationError(`${what} must be one non-empty line`);
  }
  return `'${s.replaceAll("'", "''")}'`;
}

const PS_HEAD = [
  "$ErrorActionPreference = 'Stop'",
  "$utf8 = New-Object System.Text.UTF8Encoding $false",
  "$me = New-Object Security.Principal.WindowsPrincipal ([Security.Principal.WindowsIdentity]::GetCurrent())",
  "if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'run this script elevated' }",
  "function Save-Json($path, $value) { [IO.File]::WriteAllText($path, (ConvertTo-Json -InputObject $value -Depth 4), $utf8) }",
  "# A lookup that finds nothing reports ObjectNotFound; any other error stops the script.",
  "function Assert-NotFoundOnly($errs, $what) { $bad = @($errs | Where-Object { $_.CategoryInfo.Category -ne 'ObjectNotFound' }); if ($bad.Count -gt 0) { throw \"cannot read $($what): $($bad[0])\" } }",
];

/**
 * Transactional apply (run elevated by ops, M1-34). Refuses before any
 * change (existing group, wrong adapter, adapter not the vEthernet of the
 * inspected HNS network, foreign effective blocks); writes the apply record
 * with the profile snapshot before the first change; records every rule it
 * creates; on any error removes only those and restores the profiles, and
 * keeps the record for revert when that rollback is incomplete.
 * Deterministic: the same inputs give the same script.
 */
export function applyScript(
  plan: FirewallRule[],
  o: { invocation: string; dir: string; interfaceAlias: string; hnsId: string },
): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(o.invocation)) {
    throw new ConfigurationError(
      `invocation id must be letters, digits and dashes (got ${o.invocation})`,
    );
  }
  if (!/^[A-Za-z0-9-]{1,64}$/.test(o.hnsId)) {
    throw new ConfigurationError(
      `hns network id must be the inspected id (letters, digits, dashes; got ${o.hnsId})`,
    );
  }
  const idx = plan[0]?.interfaceIndex;
  const expected = idx === undefined ? null : firewallPlan(idx);
  if (!expected || JSON.stringify(plan) !== JSON.stringify(expected)) {
    throw new ConfigurationError(
      "applyScript takes exactly firewallPlan(interfaceIndex)",
    );
  }
  const dir = psq(o.dir, "dir");
  const alias = psq(o.interfaceAlias, "interface alias");
  const f = (kind: string) =>
    `(Join-Path $dir 'fw-${kind}-${o.invocation}.json')`;
  const lines = [
    `# Generated by scripts/harness/egress-scripts.ts (M1-33) for invocation ${o.invocation}. Run elevated (M1-34); do not edit.`,
    ...PS_HEAD,
    `$dir = ${dir}`,
    `$alias = ${alias}`,
    "New-Item -ItemType Directory -Force -Path $dir | Out-Null",
    "# Refusals: nothing has changed yet, so nothing is rolled back.",
    "$e = $null",
    `$existing = @(Get-NetFirewallRule -Group '${RULE_GROUP}' -ErrorAction SilentlyContinue -ErrorVariable e)`,
    `Assert-NotFoundOnly $e 'the ${RULE_GROUP} group'`,
    `if ($existing.Count -gt 0) { throw 'group ${RULE_GROUP} exists: revert first' }`,
    `$ip = Get-NetIPAddress -IPAddress '${SANDBOX_NETWORK.gateway}' -ErrorAction Stop`,
    `if (@($ip).Count -ne 1 -or $ip.InterfaceAlias -ne $alias -or $ip.InterfaceIndex -ne ${idx}) { throw "gateway ${SANDBOX_NETWORK.gateway} is on '$($ip.InterfaceAlias)' (index $($ip.InterfaceIndex)), not the planned $alias (index ${idx}): regenerate the scripts" }`,
    "# The adapter must be the vEthernet of the inspected HNS network (by name or id).",
    `$hns = @(Get-HnsNetwork | Where-Object { [string]$_.Id -eq '${o.hnsId}' })`,
    `if ($hns.Count -ne 1) { throw "HNS network ${o.hnsId} not found (found $($hns.Count)): regenerate the scripts" }`,
    '$vEthernet = @("vEthernet ($([string]$hns[0].Name))", "vEthernet ($([string]$hns[0].Id))")',
    `if ($vEthernet -notcontains [string]$ip.InterfaceAlias) { throw "adapter '$($ip.InterfaceAlias)' is not the vEthernet of HNS network ${o.hnsId} ($($hns[0].Name)): refusing" }`,
    "$e = $null",
    `$foreign = @(Get-NetFirewallRule -PolicyStore ActiveStore -Enabled True -Action Block -ErrorAction SilentlyContinue -ErrorVariable e | Where-Object { $_.Group -ne '${RULE_GROUP}' } | ForEach-Object { [ordered]@{ Name = [string]$_.Name; DisplayName = [string]$_.DisplayName; Direction = [string]$_.Direction; Profile = [string]$_.Profile; Source = [string]$_.PolicyStoreSource } })`,
    "Assert-NotFoundOnly $e 'the effective block rules'",
    `Save-Json ${f("block-inventory")} $foreign`,
    `if ($foreign.Count -gt 0) { throw "owner decision required: $($foreign.Count) effective block rules exist outside ${RULE_GROUP}; see ${`fw-block-inventory-${o.invocation}.json`}" }`,
    `$snapshot = @(Get-NetFirewallProfile | ForEach-Object { [ordered]@{ Name = [string]$_.Name; Enabled = [string]$_.Enabled; DefaultInboundAction = [string]$_.DefaultInboundAction; DefaultOutboundAction = [string]$_.DefaultOutboundAction } })`,
    'if ($snapshot.Count -ne 3) { throw "expected 3 firewall profiles, found $($snapshot.Count)" }',
    `Save-Json ${f("snapshot")} $snapshot`,
    "# The apply record carries the snapshot and exists before any change: an interrupted apply is revertible.",
    "$created = @()",
    `$record = [ordered]@{ invocation = '${o.invocation}'; snapshot = $snapshot; created = $created }`,
    `$applied = ${f("apply")}`,
    "Save-Json $applied $record",
    "$changedProfiles = $false",
    "try {",
    "  $changedProfiles = $true",
    "  Set-NetFirewallProfile -All -DefaultInboundAction Allow -DefaultOutboundAction Allow",
    "  Set-NetFirewallProfile -All -Enabled True",
  ];
  for (const r of plan) {
    const ports = r.localPorts === "Any"
      ? ""
      : ` -LocalPort @(${r.localPorts.map((p) => `'${p}'`).join(", ")})`;
    lines.push(
      `  New-NetFirewallRule -Group '${RULE_GROUP}' -Name '${r.name}' -DisplayName '${r.name}' -Enabled True -Direction Inbound -Action Block -Profile Any -Protocol ${r.protocol}${ports} -InterfaceAlias $alias | Out-Null; $created += '${r.name}'; $record.created = $created; Save-Json $applied $record`,
    );
  }
  lines.push(
    `  Write-Output "[OK] ${plan.length} rules created in ${RULE_GROUP}"`,
    "} catch {",
    "  $failure = $_",
    "  # Roll back only what this invocation did; a rollback problem never hides the failure.",
    "  $rollback = @()",
    '  foreach ($n in $created) { try { Remove-NetFirewallRule -Name $n -ErrorAction Stop } catch { $rollback += "rule $($n): $($_.Exception.Message)" } }',
    '  if ($changedProfiles) { try { foreach ($p in $snapshot) { Set-NetFirewallProfile -Name $p.Name -Enabled $p.Enabled -DefaultInboundAction $p.DefaultInboundAction -DefaultOutboundAction $p.DefaultOutboundAction -ErrorAction Stop } } catch { $rollback += "profiles: $($_.Exception.Message)" } }',
    "  # A complete rollback archives the record; an incomplete one keeps it for revert.",
    "  if ($rollback.Count -eq 0) {",
    "    $stamp = Get-Date -Format 'yyyyMMddHHmmss'",
    `    foreach ($k in 'apply', 'snapshot') { $x = Join-Path $dir "fw-$k-${o.invocation}.json"; if (Test-Path -LiteralPath $x) { Move-Item -LiteralPath $x -Destination "$x.rolledback-$stamp" } }`,
    "    throw $failure",
    "  }",
    "  throw \"apply failed: $($failure.Exception.Message); rollback incomplete: $($rollback -join '; '); the apply record is kept: run the revert script\"",
    "}",
  );
  return lines.join("\r\n") + "\r\n";
}

/**
 * Revert (run elevated by ops): removes the group (refusing if it holds a
 * rule without our prefix), restores the profiles from the latest apply
 * record's snapshot (also when no rule was created), and archives that
 * invocation's files so a later apply starts clean. Nothing applied and no
 * group is a no-op.
 */
export function revertScript(dir: string): string {
  const lines = [
    "# Generated by scripts/harness/egress-scripts.ts (M1-33). Run elevated (M1-34); do not edit.",
    ...PS_HEAD,
    `$dir = ${psq(dir, "dir")}`,
    "$e = $null",
    `$rules = @(Get-NetFirewallRule -Group '${RULE_GROUP}' -ErrorAction SilentlyContinue -ErrorVariable e)`,
    `Assert-NotFoundOnly $e 'the ${RULE_GROUP} group'`,
    `$foreign = @($rules | Where-Object { $_.Name -notlike '${RULE_GROUP}-*' })`,
    `if ($foreign.Count -gt 0) { throw "group ${RULE_GROUP} holds rules this harness did not create: $(($foreign | ForEach-Object { $_.Name }) -join ', '); refusing" }`,
    "$applied = @(Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^fw-apply-([A-Za-z0-9-]+)\\.json$' } | Sort-Object LastWriteTimeUtc -Descending)",
    `if ($applied.Count -eq 0) { if ($rules.Count -gt 0) { throw 'group ${RULE_GROUP} exists but no applied invocation is recorded in the dir; refusing' }; Write-Output '[OK] nothing to revert'; exit 0 }`,
    "$inv = [regex]::Match($applied[0].Name, '^fw-apply-([A-Za-z0-9-]+)\\.json$').Groups[1].Value",
    "# Windows PowerShell 5.1: assign ConvertFrom-Json first, then enumerate.",
    "$record = ConvertFrom-Json (Get-Content -LiteralPath $applied[0].FullName -Raw -Encoding UTF8)",
    "$profiles = $record.snapshot",
    "$profiles = @($profiles)",
    'if ($profiles.Count -ne 3) { throw "apply record $($applied[0].Name) does not hold a 3-profile snapshot" }',
    `if ($rules.Count -gt 0) { Remove-NetFirewallRule -Group '${RULE_GROUP}' }`,
    "foreach ($p in $profiles) { Set-NetFirewallProfile -Name $p.Name -Enabled $p.Enabled -DefaultInboundAction $p.DefaultInboundAction -DefaultOutboundAction $p.DefaultOutboundAction }",
    "$stamp = Get-Date -Format 'yyyyMMddHHmmss'",
    "foreach ($k in 'apply', 'snapshot', 'block-inventory') { $x = Join-Path $dir \"fw-$k-$inv.json\"; if (Test-Path -LiteralPath $x) { Move-Item -LiteralPath $x -Destination \"$x.reverted-$stamp\" } }",
    'Write-Output "[OK] reverted invocation $inv"',
  ];
  return lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// The effective state and its verification.

export interface EgressState {
  network: {
    id: string;
    driver: string;
    subnet: string;
    gateway: string;
    hnsId: string;
  } | null;
  hns: { id: string; name: string; type: string; subnet: string } | null;
  gatewayAdapter: { index: number; alias: string; prefix: number } | null;
  profiles: {
    name: string;
    enabled: boolean;
    inbound: string;
    outbound: string;
  }[];
  groupRules: FirewallRule[];
  foreignBlockRules: string[];
  marker: { state: string; networkId: string; interfaceIndex: number } | null;
}

const FIELDS = [
  "enabled",
  "direction",
  "action",
  "profile",
  "protocol",
  "localPorts",
  "remoteAddress",
  "localAddress",
  "program",
  "service",
  "interfaceIndex",
] as const;
const LABEL: Record<(typeof FIELDS)[number], string> = {
  enabled: "disabled",
  direction: "direction",
  action: "action",
  profile: "profile",
  protocol: "protocol",
  localPorts: "ports",
  remoteAddress: "remote address",
  localAddress: "local address",
  program: "program",
  service: "service",
  interfaceIndex: "interface",
};

export function verifyEgressState(s: EgressState): string[] {
  const p: string[] = [];
  const n = s.network;
  if (!n) p.push(`network ${SANDBOX_NETWORK.name} is missing`);
  else {
    if (n.driver !== "internal") {
      p.push(`network driver is ${n.driver}, not internal`);
    }
    if (
      n.subnet !== SANDBOX_NETWORK.subnet ||
      n.gateway !== SANDBOX_NETWORK.gateway
    ) {
      p.push(
        `network subnet or gateway (${n.subnet}, ${n.gateway}) differs from the plan`,
      );
    }
  }
  if (
    !s.hns || s.hns.id !== n?.hnsId || s.hns.type !== "Internal" ||
    s.hns.subnet !== SANDBOX_NETWORK.subnet
  ) {
    p.push(
      `hns network behind ${SANDBOX_NETWORK.name} is not the internal network of the plan`,
    );
  }
  if (
    !s.gatewayAdapter ||
    s.gatewayAdapter.prefix !== Number(SANDBOX_NETWORK.subnet.split("/")[1])
  ) {
    p.push("gateway adapter prefix does not match the sandbox subnet");
  }
  // The rules bind to this adapter: it must be the vEthernet of that HNS network.
  const vEthernet = s.hns
    ? [`vEthernet (${s.hns.name})`, `vEthernet (${s.hns.id})`].map((x) =>
      x.toLowerCase()
    )
    : [];
  if (
    s.gatewayAdapter &&
    !vEthernet.includes(s.gatewayAdapter.alias.toLowerCase())
  ) {
    p.push(
      `gateway adapter ${s.gatewayAdapter.alias} is not the vEthernet of HNS network ${
        s.hns ? `${s.hns.id} (${s.hns.name})` : "(missing)"
      }`,
    );
  }
  if (
    s.marker &&
    (s.marker.networkId !== n?.id ||
      s.marker.interfaceIndex !== s.gatewayAdapter?.index)
  ) {
    p.push(
      "network recreated since verification (network id or interface index changed): regenerate and reapply the rules",
    );
  }
  const plan = s.gatewayAdapter ? firewallPlan(s.gatewayAdapter.index) : [];
  const byName = new Map(s.groupRules.map((r) => [r.name, r]));
  for (const want of plan) {
    const got = byName.get(want.name);
    if (!got) {
      p.push(`missing rule ${want.name}`);
      continue;
    }
    for (const f of FIELDS) {
      if (JSON.stringify(got[f]) !== JSON.stringify(want[f])) {
        p.push(
          `rule ${want.name}: ${LABEL[f]} is ${
            JSON.stringify(got[f])
          }, expected ${JSON.stringify(want[f])}`,
        );
      }
    }
  }
  const counts = new Map<string, number>();
  for (const r of s.groupRules) {
    counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
  }
  for (const [name, c] of counts) {
    if (!plan.some((w) => w.name === name)) {
      p.push(`extra rule ${name} in ${RULE_GROUP}`);
    } else if (c > 1) p.push(`extra rule: ${name} appears ${c} times`);
  }
  const names = s.profiles.map((x) => x.name).sort();
  if (
    JSON.stringify(names) !== JSON.stringify(["Domain", "Private", "Public"])
  ) {
    p.push(
      `firewall profiles observed ${
        JSON.stringify(names)
      }: expected exactly Domain, Private and Public`,
    );
  }
  for (const pr of s.profiles) {
    if (!pr.enabled) p.push(`firewall profile ${pr.name} disabled`);
    if (pr.inbound !== "Allow") {
      p.push(`profile ${pr.name}: default inbound is ${pr.inbound}`);
    }
    if (pr.outbound !== "Allow") {
      p.push(`profile ${pr.name}: default outbound is ${pr.outbound}`);
    }
  }
  for (const f of s.foreignBlockRules) {
    p.push(`foreign block rule is effective: ${f}`);
  }
  return p;
}

// ---------------------------------------------------------------------------
// The collector: one non-elevated read of the host, strictly parsed.

const strOrList = z.union([z.string(), z.array(z.string())]).transform((v) =>
  Array.isArray(v) ? v : [v]
);
const PROTOCOLS: Record<string, number> = {
  TCP: 6,
  UDP: 17,
  ICMPV4: 1,
  ICMPV6: 58,
};
const one = (v: string[]) => v.length === 1 ? v[0]! : JSON.stringify(v);
const portKey = (s: string) => Number(s.split("-")[0]);

const RawSchema = z.object({
  network: z.object({
    Id: z.string().min(1),
    Driver: z.string(),
    Subnet: z.string(),
    Gateway: z.string(),
    HnsId: z.string(),
  }).nullable(),
  hns: z.object({
    Id: z.string(),
    Name: z.string(),
    Type: z.string(),
    Subnet: z.string(),
  }).nullable(),
  gatewayAdapter: z.object({
    Index: z.number().int(),
    Alias: z.string(),
    Prefix: z.number().int(),
  }).nullable(),
  profiles: z.array(z.object({
    Name: z.string(),
    Enabled: z.string(),
    DefaultInboundAction: z.string(),
    DefaultOutboundAction: z.string(),
  })),
  groupRules: z.array(z.object({
    Name: z.string().min(1),
    Enabled: z.string(),
    Direction: z.string(),
    Action: z.string(),
    Profile: z.string(),
    Protocol: z.string(),
    LocalPort: strOrList,
    RemoteAddress: strOrList,
    LocalAddress: strOrList,
    Program: z.string(),
    Service: z.string(),
    InterfaceIndex: z.array(z.number().int().nullable()),
  })),
  foreignBlockRules: z.array(z.string()),
  marker: z.object({
    v: z.literal(1),
    state: z.enum(MARKER_STATES),
    network_id: z.string().min(1),
    interface_index: z.number().int(),
  }).nullable(),
}).strict();

export type EgressRun = () => Promise<{ code: number; stdout: string }>;

/**
 * Parse one observation of the host. A failed command, empty or truncated
 * output, or any missing section throws an error naming egress: an
 * incomplete observation is never an empty inventory.
 */
export async function collectEgressState(
  run: EgressRun = realEgressCollector(join("results", "harness", MARKER_FILE)),
): Promise<EgressState> {
  const r = await run();
  if (r.code !== 0) {
    throw new ValidationError(
      `egress observation failed (exit ${r.code}): ${
        r.stdout.trim().slice(0, 500)
      }`,
      ["egress"],
    );
  }
  if (r.stdout.trim() === "") {
    throw new ValidationError("egress observation printed nothing", [
      "egress",
    ]);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(r.stdout);
  } catch (err) {
    throw new ValidationError(
      `egress observation is not complete JSON: ${(err as Error).message}`,
      ["egress"],
    );
  }
  const parsed = RawSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(
      `egress observation is incomplete: ${
        parsed.error.issues.map((i) =>
          `${i.path.join(".") || "(root)"}: ${i.message}`
        )
          .join("; ")
      }`,
      ["egress"],
    );
  }
  const d = parsed.data;
  return {
    network: d.network && {
      id: d.network.Id,
      driver: d.network.Driver,
      subnet: d.network.Subnet,
      gateway: d.network.Gateway,
      hnsId: d.network.HnsId,
    },
    hns: d.hns && {
      id: d.hns.Id,
      name: d.hns.Name,
      type: d.hns.Type,
      subnet: d.hns.Subnet,
    },
    gatewayAdapter: d.gatewayAdapter && {
      index: d.gatewayAdapter.Index,
      alias: d.gatewayAdapter.Alias,
      prefix: d.gatewayAdapter.Prefix,
    },
    profiles: d.profiles.map((x) => ({
      name: x.Name,
      enabled: x.Enabled === "True",
      inbound: x.DefaultInboundAction,
      outbound: x.DefaultOutboundAction,
    })),
    groupRules: d.groupRules.map((x) => {
      const proto = x.Protocol.toUpperCase();
      const idx = x.InterfaceIndex;
      return {
        name: x.Name,
        enabled: x.Enabled === "True",
        direction: x.Direction as FirewallRule["direction"],
        action: x.Action as FirewallRule["action"],
        profile: x.Profile,
        protocol: PROTOCOLS[proto] ??
          (/^\d{1,3}$/.test(proto) ? Number(proto) : -1),
        localPorts: x.LocalPort.length === 1 && x.LocalPort[0] === "Any"
          ? "Any"
          : [...x.LocalPort].sort((a, b) => portKey(a) - portKey(b)),
        remoteAddress: one(x.RemoteAddress),
        localAddress: one(x.LocalAddress),
        program: x.Program,
        service: x.Service,
        // Any other shape than one known interface never equals a planned index.
        interfaceIndex: idx.length === 1 && idx[0] !== null ? idx[0]! : -1,
      };
    }),
    foreignBlockRules: d.foreignBlockRules,
    marker: d.marker && {
      state: d.marker.state,
      networkId: d.marker.network_id,
      interfaceIndex: d.marker.interface_index,
    },
  };
}

const POWERSHELL = () =>
  `${
    Deno.env.get("SystemRoot") ?? "C:\\Windows"
  }\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
const COLLECT_TIMEOUT_MS = 120_000;

/** Read-only host observation (Windows PowerShell 5.1, never elevated); prints one JSON object. */
export const COLLECT_PS = [
  "$ErrorActionPreference = 'Stop'",
  "$gw = $env:CG_GATEWAY",
  "function Assert-NotFoundOnly($errs, $what) { $bad = @($errs | Where-Object { $_.CategoryInfo.Category -ne 'ObjectNotFound' }); if ($bad.Count -gt 0) { throw \"cannot read $($what): $($bad[0])\" } }",
  "$ifIndex = @{}; foreach ($i in @(Get-NetIPInterface -AddressFamily IPv4)) { $ifIndex[[string]$i.InterfaceAlias] = [int]$i.ifIndex }",
  "$e = $null",
  `$rules = @(Get-NetFirewallRule -PolicyStore ActiveStore -Group '${RULE_GROUP}' -ErrorAction SilentlyContinue -ErrorVariable e)`,
  "Assert-NotFoundOnly $e 'the group rules'",
  "function By-Id($filters) { $m = @{}; foreach ($f in $filters) { $m[[string]$f.InstanceID] = $f }; $m }",
  "$pf = By-Id (Get-NetFirewallPortFilter -All -PolicyStore ActiveStore)",
  "$af = By-Id (Get-NetFirewallAddressFilter -All -PolicyStore ActiveStore)",
  "$apf = By-Id (Get-NetFirewallApplicationFilter -All -PolicyStore ActiveStore)",
  "$sf = By-Id (Get-NetFirewallServiceFilter -All -PolicyStore ActiveStore)",
  "$inf = By-Id (Get-NetFirewallInterfaceFilter -All -PolicyStore ActiveStore)",
  '$groupRules = @(foreach ($r in $rules) { $id = [string]$r.InstanceID; if (-not ($pf[$id] -and $af[$id] -and $apf[$id] -and $sf[$id] -and $inf[$id])) { throw "rule $($r.Name): a filter is missing" }',
  "  [ordered]@{ Name = [string]$r.Name; Enabled = [string]$r.Enabled; Direction = [string]$r.Direction; Action = [string]$r.Action; Profile = [string]$r.Profile;",
  "    Protocol = [string]$pf[$id].Protocol; LocalPort = @($pf[$id].LocalPort | ForEach-Object { [string]$_ }); RemoteAddress = @($af[$id].RemoteAddress | ForEach-Object { [string]$_ }); LocalAddress = @($af[$id].LocalAddress | ForEach-Object { [string]$_ });",
  "    Program = [string]$apf[$id].Program; Service = [string]$sf[$id].Service;",
  "    InterfaceIndex = @($inf[$id].InterfaceAlias | ForEach-Object { if ([string]$_ -eq 'Any') { 0 } elseif ($ifIndex.ContainsKey([string]$_)) { $ifIndex[[string]$_] } else { $null } }) } })",
  "$e = $null",
  `$foreign = @(Get-NetFirewallRule -PolicyStore ActiveStore -Enabled True -Action Block -ErrorAction SilentlyContinue -ErrorVariable e | Where-Object { $_.Group -ne '${RULE_GROUP}' } | ForEach-Object { \"$($_.DisplayName) [$($_.Name), $($_.Direction), $($_.PolicyStoreSource)]\" })`,
  "Assert-NotFoundOnly $e 'the effective block rules'",
  "$profiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore | ForEach-Object { [ordered]@{ Name = [string]$_.Name; Enabled = [string]$_.Enabled; DefaultInboundAction = [string]$_.DefaultInboundAction; DefaultOutboundAction = [string]$_.DefaultOutboundAction } })",
  "$e = $null",
  "$ip = @(Get-NetIPAddress -IPAddress $gw -ErrorAction SilentlyContinue -ErrorVariable e)",
  "Assert-NotFoundOnly $e 'the gateway address'",
  'if ($ip.Count -gt 1) { throw "gateway $gw is on $($ip.Count) adapters" }',
  "$adapter = $null; if ($ip.Count -eq 1) { $adapter = [ordered]@{ Index = [int]$ip[0].InterfaceIndex; Alias = [string]$ip[0].InterfaceAlias; Prefix = [int]$ip[0].PrefixLength } }",
  "$hns = $null",
  "if ($env:CG_HNS_ID) { $h = @(Get-HnsNetwork | Where-Object { [string]$_.Id -eq $env:CG_HNS_ID }); if ($h.Count -gt 1) { throw 'hns id is ambiguous' }; if ($h.Count -eq 1) { $hns = [ordered]@{ Id = [string]$h[0].Id; Name = [string]$h[0].Name; Type = [string]$h[0].Type; Subnet = [string]@($h[0].Subnets)[0].AddressPrefix } } }",
  "$out = [ordered]@{ hns = $hns; gatewayAdapter = $adapter; profiles = $profiles; groupRules = $groupRules; foreignBlockRules = $foreign }",
  "[Console]::Out.Write((ConvertTo-Json -InputObject $out -Depth 6 -Compress))",
].join("\n");

async function command(
  exe: string,
  args: string[],
  env: Record<string, string>,
  ms = COLLECT_TIMEOUT_MS,
) {
  const out = await new Deno.Command(exe, {
    args,
    clearEnv: true,
    env: { ...dockerChildEnv(), ...env },
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(ms),
  }).output();
  const dec = new TextDecoder();
  return {
    code: out.code,
    stdout: dec.decode(out.stdout),
    stderr: dec.decode(out.stderr),
  };
}

/** The real observation: docker network inspect, one Windows PowerShell read, the marker. */
export function realEgressCollector(markerPath: string): EgressRun {
  return async () => {
    try {
      const d = await command("docker", [
        "network",
        "inspect",
        SANDBOX_NETWORK.name,
      ], dockerContextEnv());
      let network: unknown = null;
      if (d.code !== 0) {
        if (!/not found|no such network/i.test(d.stderr)) {
          throw new Error(`docker network inspect: ${d.stderr.trim()}`);
        }
      } else {
        // deno-lint-ignore no-explicit-any
        const n = (JSON.parse(d.stdout) as any[])[0];
        const cfg = n?.IPAM?.Config?.[0] ?? {};
        network = {
          Id: String(n?.Id ?? ""),
          Driver: String(n?.Driver ?? ""),
          Subnet: String(cfg.Subnet ?? ""),
          Gateway: String(cfg.Gateway ?? ""),
          HnsId: String(
            n?.Options?.["com.docker.network.windowsshim.hnsid"] ?? "",
          ),
        };
      }
      const hnsId = (network as { HnsId?: string } | null)?.HnsId ?? "";
      const ps = await command(POWERSHELL(), [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        COLLECT_PS,
      ], { CG_GATEWAY: SANDBOX_NETWORK.gateway, CG_HNS_ID: hnsId });
      if (ps.code !== 0) {
        throw new Error(
          `host read failed: ${ps.stderr.trim() || ps.stdout.trim()}`,
        );
      }
      let marker: unknown = null;
      try {
        marker = JSON.parse(await Deno.readTextFile(markerPath));
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) {
          throw new Error(`marker ${markerPath}: ${(err as Error).message}`);
        }
      }
      const host = JSON.parse(ps.stdout);
      return {
        code: 0,
        stdout: JSON.stringify({ network, ...host, marker }),
      };
    } catch (err) {
      return { code: 1, stdout: (err as Error).message };
    }
  };
}

// ---------------------------------------------------------------------------
// Listeners and the in-sandbox preflight.

/** Proxy and backend must listen on the gateway and nowhere else. */
export function listenerProblems(
  rows: { port: number; address: string }[],
): string[] {
  const p: string[] = [];
  for (const port of [PROXY_PORT, BACKEND_PORT]) {
    const at = rows.filter((r) => r.port === port);
    if (!at.some((r) => r.address === SANDBOX_NETWORK.gateway)) {
      p.push(`port ${port}: nothing listening on ${SANDBOX_NETWORK.gateway}`);
    }
    for (const r of at) {
      if (r.address !== SANDBOX_NETWORK.gateway) {
        p.push(`port ${port} also listens on ${r.address} (gateway only)`);
      }
    }
  }
  return p;
}

const NEGATIVE_PROBES = [
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
];

/**
 * A2: every negative, the backend, and one positive proxy probe per route
 * host of this execution. In record mode the proxy allows any DNS name, so
 * the example.com probe must be open (proof the record proxy is the one
 * answering); IP literals stay refused.
 */
export function preflightExpect(
  hosts: string[],
  o: { record?: boolean } = {},
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const n of NEGATIVE_PROBES) out[n] = false;
  if (o.record) out["proxy-deny-example.com"] = true;
  out["backend-3210"] = true;
  for (const h of hosts) {
    if (!isAllowableHost(h) || h === "example.com") {
      throw new ConfigurationError(
        `route host ${h} cannot be probed (not a hostname, or the deny probe's host)`,
      );
    }
    out[`proxy-allow-${h}`] = true;
  }
  return out;
}

export const PREFLIGHT_EXPECT: Record<string, boolean> = preflightExpect([
  "api.anthropic.com",
]);

export interface ProbeLine {
  probe: string;
  ok: boolean;
  error?: string;
}

/** Problems with the preflight lines against the expectation; [] means it passed. */
export function evaluatePreflight(
  lines: ProbeLine[],
  expect: Record<string, boolean> = PREFLIGHT_EXPECT,
): string[] {
  const p: string[] = [];
  for (const [probe, want] of Object.entries(expect)) {
    const got = lines.filter((l) => l.probe === probe);
    if (got.length === 0) {
      p.push(`${probe}: missing`);
      continue;
    }
    if (got.length > 1) {
      p.push(`${probe}: reported ${got.length} times`);
      continue;
    }
    const l = got[0]!;
    if (l.error) p.push(`${probe} could not run: ${l.error}`);
    else if (l.ok !== want) {
      p.push(
        `${probe}: expected ${want ? "open" : "blocked"}, observed ${
          l.ok ? "open" : "blocked"
        }`,
      );
    }
  }
  for (const l of lines) {
    if (!Object.hasOwn(expect, l.probe)) p.push(`unexpected probe ${l.probe}`);
  }
  return p;
}

const ProbeLineSchema = z.object({
  probe: z.string().min(1),
  ok: z.boolean(),
  error: z.string().nullable().optional(),
}).strict();

/** The credentialless in-sandbox probe record `harness egress verify --mark qualified` requires. */
export const ProbeEvidenceSchema = z.object({
  v: z.literal(1),
  at: z.iso.datetime(),
  network_id: z.string().min(1),
  interface_index: z.number().int(),
  hosts: z.array(z.string()),
  lines: z.array(ProbeLineSchema),
}).strict();

/** egress-check.ps1 output: every non-empty line is a probe result, anything else is named. */
export function parseProbeLines(text: string): ProbeLine[] {
  const out: ProbeLine[] = [];
  for (const [i, l] of text.split(/\r?\n/).entries()) {
    if (l.trim() === "") continue;
    let v: unknown;
    try {
      v = JSON.parse(l);
    } catch {
      throw new ValidationError(`egress-check line ${i + 1} is not JSON`, [
        "egress-check",
      ]);
    }
    const r = ProbeLineSchema.safeParse(v);
    if (!r.success) {
      throw new ValidationError(
        `egress-check line ${i + 1} is not a probe result: ${
          r.error.issues[0]?.message
        }`,
        ["egress-check"],
      );
    }
    out.push({
      probe: r.data.probe,
      ok: r.data.ok,
      ...(r.data.error ? { error: r.data.error } : {}),
    });
  }
  if (out.length === 0) {
    throw new ValidationError("egress-check printed no probe lines", [
      "egress-check",
    ]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The run-time seam execution.ts calls; tests pass an in-memory one.

export interface EgressRuntime {
  /** Ops recording completing RECORDED_ROUTES (M1-34 Step 11). */
  recordedHosts: RecordedHosts;
  /** Host state now: problems, [] when verified (marker qualified or authorized included). */
  verify(): Promise<string[]>;
  /** Proxy and backend listening on the gateway only: problems. */
  listeners(): Promise<string[]>;
  /** The execution's proxy: exactly these hosts (record: any DNS name on 443); every decision goes to log. */
  startProxy(o: {
    allowedHosts: string[];
    log(l: EgressLogLine): void;
    record?: boolean;
  }): Promise<{ shutdown(): Promise<void> }>;
  /** Run C:\egress-check.ps1 inside the running sandbox. */
  probe(sandbox: string, hosts: string[]): Promise<ProbeLine[]>;
}

export const LISTEN_PS =
  `@(Get-NetTCPConnection -State Listen -LocalPort ${PROXY_PORT},${BACKEND_PORT} -ErrorAction SilentlyContinue | ForEach-Object { [ordered]@{ port = [int]$_.LocalPort; address = [string]$_.LocalAddress } }) | ForEach-Object { [Console]::Out.WriteLine((ConvertTo-Json -InputObject $_ -Compress)) }`;
export const ROUTER_PS =
  "$r = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction Stop | Sort-Object RouteMetric | Select-Object -First 1; [Console]::Out.Write([string]$r.NextHop)";
const PROBE_TIMEOUT_MS = 180_000;

/** The production runtime (Windows host, Docker Desktop Windows containers). */
export async function realEgressRuntime(
  o: { repoRoot: string; markerPath: string; acceptCandidate?: boolean },
): Promise<EgressRuntime> {
  const recordedHosts = await loadRecordedHosts(o.repoRoot);
  return {
    recordedHosts,
    async verify() {
      const s = await collectEgressState(realEgressCollector(o.markerPath));
      const p = verifyEgressState(s);
      const placing = o.acceptCandidate
        ? ["candidate", "qualified", "authorized"]
        : ["qualified", "authorized"];
      if (!s.marker || !placing.includes(s.marker.state)) {
        p.push(
          `egress marker ${o.markerPath} is ${
            s.marker?.state ?? "missing"
          }: placement needs ${placing.join(" or ")}`,
        );
      }
      return p;
    },
    async listeners() {
      const r = await command(POWERSHELL(), [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        LISTEN_PS,
      ], {});
      if (r.code !== 0) {
        return [`cannot list listeners: ${r.stderr.trim()}`];
      }
      return listenerProblems(
        r.stdout.split(/\r?\n/).filter((l) => l.trim()).map((l) =>
          JSON.parse(l)
        ),
      );
    },
    startProxy(p) {
      const proxy = startEgressProxy({
        hostname: SANDBOX_NETWORK.gateway,
        port: PROXY_PORT,
        allowedHosts: [SANDBOX_NETWORK.gateway],
        allow: p.allowedHosts,
        log: p.log,
        recordMode: p.record === true,
      });
      return Promise.resolve({ shutdown: () => proxy.shutdown() });
    },
    async probe(sandbox, hosts) {
      const router = await command(POWERSHELL(), [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        ROUTER_PS,
      ], {});
      const lan = router.stdout.trim();
      // The UDP negative needs something that would answer: an echo on the gateway.
      const dgram = await import("node:dgram");
      const echo = dgram.createSocket("udp4");
      await new Promise<void>((res, rej) => {
        echo.once("error", rej);
        echo.bind(3202, SANDBOX_NETWORK.gateway, () => res());
      });
      echo.on("message", (m, from) => echo.send(m, from.port, from.address));
      try {
        const args = [
          "exec",
          sandbox,
          "powershell",
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          "C:\\egress-check.ps1",
          "-Allow",
          hosts.map((h) => `proxy-allow-${h}`).join(",") || "none",
          ...(IPV4.test(lan) ? ["-LanRouter", lan] : []),
        ];
        const r = await command(
          "docker",
          args,
          dockerContextEnv(),
          PROBE_TIMEOUT_MS,
        );
        if (r.code !== 0) {
          throw new ValidationError(
            `egress-check exited ${r.code}: ${r.stderr.trim().slice(0, 500)}`,
            ["egress-check"],
          );
        }
        return parseProbeLines(r.stdout);
      } finally {
        echo.close();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Review item 3: an authorized marker carries its evidence; every read rechecks it.

export async function sha256File(path: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", await Deno.readFile(path));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Text(text: string): Promise<string> {
  const d = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The authorized allowlist and its hash, from the current recording. */
export async function authorizedAllowlist(
  repoRoot: string,
): Promise<{ allowlist: string[]; sha256: string }> {
  const allowlist = hostsForRoutes(
    Object.keys(ROUTE_HOSTS),
    await loadRecordedHosts(repoRoot),
  );
  return { allowlist, sha256: await sha256Text(JSON.stringify(allowlist)) };
}

/**
 * Problems with an authorized marker's evidence: the qualification
 * evidence reference and hash, the recorded-hosts hash, the supervised
 * cell, the rotation flag and the allowlist hash, each present and equal to
 * what is on disk now. Empty means authorized.
 */
export async function authorizedMarkerProblems(
  repoRoot: string,
  m: Record<string, unknown>,
): Promise<string[]> {
  const p: string[] = [];
  const str = (k: string) => {
    const v = m[k];
    if (typeof v !== "string" || v === "") {
      p.push(`${k} is missing`);
      return null;
    }
    return v;
  };
  const probe = str("probe_evidence");
  const probeSha = str("probe_evidence_sha256");
  const recordedSha = str("recorded_hosts_sha256");
  const cell = str("cell");
  const allowSha = str("allowlist_sha256");
  if (m["rotation_done"] !== true) p.push("rotation_done is not true");
  const same = async (
    k: string,
    want: string | null,
    got: () => Promise<string>,
  ) => {
    if (want === null) return;
    let now: string;
    try {
      now = await got();
    } catch (err) {
      p.push(`${k}: cannot recompute (${(err as Error).message})`);
      return;
    }
    if (now !== want) p.push(`${k} does not match the current file`);
  };
  if (probe) {
    await same("probe_evidence_sha256", probeSha, () => sha256File(probe));
  }
  await same(
    "recorded_hosts_sha256",
    recordedSha,
    () => sha256File(join(repoRoot, ...RECORDED_HOSTS_PATH.split("/"))),
  );
  if (allowSha !== null) {
    try {
      const a = await authorizedAllowlist(repoRoot);
      if (a.sha256 !== allowSha) {
        p.push("allowlist_sha256 does not match the current allowlist");
      }
      if (
        JSON.stringify(m["proxy_allowlist"]) !== JSON.stringify(a.allowlist)
      ) {
        p.push("proxy_allowlist does not match the current allowlist");
      }
    } catch (err) {
      p.push(`allowlist_sha256: cannot recompute (${(err as Error).message})`);
    }
  }
  if (cell) {
    const executions = join(
      repoRoot,
      "results",
      "harness",
      "cells",
      "executions",
    );
    let found = false;
    try {
      for (const d of Deno.readDirSync(executions)) {
        try {
          Deno.statSync(join(executions, d.name, `${cell}.json`));
          found = true;
        } catch { /* not in this campaign */ }
      }
    } catch { /* no cells */ }
    if (!found) p.push(`cell ${cell} is not in ${executions}`);
  }
  return p;
}
