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
  interfaceType: string;
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
    interfaceType: "Any",
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
  "# Temp file then replace: a crash leaves the old file or the new one, never a truncated one.",
  'function Save-JsonAtomic($path, $value) { $tmp = "$path.tmp"; [IO.File]::WriteAllText($tmp, (ConvertTo-Json -InputObject $value -Depth 4), $utf8); if (Test-Path -LiteralPath $path) { [IO.File]::Replace($tmp, $path, [NullString]::Value) } else { [IO.File]::Move($tmp, $path) } }',
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
    "# The HNS network is the Docker sandbox network's own; the caller's id must agree.",
    "$dockerContext = if ($env:DOCKER_CONTEXT) { $env:DOCKER_CONTEXT } else { 'desktop-windows' }",
    `$inspect = & docker --context $dockerContext network inspect ${SANDBOX_NETWORK.name}`,
    `if ($LASTEXITCODE -ne 0) { throw "docker network inspect ${SANDBOX_NETWORK.name} failed (exit $LASTEXITCODE)" }`,
    '$net = ConvertFrom-Json ($inspect -join "`n")',
    "$net = @($net)",
    `if ($net.Count -ne 1) { throw "docker network inspect ${SANDBOX_NETWORK.name} returned $($net.Count) networks" }`,
    "$dockerHns = [string]$net[0].Options.'com.docker.network.windowsshim.hnsid'",
    `if (-not $dockerHns) { throw "docker network ${SANDBOX_NETWORK.name} has no com.docker.network.windowsshim.hnsid" }`,
    `if ($dockerHns -ne '${o.hnsId}') { throw "caller hns id ${o.hnsId} differs from the docker network's $($dockerHns): refusing" }`,
    `$ip = Get-NetIPAddress -IPAddress '${SANDBOX_NETWORK.gateway}' -ErrorAction Stop`,
    `if (@($ip).Count -ne 1 -or $ip.InterfaceAlias -ne $alias -or $ip.InterfaceIndex -ne ${idx}) { throw "gateway ${SANDBOX_NETWORK.gateway} is on '$($ip.InterfaceAlias)' (index $($ip.InterfaceIndex)), not the planned $alias (index ${idx}): regenerate the scripts" }`,
    "# The adapter must be the vEthernet of the inspected HNS network (by name or id).",
    "$hns = @(Get-HnsNetwork | Where-Object { [string]$_.Id -eq $dockerHns })",
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
    `Save-JsonAtomic ${f("snapshot")} $snapshot`,
    "# The apply record carries the snapshot and exists before any change: an interrupted apply is revertible.",
    "$created = @()",
    `$record = [ordered]@{ invocation = '${o.invocation}'; snapshot = $snapshot; created = $created }`,
    `$applied = ${f("apply")}`,
    "Save-JsonAtomic $applied $record",
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
      `  New-NetFirewallRule -Group '${RULE_GROUP}' -Name '${r.name}' -DisplayName '${r.name}' -Enabled True -Direction Inbound -Action Block -Profile Any -Protocol ${r.protocol}${ports} -InterfaceAlias $alias | Out-Null; $created += '${r.name}'; $record.created = $created; Save-JsonAtomic $applied $record`,
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
    "# The newest unarchived apply record or snapshot names the invocation (a crash may leave only the snapshot).",
    "$found = @(Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^fw-(apply|snapshot)-([A-Za-z0-9-]+)\\.json$' } | Sort-Object LastWriteTimeUtc -Descending)",
    `if ($found.Count -eq 0) { if ($rules.Count -gt 0) { throw 'group ${RULE_GROUP} exists but no applied invocation is recorded in the dir; refusing' }; Write-Output '[OK] nothing to revert'; exit 0 }`,
    "$inv = [regex]::Match($found[0].Name, '^fw-(apply|snapshot)-([A-Za-z0-9-]+)\\.json$').Groups[2].Value",
    "# Windows PowerShell 5.1: assign ConvertFrom-Json first, then enumerate.",
    "$profiles = $null",
    '$recordPath = Join-Path $dir "fw-apply-$inv.json"',
    "if (Test-Path -LiteralPath $recordPath) { try { $record = ConvertFrom-Json (Get-Content -LiteralPath $recordPath -Raw -Encoding UTF8); $profiles = @($record.snapshot); if ($profiles.Count -ne 3) { $profiles = $null } } catch { $profiles = $null } }",
    "if ($null -eq $profiles) {",
    '  $snap = Join-Path $dir "fw-snapshot-$inv.json"',
    "  $v = ConvertFrom-Json (Get-Content -LiteralPath $snap -Raw -Encoding UTF8)",
    "  $profiles = @($v)",
    '  if ($profiles.Count -ne 3) { throw "snapshot $snap does not hold 3 profiles" }',
    '  Write-Output "[WARN] apply record for $inv missing or unreadable: profiles from $snap"',
    "}",
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
    /** docker's com.docker.network.windowsshim.networkname: the HNS network's name. */
    networkName: string;
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
  "interfaceType",
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
  interfaceType: "interface type",
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
  // HNS reports its type as "internal" (M1-34 AD-04), and the HNS id and
  // docker's hnsid are GUIDs: both compared case-insensitively (M1-34a). The
  // HNS name is docker's windowsshim.networkname (M1-34c).
  if (
    !s.hns || !n || s.hns.id.toLowerCase() !== n.hnsId.toLowerCase() ||
    !n.networkName ||
    s.hns.name.toLowerCase() !== n.networkName.toLowerCase() ||
    s.hns.type.toLowerCase() !== "internal" ||
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
/** A GUID value of the HNS store (kept apart from strings so a field's type is checked). */
export class HnsGuid {
  constructor(readonly value: string) {}
}
export type HnsValue =
  | boolean
  | number
  | bigint
  | string
  | HnsGuid
  | HnsValue[]
  | Map<string, HnsValue>;
/** Key flags seen on every value of this host's store; another one is format drift. */
const HNS_KEY_FLAGS = new Set([0x10, 0x12, 0x22, 0x32]);

/**
 * Decode an HNS VolatileStore value (undocumented, M1-34b t06): an object is
 * FFFE, entries, FFFD; an entry is u16 type, u32 flags, key, value; a string
 * is a u32 UTF-16 length with its NUL, then the text; an array is a u32 count
 * of objects. Anything else (an unknown type or flag, a duplicate key, a
 * truncated or longer value) throws: drift never yields a partial network.
 */
export function decodeHnsBlob(b: Uint8Array): Map<string, HnsValue> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 0;
  const fail = (m: string): never => {
    throw new Error(`hns blob format drift at byte ${o}: ${m}`);
  };
  const need = (n: number) => {
    if (o + n > b.length) fail("truncated");
  };
  const u16 = () => (need(2), o += 2, v.getUint16(o - 2, true));
  const u32 = () => (need(4), o += 4, v.getUint32(o - 4, true));
  const str = () => {
    const n = u32();
    if (n < 1) fail("string without its NUL");
    need(n * 2);
    const end = o + n * 2 - 2;
    if (v.getUint16(end, true) !== 0) fail("string not NUL-terminated");
    let s = "";
    try {
      s = new TextDecoder("utf-16le", { fatal: true }).decode(
        b.subarray(o, end),
      );
    } catch {
      fail("string not UTF-16");
    }
    if (s.includes("\0")) fail("string with an inner NUL");
    o = end + 2;
    return s;
  };
  const hex = (at: number, n: number) =>
    [...b.subarray(at, at + n)].map((x) => x.toString(16).padStart(2, "0"))
      .join("");
  const value = (t: number): HnsValue => {
    switch (t) {
      case 1: {
        const x = u32();
        if (x > 1) fail(`bool value ${x}`);
        return x === 1;
      }
      case 2:
        return u32();
      case 3:
        need(8);
        o += 8;
        return v.getBigUint64(o - 8, true);
      case 4: {
        need(16);
        const g = [
          v.getUint32(o, true).toString(16).padStart(8, "0"),
          v.getUint16(o + 4, true).toString(16).padStart(4, "0"),
          v.getUint16(o + 6, true).toString(16).padStart(4, "0"),
          hex(o + 8, 2),
          hex(o + 10, 6),
        ].join("-").toUpperCase();
        o += 16;
        return new HnsGuid(g);
      }
      case 5:
        return str();
      case 7:
        return object();
      case 8: {
        const n = u32();
        const a: HnsValue[] = [];
        for (let i = 0; i < n; i++) a.push(object());
        return a;
      }
      default:
        return fail(`value type ${t}`);
    }
  };
  const object = (): Map<string, HnsValue> => {
    if (u16() !== 0xfffe) fail("expected an object start");
    const m = new Map<string, HnsValue>();
    for (;;) {
      need(2);
      if (v.getUint16(o, true) === 0xfffd) {
        o += 2;
        return m;
      }
      const t = u16();
      const flags = u32();
      if (!HNS_KEY_FLAGS.has(flags)) fail(`key flags ${flags}`);
      const k = str();
      if (m.has(k)) fail(`duplicate key ${k}`);
      m.set(k, value(t));
    }
  };
  const root = object();
  if (o !== b.length) fail(`trailing ${b.length - o} bytes`);
  return root;
}

/**
 * The HNS network in one VolatileStore value named `valueName` (docker's
 * hnsid): its own ID must be that name, with exactly one Name, Type and
 * subnet. Throws on any drift or disagreement.
 */
export function parseHnsNetwork(
  valueName: string,
  blob: Uint8Array,
): NonNullable<EgressState["hns"]> {
  const root = decodeHnsBlob(blob);
  const text = (m: Map<string, HnsValue>, k: string) => {
    const x = m.get(k);
    if (typeof x !== "string") throw new Error(`hns ${k} is not a string`);
    return x;
  };
  const id = root.get("ID");
  if (!(id instanceof HnsGuid)) throw new Error("hns ID is not a GUID");
  if (id.value.toLowerCase() !== valueName.toLowerCase()) {
    throw new Error(`hns ID ${id.value} is not the value's name ${valueName}`);
  }
  const subnets = root.get("Subnets");
  if (!Array.isArray(subnets) || subnets.length !== 1) {
    throw new Error("hns Subnets is not exactly one subnet");
  }
  return {
    id: valueName,
    name: text(root, "Name"),
    type: text(root, "Type"),
    subnet: text(subnets[0] as Map<string, HnsValue>, "AddressPrefix"),
  };
}

const filterList = <T extends z.ZodRawShape>(shape: T) =>
  z.array(z.object({ InstanceID: z.string().min(1), ...shape }).strict());

const RawSchema = z.object({
  network: z.object({
    Id: z.string().min(1),
    Driver: z.string(),
    Subnet: z.string(),
    Gateway: z.string(),
    HnsId: z.string(),
    NetworkName: z.string(),
  }).nullable(),
  /** Every HNS VolatileStore network value named like docker's hnsid. */
  hns: z.array(
    z.object({
      Name: z.string(),
      Kind: z.string(),
      Blob: z.string(),
    }).strict(),
  ),
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
  groupRules: z.array(
    z.object({
      InstanceID: z.string().min(1),
      Name: z.string().min(1),
      Enabled: z.string(),
      Direction: z.string(),
      Action: z.string(),
      Profile: z.string(),
    }).strict(),
  ),
  /** The group rules' filters, read by association from those rules (M1-34c). */
  filters: z.object({
    port: filterList({ Protocol: z.string(), LocalPort: strOrList }),
    address: filterList({ RemoteAddress: strOrList, LocalAddress: strOrList }),
    application: filterList({ Program: z.string() }),
    service: filterList({ Service: z.string() }),
    interface: filterList({
      InterfaceIndex: z.array(z.number().int().nullable()),
    }),
    interfaceType: filterList({ InterfaceType: z.string() }),
  }).strict(),
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
  const bad = (m: string): never => {
    throw new ValidationError(`egress observation: ${m}`, ["egress"]);
  };
  // Each group rule has each filter exactly once, and every filter read
  // belongs to a group rule: a partial or ambiguous association refuses.
  const ruleIds = new Map<string, string>();
  for (const r of d.groupRules) {
    if (ruleIds.has(r.InstanceID)) {
      bad(`group rule ${r.InstanceID} (${r.Name}) was read twice`);
    }
    ruleIds.set(r.InstanceID, r.Name);
  }
  const byRule = <T extends { InstanceID: string }>(kind: string, xs: T[]) => {
    const m = new Map<string, T>();
    for (const f of xs) {
      if (!ruleIds.has(f.InstanceID)) {
        bad(
          `a ${kind} filter belongs to no ${RULE_GROUP} rule (${f.InstanceID})`,
        );
      }
      if (m.has(f.InstanceID)) {
        bad(`rule ${ruleIds.get(f.InstanceID)}: more than one ${kind} filter`);
      }
      m.set(f.InstanceID, f);
    }
    for (const [id, name] of ruleIds) {
      if (!m.has(id)) bad(`rule ${name}: no ${kind} filter`);
    }
    return (id: string) => m.get(id)!;
  };
  const f = d.filters;
  const pf = byRule("port", f.port);
  const af = byRule("address", f.address);
  const apf = byRule("application", f.application);
  const sf = byRule("service", f.service);
  const inf = byRule("interface", f.interface);
  const itf = byRule("interfaceType", f.interfaceType);
  // The HNS network: exactly one VolatileStore value, named docker's hnsid, strictly parsed.
  let hns: EgressState["hns"] = null;
  if (d.hns.length > 1) {
    bad(`${d.hns.length} hns values are named ${d.network?.HnsId}`);
  }
  const v = d.hns[0];
  if (v) {
    try {
      if (v.Name.toLowerCase() !== (d.network?.HnsId ?? "").toLowerCase()) {
        throw new Error("not docker's hnsid");
      }
      if (v.Kind !== "Binary") throw new Error(`kind ${v.Kind}, not Binary`);
      hns = parseHnsNetwork(
        v.Name,
        Uint8Array.from(atob(v.Blob), (c) => c.charCodeAt(0)),
      );
    } catch (err) {
      bad(`hns value ${v.Name}: ${(err as Error).message}`);
    }
  }
  return {
    network: d.network && {
      id: d.network.Id,
      driver: d.network.Driver,
      subnet: d.network.Subnet,
      gateway: d.network.Gateway,
      hnsId: d.network.HnsId,
      networkName: d.network.NetworkName,
    },
    hns,
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
      const id = x.InstanceID;
      const port = pf(id);
      const addr = af(id);
      const proto = port.Protocol.toUpperCase();
      const idx = inf(id).InterfaceIndex;
      return {
        name: x.Name,
        enabled: x.Enabled === "True",
        direction: x.Direction as FirewallRule["direction"],
        action: x.Action as FirewallRule["action"],
        profile: x.Profile,
        protocol: PROTOCOLS[proto] ??
          (/^\d{1,3}$/.test(proto) ? Number(proto) : -1),
        localPorts: port.LocalPort.length === 1 && port.LocalPort[0] === "Any"
          ? "Any"
          : [...port.LocalPort].sort((a, b) => portKey(a) - portKey(b)),
        remoteAddress: one(addr.RemoteAddress),
        localAddress: one(addr.LocalAddress),
        program: apf(id).Program,
        service: sf(id).Service,
        // Any other shape than one known interface never equals a planned index.
        interfaceIndex: idx.length === 1 && idx[0] !== null ? idx[0]! : -1,
        interfaceType: itf(id).InterfaceType,
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
const HNS_STORE_KEY =
  "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\hns\\State\\HostComputeNetwork\\VolatileStore\\Network";

/** Read-only host observation (Windows PowerShell 5.1, never elevated); prints one JSON object. */
export const COLLECT_PS = [
  "$ErrorActionPreference = 'Stop'",
  "$gw = $env:CG_GATEWAY",
  "function Assert-NotFoundOnly($errs, $what) { $bad = @($errs | Where-Object { $_.CategoryInfo.Category -ne 'ObjectNotFound' }); if ($bad.Count -gt 0) { throw \"cannot read $($what): $($bad[0])\" } }",
  "$ifIndex = @{}; foreach ($i in @(Get-NetIPInterface -AddressFamily IPv4)) { $ifIndex[[string]$i.InterfaceAlias] = [int]$i.ifIndex }",
  "$e = $null",
  `$rules = @(Get-NetFirewallRule -PolicyStore ActiveStore -Group '${RULE_GROUP}' -ErrorAction SilentlyContinue -ErrorVariable e)`,
  "Assert-NotFoundOnly $e 'the group rules'",
  "$groupRules = @($rules | ForEach-Object { [ordered]@{ InstanceID = [string]$_.InstanceID; Name = [string]$_.Name; Enabled = [string]$_.Enabled; Direction = [string]$_.Direction; Action = [string]$_.Action; Profile = [string]$_.Profile } })",
  "# Filters by association from the group's rules: class-wide filter enumerations are denied non-elevated (M1-34b); the collector checks exactly one of each per rule.",
  "$filters = [ordered]@{ port = @(); address = @(); application = @(); service = @(); interface = @(); interfaceType = @() }",
  "if ($rules.Count -gt 0) {",
  "  $filters.port = @($rules | Get-NetFirewallPortFilter -ErrorAction Stop | ForEach-Object { [ordered]@{ InstanceID = [string]$_.InstanceID; Protocol = [string]$_.Protocol; LocalPort = @($_.LocalPort | ForEach-Object { [string]$_ }) } })",
  "  $filters.address = @($rules | Get-NetFirewallAddressFilter -ErrorAction Stop | ForEach-Object { [ordered]@{ InstanceID = [string]$_.InstanceID; RemoteAddress = @($_.RemoteAddress | ForEach-Object { [string]$_ }); LocalAddress = @($_.LocalAddress | ForEach-Object { [string]$_ }) } })",
  "  $filters.application = @($rules | Get-NetFirewallApplicationFilter -ErrorAction Stop | ForEach-Object { [ordered]@{ InstanceID = [string]$_.InstanceID; Program = [string]$_.Program } })",
  "  $filters.service = @($rules | Get-NetFirewallServiceFilter -ErrorAction Stop | ForEach-Object { [ordered]@{ InstanceID = [string]$_.InstanceID; Service = [string]$_.Service } })",
  "  $filters.interface = @($rules | Get-NetFirewallInterfaceFilter -ErrorAction Stop | ForEach-Object { [ordered]@{ InstanceID = [string]$_.InstanceID; InterfaceIndex = @($_.InterfaceAlias | ForEach-Object { if ([string]$_ -eq 'Any') { 0 } elseif ($ifIndex.ContainsKey([string]$_)) { $ifIndex[[string]$_] } else { $null } }) } })",
  "  $filters.interfaceType = @($rules | Get-NetFirewallInterfaceTypeFilter -ErrorAction Stop | ForEach-Object { [ordered]@{ InstanceID = [string]$_.InstanceID; InterfaceType = [string]$_.InterfaceType } })",
  "}",
  "$e = $null",
  `$foreign = @(Get-NetFirewallRule -PolicyStore ActiveStore -Enabled True -Action Block -ErrorAction SilentlyContinue -ErrorVariable e | Where-Object { $_.Group -ne '${RULE_GROUP}' } | ForEach-Object { \"$($_.DisplayName) [$($_.Name), $($_.Direction), $($_.PolicyStoreSource)]\" })`,
  "Assert-NotFoundOnly $e 'the effective block rules'",
  "$profiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore | ForEach-Object { [ordered]@{ Name = [string]$_.Name; Enabled = [string]$_.Enabled; DefaultInboundAction = [string]$_.DefaultInboundAction; DefaultOutboundAction = [string]$_.DefaultOutboundAction } })",
  "$e = $null",
  "$ip = @(Get-NetIPAddress -IPAddress $gw -ErrorAction SilentlyContinue -ErrorVariable e)",
  "Assert-NotFoundOnly $e 'the gateway address'",
  'if ($ip.Count -gt 1) { throw "gateway $gw is on $($ip.Count) adapters" }',
  "$adapter = $null; if ($ip.Count -eq 1) { $adapter = [ordered]@{ Index = [int]$ip[0].InterfaceIndex; Alias = [string]$ip[0].InterfaceAlias; Prefix = [int]$ip[0].PrefixLength } }",
  "# HNS from its own VolatileStore value (the HNS service query is denied non-elevated, M1-34b); the collector parses it strictly.",
  "$hns = @()",
  `if ($env:CG_HNS_ID) { $k = Get-Item -LiteralPath '${HNS_STORE_KEY}' -ErrorAction Stop; $hns = @($k.GetValueNames() | Where-Object { $_ -eq $env:CG_HNS_ID } | ForEach-Object { [ordered]@{ Name = [string]$_; Kind = [string]$k.GetValueKind($_); Blob = [Convert]::ToBase64String([byte[]]$k.GetValue($_)) } }) }`,
  "$out = [ordered]@{ hns = $hns; gatewayAdapter = $adapter; profiles = $profiles; groupRules = $groupRules; filters = $filters; foreignBlockRules = $foreign }",
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
/** The only top-level keys COLLECT_PS prints. */
const HOST_KEYS = new Set([
  "hns",
  "gatewayAdapter",
  "profiles",
  "groupRules",
  "filters",
  "foreignBlockRules",
]);

/**
 * One observation from the host read plus docker's network and the marker.
 * Docker and the marker are authoritative: a PowerShell key outside
 * HOST_KEYS (a forged `network` or `marker` included) refuses.
 */
export function combineObservation(
  network: unknown,
  psStdout: string,
  marker: unknown,
): string {
  const host: unknown = JSON.parse(psStdout);
  if (typeof host !== "object" || host === null || Array.isArray(host)) {
    throw new Error("host read is not an object");
  }
  for (const key of Object.keys(host)) {
    if (!HOST_KEYS.has(key)) {
      throw new Error(`host read has an unexpected key ${key}`);
    }
  }
  return JSON.stringify({ ...host, network, marker });
}

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
          NetworkName: String(
            n?.Options?.["com.docker.network.windowsshim.networkname"] ?? "",
          ),
        };
      }
      const hnsId = (network as { HnsId?: string } | null)?.HnsId ?? "";
      const ps = await command(POWERSHELL(), [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        COLLECT_PS,
      ], {
        CG_GATEWAY: SANDBOX_NETWORK.gateway,
        CG_HNS_ID: hnsId,
        // Without SystemDrive the NetSecurity cmdlets take ~3x longer (M1-34c: 20 s vs 6 s).
        SystemDrive: Deno.env.get("SystemDrive") ?? "C:",
      });
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
      return {
        code: 0,
        stdout: combineObservation(network, ps.stdout, marker),
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
  o: {
    repoRoot: string;
    markerPath: string;
    acceptCandidate?: boolean;
    /** Test seam for the host observation (default: the real collector). */
    collect?: EgressRun;
  },
): Promise<EgressRuntime> {
  const recordedHosts = await loadRecordedHosts(o.repoRoot);
  return {
    recordedHosts,
    // Runs before every credential release (execution.ts): the marker and its
    // authorized evidence are read and rechecked now, never trusted from startup.
    async verify() {
      const s = await collectEgressState(
        o.collect ?? realEgressCollector(o.markerPath),
      );
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
      if (s.marker?.state === "authorized") {
        let m: Record<string, unknown>;
        try {
          m = JSON.parse(await Deno.readTextFile(o.markerPath));
        } catch (err) {
          return [
            ...p,
            `egress marker ${o.markerPath} is unreadable: ${
              (err as Error).message
            }`,
          ];
        }
        p.push(
          ...(await authorizedMarkerProblems(o.repoRoot, m)).map((x) =>
            `not authorized: ${x}`
          ),
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
    p.push(...await probeEvidenceProblems(probe, m));
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
  if (cell) p.push(...await recordCellProblems(repoRoot, cell));
  return p;
}

/** The qualification evidence by content: its schema, this marker's network, a passing result. */
async function probeEvidenceProblems(
  path: string,
  m: Record<string, unknown>,
): Promise<string[]> {
  let v: unknown;
  try {
    v = JSON.parse(await Deno.readTextFile(path));
  } catch (err) {
    return [`probe evidence ${path} does not parse: ${(err as Error).message}`];
  }
  const r = ProbeEvidenceSchema.safeParse(v);
  if (!r.success) {
    return [`probe evidence ${path} is invalid: ${r.error.issues[0]?.message}`];
  }
  const e = r.data;
  const p: string[] = [];
  if (
    e.network_id !== m["network_id"] ||
    e.interface_index !== m["interface_index"]
  ) {
    p.push(`probe evidence ${path} is for another network or interface`);
  }
  if (!e.hosts.includes("api.anthropic.com")) {
    p.push(`probe evidence ${path} lacks the api.anthropic.com probe`);
  }
  const lines = e.lines.map((l) => ({
    probe: l.probe,
    ok: l.ok,
    ...(l.error ? { error: l.error } : {}),
  }));
  p.push(
    ...evaluatePreflight(lines, preflightExpect(e.hosts)).map((x) =>
      `probe evidence ${path} did not pass: ${x}`
    ),
  );
  return p;
}

/** Written beside a record-mode cell's run (execution.ts): the facts authorization checks. */
export const RECORD_MODE_FILE = "record-mode.json";
const RecordModeSchema = z.object({
  v: z.literal(1),
  execution_id: z.string().min(1),
  record_mode: z.literal(true),
  supervised: z.boolean(),
  credential_bearing: z.boolean(),
  harness: z.string(),
  termination: z.string(),
}).strict();
const NON_TERMINAL_OR_CRASH = [
  "harness_crash",
  "setup_failed",
  "usage_limited",
];

/**
 * The Step 11 cell by content: its execution record exists and ended in a
 * terminal non-crash outcome; its record-mode facts say supervised,
 * credential-bearing Claude Code; the recording names it as its source.
 */
export async function recordCellProblems(
  repoRoot: string,
  cell: string,
): Promise<string[]> {
  const cells = join(repoRoot, "results", "harness", "cells");
  const p: string[] = [];
  let record: Record<string, unknown> | null = null;
  try {
    for (const d of Deno.readDirSync(join(cells, "executions"))) {
      try {
        record = JSON.parse(
          Deno.readTextFileSync(
            join(cells, "executions", d.name, `${cell}.json`),
          ),
        );
      } catch { /* not in this campaign */ }
    }
  } catch { /* no cells */ }
  if (!record || record["id"] !== cell) {
    return [`cell ${cell}: no execution record under ${cells}`];
  }
  const termination = String(record["termination"]);
  if (NON_TERMINAL_OR_CRASH.includes(termination)) {
    p.push(
      `cell ${cell} ended ${termination}, not a terminal non-crash outcome`,
    );
  }
  let facts: unknown;
  try {
    facts = JSON.parse(
      await Deno.readTextFile(join(cells, "runs", cell, RECORD_MODE_FILE)),
    );
  } catch {
    return [
      ...p,
      `cell ${cell} has no readable ${RECORD_MODE_FILE}: not a record-mode cell`,
    ];
  }
  const r = RecordModeSchema.safeParse(facts);
  if (!r.success) {
    return [
      ...p,
      `cell ${cell} ${RECORD_MODE_FILE} is invalid: ${
        r.error.issues[0]?.message
      }`,
    ];
  }
  const f = r.data;
  if (f.execution_id !== cell) {
    p.push(`cell ${cell} ${RECORD_MODE_FILE} names ${f.execution_id}`);
  }
  if (!f.supervised) p.push(`cell ${cell} was not supervised`);
  if (!f.credential_bearing || f.harness !== "claude-code") {
    p.push(
      `cell ${cell} was not a credential-bearing Claude Code arm (${f.harness})`,
    );
  }
  if (f.termination !== termination) {
    p.push(
      `cell ${cell} ${RECORD_MODE_FILE} termination differs from its record`,
    );
  }
  try {
    const rec = JSON.parse(
      await Deno.readTextFile(
        join(repoRoot, ...RECORDED_HOSTS_PATH.split("/")),
      ),
    );
    if (rec?.source !== `record mode execution ${cell}`) {
      p.push(`${RECORDED_HOSTS_PATH} was not recorded by cell ${cell}`);
    }
  } catch { /* the recorded-hosts hash check names a missing file */ }
  return p;
}
