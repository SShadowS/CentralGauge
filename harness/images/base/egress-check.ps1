# Egress preflight (M1-33). Shipped in the base image as C:\egress-check.ps1;
# the runner runs it inside an enforced sandbox before any credential or the
# ready file exists, and compares the lines with preflightExpect.
# Windows PowerShell 5.1. One JSON line per probe: ok is the connection
# outcome (refused or timed out is false); error is set only when the probe
# itself could not run, and is never read as blocked. Every attempt is
# bounded here: 3 s connects, 3 s receives, 3 s pings, 10 s proxy answers.
# -Allow: comma-separated proxy-allow-<host> probes (the execution's route
# hosts). -LanRouter: the host's default gateway (the runner passes it).
# A placed cell (M1-33d): the runner has written only the proxy credential
# (user:pass) to C:\cg-secrets\proxy-credential. This script reads it itself
# (never a parameter, so never in the docker exec argv), sends it as
# Proxy-Authorization: Basic on every CONNECT probe, reports each CONNECT's
# status (200, 403 or 407), and adds proxy-no-auth, one CONNECT without the
# credential that must get 407. No credential file (the credentialless
# qualification probe): no header, no proxy-no-auth. The credential never
# reaches an output line or an error message.
param(
  [string]$Allow = 'proxy-allow-api.anthropic.com',
  [string]$LanRouter = ''
)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8
$gw = '172.30.60.1'
$proxyPort = 3128
$credPath = 'C:\cg-secrets\proxy-credential'
$proxyAuth = $null
if (Test-Path -LiteralPath $credPath) {
  $cred = [IO.File]::ReadAllText($credPath, $utf8).Trim()
  if ($cred -notmatch '^[^\s:]+:\S+$') { throw 'the proxy credential file is not user:pass' }
  $proxyAuth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($cred))
  Remove-Variable cred
}

# A socket-level failure anywhere in the exception chain means the attempt was refused or dropped.
function Get-SocketFailure($e) {
  while ($null -ne $e) {
    if ($e -is [System.Net.Sockets.SocketException] -or $e -is [System.Net.NetworkInformation.PingException] -or $e -is [System.IO.IOException]) { return $e }
    $e = $e.InnerException
  }
  return $null
}

function Test-Tcp([string]$target, [int]$port) {
  $c = New-Object System.Net.Sockets.TcpClient
  try {
    $t = $c.ConnectAsync($target, $port)
    try { [void]$t.Wait(3000) } catch { if ($null -eq (Get-SocketFailure $_.Exception)) { throw } }
    if ($t.Status -eq 'RanToCompletion') { return $true }
    if ($t.IsFaulted -and $null -eq (Get-SocketFailure $t.Exception)) { throw $t.Exception.InnerException }
    return $false
  } finally { $c.Close() }
}

function Test-Udp([string]$target, [int]$port, [byte[]]$payload) {
  $u = New-Object System.Net.Sockets.UdpClient
  try {
    $u.Client.ReceiveTimeout = 3000
    $u.Connect($target, $port)
    [void]$u.Send($payload, $payload.Length)
    $from = New-Object System.Net.IPEndPoint ([System.Net.IPAddress]::Any), 0
    try { [void]$u.Receive([ref]$from); return $true }
    catch { if ($null -eq (Get-SocketFailure $_.Exception)) { throw }; return $false }
  } finally { $u.Close() }
}

function Test-Icmp([string]$target) {
  $ping = New-Object System.Net.NetworkInformation.Ping
  try {
    try { return ($ping.Send($target, 3000).Status -eq [System.Net.NetworkInformation.IPStatus]::Success) }
    catch { if ($null -eq (Get-SocketFailure $_.Exception)) { throw }; return $false }
  } finally { $ping.Dispose() }
}

# CONNECT through the proxy: its status (200 only when it dialed the target),
# with the credential unless $auth is false. An unreachable proxy or no
# status line is an error: the proxy was not tested.
function Test-Connect([string]$target, [bool]$auth = $true) {
  $c = New-Object System.Net.Sockets.TcpClient
  try {
    $t = $c.ConnectAsync($gw, $proxyPort)
    try { [void]$t.Wait(3000) } catch { }
    if ($t.Status -ne 'RanToCompletion') { throw "proxy $($gw):$proxyPort is not reachable" }
    $s = $c.GetStream()
    $s.ReadTimeout = 10000
    $s.WriteTimeout = 3000
    $h = "CONNECT $target HTTP/1.1`r`nHost: $target`r`n"
    if ($auth -and $null -ne $proxyAuth) { $h += 'Proxy-Authorization: ' + $proxyAuth + "`r`n" }
    $req = [Text.Encoding]::ASCII.GetBytes($h + "`r`n")
    Remove-Variable h
    $s.Write($req, 0, $req.Length)
    $buf = New-Object byte[] 64
    $n = $s.Read($buf, 0, 64)
    $head = [Text.Encoding]::ASCII.GetString($buf, 0, $n)
    if ($head -notmatch '^HTTP/1\.[01] (\d{3})') { throw "proxy sent no status line for $target" }
    return [int]$Matches[1]
  } finally { $c.Close() }
}

# A DNS query for example.com (A): any answer from 1.1.1.1 means DNS left the sandbox.
[byte[]]$dnsQuery = 0x12, 0x34, 0x01, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0, 7, 101, 120, 97, 109, 112, 108, 101, 3, 99, 111, 109, 0, 0, 1, 0, 1
[byte[]]$udpProbe = [Text.Encoding]::ASCII.GetBytes('cg-egress-probe')

$probes = [ordered]@{
  'direct-https' = { Test-Tcp '1.1.1.1' 443 }
  'dns-1.1.1.1' = { Test-Udp '1.1.1.1' 53 $dnsQuery }
  'lan-router' = { if ($LanRouter -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { throw 'no LAN router address passed (-LanRouter)' }; Test-Icmp $LanRouter }
  'gw-smb-445' = { Test-Tcp $gw 445 }
  'gw-rdp-3389' = { Test-Tcp $gw 3389 }
  'gw-winrm-5985' = { Test-Tcp $gw 5985 }
  'gw-winrm-47001' = { Test-Tcp $gw 47001 }
  'gw-ssh-22' = { Test-Tcp $gw 22 }
  'gw-docker-443' = { Test-Tcp $gw 443 }
  'gw-docker-3001' = { Test-Tcp $gw 3001 }
  'gw-rpc-135' = { Test-Tcp $gw 135 }
  'gw-vmms-2179' = { Test-Tcp $gw 2179 }
  'gw-udp-3202' = { Test-Udp $gw 3202 $udpProbe }
  'gw-icmp' = { Test-Icmp $gw }
  'proxy-deny-example.com' = { Test-Connect 'example.com:443' }
  'proxy-ip-literal' = { Test-Connect '1.1.1.1:443' }
  'backend-3210' = { Test-Tcp $gw 3210 }
}
if ($null -ne $proxyAuth) { $probes['proxy-no-auth'] = { Test-Connect 'example.com:443' $false } }
$allowHosts = [ordered]@{}
if ($Allow -ne 'none') {
  foreach ($name in $Allow.Split(',')) {
    if ($name -notmatch '^proxy-allow-([a-z0-9-]+(\.[a-z0-9-]+)+)$' -or $probes.Contains($name)) { throw "bad -Allow probe: $name" }
    $allowHosts[$name] = $Matches[1]
  }
}

foreach ($name in @($probes.Keys) + @($allowHosts.Keys)) {
  $line = [ordered]@{ probe = $name; ok = $false; status = $null; error = $null }
  try {
    if ($allowHosts.Contains($name)) { $r = Test-Connect "$($allowHosts[$name]):443" }
    else { $r = & $probes[$name] }
    if (@($r).Count -eq 1 -and $r -is [int]) { $line.status = $r; $r = ($r -eq 200) }
    if (@($r).Count -ne 1 -or $r -isnot [bool]) { throw "probe returned $(@($r).Count) values" }
    $line.ok = $r
  } catch {
    $line.error = [string]$_.Exception.Message
    if ([string]::IsNullOrEmpty($line.error)) { $line.error = 'probe failed without a message' }
  }
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $line -Compress))
}
