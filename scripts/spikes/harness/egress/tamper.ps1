# SPIKE (throwaway): M1-31 tamper attempts as ContainerAdministrator (container-local changes only)
$ErrorActionPreference = 'Continue'
$nic = (Get-NetAdapter | Select-Object -First 1).Name
"nic=$nic"
"fw off: " + (netsh advfirewall set allprofiles state off 2>&1 | Out-String).Trim()
"add ip 192.168.2.250: " + ((New-NetIPAddress -InterfaceAlias $nic -IPAddress 192.168.2.250 -PrefixLength 24 -ErrorAction SilentlyContinue | Out-String).Trim().Length -gt 0)
"route via 192.168.2.1: " + (route add 0.0.0.0 mask 0.0.0.0 192.168.2.1 metric 1 2>&1 | Out-String).Trim()
"dns 1.1.1.1: " + ((Set-DnsClientServerAddress -InterfaceAlias $nic -ServerAddresses 1.1.1.1 2>&1 | Out-String).Trim())
"hns inside: " + ((Get-Command Get-HnsEndpoint -ErrorAction SilentlyContinue) -ne $null)
