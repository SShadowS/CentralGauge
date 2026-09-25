# SPIKE (throwaway): harness bench M1-31 egress feasibility
# Host side, ELEVATED. Adds or queries HCN endpoint ACL policies on one container endpoint.
# Usage:
#   hcn-acl.ps1 -Action query -EndpointId <guid>
#   hcn-acl.ps1 -Action apply -EndpointId <guid> -Gateway 172.30.50.1 -ProxyPort 3128 -BackendPort 3200
# apply adds: allow TCP out to Gateway:ProxyPort and Gateway:BackendPort (priority 100/101),
# block everything else out (priority 1000). Policies die with the endpoint (docker rm).
param(
    [Parameter(Mandatory)][ValidateSet('query', 'apply')][string]$Action,
    [Parameter(Mandatory)][string]$EndpointId,
    [string]$Gateway = '', [int]$ProxyPort = 3128, [int]$BackendPort = 3200
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Hcn {
    [DllImport("computenetwork.dll", CharSet = CharSet.Unicode)]
    public static extern int HcnOpenEndpoint(ref Guid id, out IntPtr endpoint, out IntPtr errorRecord);
    [DllImport("computenetwork.dll", CharSet = CharSet.Unicode)]
    public static extern int HcnModifyEndpoint(IntPtr endpoint, string settings, out IntPtr errorRecord);
    [DllImport("computenetwork.dll", CharSet = CharSet.Unicode)]
    public static extern int HcnQueryEndpointProperties(IntPtr endpoint, string query, out IntPtr properties, out IntPtr errorRecord);
    [DllImport("computenetwork.dll")]
    public static extern int HcnCloseEndpoint(IntPtr endpoint);
    public static string Str(IntPtr p) { return p == IntPtr.Zero ? "" : Marshal.PtrToStringUni(p); }
}
'@

function Check([int]$hr, [IntPtr]$err, [string]$what) {
    if ($hr -ne 0) { throw ("{0} failed hr=0x{1:X8} {2}" -f $what, $hr, [Hcn]::Str($err)) }
}

$id = [Guid]$EndpointId
$ep = [IntPtr]::Zero; $err = [IntPtr]::Zero
Check ([Hcn]::HcnOpenEndpoint([ref]$id, [ref]$ep, [ref]$err)) $err 'HcnOpenEndpoint'
try {
    if ($Action -eq 'apply') {
        if (-not $Gateway) { throw '-Gateway is required for apply' }
        $rules = @(
            @{ Type = 'ACL'; Settings = @{ Protocols = '6'; Action = 'Allow'; Direction = 'Out'; RemoteAddresses = $Gateway; RemotePorts = "$ProxyPort"; RuleType = 'Switch'; Priority = 100 } },
            @{ Type = 'ACL'; Settings = @{ Protocols = '6'; Action = 'Allow'; Direction = 'Out'; RemoteAddresses = $Gateway; RemotePorts = "$BackendPort"; RuleType = 'Switch'; Priority = 101 } },
            @{ Type = 'ACL'; Settings = @{ Action = 'Block'; Direction = 'Out'; RuleType = 'Switch'; Priority = 1000 } }
        )
        $req = @{ ResourceType = 'Policy'; RequestType = 'Add'; Settings = @{ Policies = $rules } } | ConvertTo-Json -Depth 8 -Compress
        "REQUEST $req"
        Check ([Hcn]::HcnModifyEndpoint($ep, $req, [ref]$err)) $err 'HcnModifyEndpoint'
        'APPLIED'
    }
    $props = [IntPtr]::Zero
    Check ([Hcn]::HcnQueryEndpointProperties($ep, '{"SchemaVersion":{"Major":2,"Minor":0}}', [ref]$props, [ref]$err)) $err 'HcnQueryEndpointProperties'
    $o = [Hcn]::Str($props) | ConvertFrom-Json
    "ENDPOINT $($o.ID) $($o.Name) ip=$(($o.IpConfigurations | ForEach-Object IpAddress) -join ',')"
    'POLICIES ' + (($o.Policies | Where-Object Type -eq 'ACL' | ForEach-Object { $_.Settings | ConvertTo-Json -Compress }) -join ' ')
    'ACL_COUNT ' + @($o.Policies | Where-Object Type -eq 'ACL').Count
} finally { [void][Hcn]::HcnCloseEndpoint($ep) }
