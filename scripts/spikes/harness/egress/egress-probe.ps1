# SPIKE (throwaway): harness bench M1-31 egress feasibility
# Runs INSIDE a sandbox container. One line per check: <name> OK|BLOCKED <detail>.
# OK means the request reached its target (any HTTP status counts as reached).
param([Parameter(Mandatory)][string]$Gateway, [string]$LanIp = '', [int]$TimeoutSec = 8)
$ProgressPreference = 'SilentlyContinue'

function Try-Http([string]$Name, [string]$Url, [string]$Proxy = '') {
    try {
        $p = @{ Uri = $Url; TimeoutSec = $TimeoutSec; UseBasicParsing = $true }
        if ($Proxy) { $p.Proxy = $Proxy }
        $r = Invoke-WebRequest @p
        "$Name OK status=$($r.StatusCode)"
    } catch {
        $resp = $_.Exception.Response
        if ($resp) { "$Name OK status=$([int]$resp.StatusCode)" }
        else { "$Name BLOCKED $($_.Exception.Message -replace '\s+', ' ')" }
    }
}

function Try-Tcp([string]$Name, [string]$Ip, [int]$Port) {
    $c = New-Object Net.Sockets.TcpClient
    try {
        $t = $c.ConnectAsync($Ip, $Port)
        if ($t.Wait($TimeoutSec * 1000) -and $c.Connected) { "$Name OK tcp $Ip`:$Port" }
        else { "$Name BLOCKED tcp $Ip`:$Port timeout" }
    } catch { "$Name BLOCKED tcp $Ip`:$Port $($_.Exception.InnerException.Message)" }
    finally { $c.Close() }
}

function Try-Dns([string]$Name, [string]$Server) {
    try {
        $r = Resolve-DnsName -Name example.com -Server $Server -DnsOnly -QuickTimeout -ErrorAction Stop
        "$Name OK $(@($r | Where-Object { $_.IPAddress })[0].IPAddress)"
    } catch { "$Name BLOCKED $($_.Exception.Message -replace '\s+', ' ')" }
}

"whoami=$(whoami) ip=$((Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' }).IPAddress -join ',')"
Try-Http 'direct-https-example' 'https://example.com/'
Try-Http 'direct-https-openrouter' 'https://openrouter.ai/api/v1/models'
Try-Tcp  'direct-tcp-anthropic-ip' '160.79.104.10' 443
Try-Dns  'dns-external-1.1.1.1' '1.1.1.1'
Try-Dns  'dns-gateway' $Gateway
if ($LanIp) { Try-Tcp 'lan-host-3128' $LanIp 3128 }
Try-Tcp  'lan-router-80' '192.168.2.1' 80
Try-Http 'backend-3200' "http://$Gateway`:3200/"
Try-Http 'host-other-port-3201' "http://$Gateway`:3201/"
Try-Http 'proxy-anthropic' 'https://api.anthropic.com/v1/models' "http://$Gateway`:3128"
Try-Http 'proxy-openrouter' 'https://openrouter.ai/api/v1/models' "http://$Gateway`:3128"
Try-Http 'proxy-example-denied' 'https://example.com/' "http://$Gateway`:3128"
