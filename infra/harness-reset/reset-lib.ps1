# Shared queries for reset-golden.ps1 (H-35 S3 / O-09). Dot-sourced; runs on the host and reaches the container through
# docker exec in Windows PowerShell 5.1 (Invoke-ScriptInBcContainer -useSession:$false -usePwsh:$false):
#  - the WinRM session runs as 'winrm', which cannot use the NST encryption key (CryptographicException);
#  - pwsh 7 in the container throws a DependencyInjection type-load error when Invoke-Sqlcmd is mixed with NAV cmdlets.

function Invoke-InContainer([string]$Container, [scriptblock]$ScriptBlock, $ArgumentList) {
  Invoke-ScriptInBcContainer -containerName $Container -useSession:$false -usePwsh:$false `
    -scriptblock $ScriptBlock -argumentList $ArgumentList
}

# App inventory of the single-tenant DB, sorted lines: G global apps, T tenant state, P [Published Application]
# (ID, Package ID, Runtime Package ID, version, Published As, Tenant ID, Package Hash), I [NAV App Installed App]
# (App ID, Package ID, version). Content Hash is left out: it is text-typed and reads back lossy.
function Get-GoldenInventory([string]$Container) {
  Invoke-InContainer $Container {
    $g = Get-NAVAppInfo -ServerInstance BC | ForEach-Object { "G|$($_.AppId)|$($_.Name)|$($_.Publisher)|$($_.Version)|$($_.Scope)" }
    $t = Get-NAVAppInfo -ServerInstance BC -Tenant default -TenantSpecificProperties |
      ForEach-Object { "T|$($_.AppId)|$($_.Name)|$($_.Version)|$($_.Scope)|published=$($_.IsPublished)|installed=$($_.IsInstalled)|sync=$($_.SyncState)" }
    $p = Invoke-Sqlcmd -Database CRONUS -MaxCharLength 200 -Query "SELECT CONCAT('P|', LOWER(CONVERT(varchar(36),[ID])), '|', LOWER(CONVERT(varchar(36),[Package ID])), '|', LOWER(CONVERT(varchar(36),[Runtime Package ID])), '|', [Version Major],'.',[Version Minor],'.',[Version Build],'.',[Version Revision], '|as=', [Published As], '|tenant=', [Tenant ID], '|ph=', CONVERT(varchar(200),[Package Hash])) AS r FROM [Published Application]" |
      ForEach-Object { $_.r }
    $i = Invoke-Sqlcmd -Database CRONUS -MaxCharLength 200 -Query "SELECT CONCAT('I|', LOWER(CONVERT(varchar(36),[App ID])), '|', LOWER(CONVERT(varchar(36),[Package ID])), '|', [Version Major],'.',[Version Minor],'.',[Version Build],'.',[Version Revision]) AS r FROM [NAV App Installed App]" |
      ForEach-Object { $_.r }
    @($g) + @($t) + @($p) + @($i)
  } | Sort-Object
}

# Subset fingerprint (not a content root): SHA-256 over sorted lines of users, access control, user plans, license
# hash, companies, published and installed apps with Package IDs. Same SQL as tasks\O-09\fingerprint.ps1.
function Get-GoldenFingerprint([string]$Container) {
  $lines = Invoke-InContainer $Container {
    $q = @(
      "SELECT CONCAT('U|',[User Name],'|',State,'|',[License Type]) AS r FROM [User]",
      "SELECT CONCAT('A|',u.[User Name],'|',a.[Role ID],'|',a.[Company Name],'|',a.Scope,'|',LOWER(CONVERT(varchar(36),a.[App ID]))) AS r FROM [Access Control] a JOIN [User] u ON u.[User Security ID]=a.[User Security ID]",
      "IF OBJECT_ID('[User Plan`$63ca2fa4-4f03-4f2b-a480-172fef340d3f]') IS NOT NULL SELECT CONCAT('P|',u.[User Name],'|',LOWER(CONVERT(varchar(36),p.[Plan ID]))) AS r FROM [User Plan`$63ca2fa4-4f03-4f2b-a480-172fef340d3f] p JOIN [User] u ON u.[User Security ID]=p.[User Security ID]",
      "SELECT CONCAT('L|', CASE WHEN license IS NULL THEN 'none' ELSE CONVERT(varchar(64), HASHBYTES('SHA2_256', CAST(license AS varbinary(max))), 2) END) AS r FROM [`$ndo`$dbproperty]",
      "SELECT CONCAT('C|',Name) AS r FROM [Company]",
      "SELECT CONCAT('PA|',LOWER(CONVERT(varchar(36),[ID])),'|',LOWER(CONVERT(varchar(36),[Package ID])),'|',Name,'|',[Version Major],'.',[Version Minor],'.',[Version Build],'.',[Version Revision],'|type=',[Package Type],'|as=',[Published As]) AS r FROM [Published Application]",
      "SELECT CONCAT('IA|',LOWER(CONVERT(varchar(36),[App ID])),'|',LOWER(CONVERT(varchar(36),[Package ID])),'|',[Version Major],'.',[Version Minor],'.',[Version Build],'.',[Version Revision]) AS r FROM [NAV App Installed App]"
    )
    foreach ($s in $q) { Invoke-Sqlcmd -Database CRONUS -MaxCharLength 400 -Query $s | ForEach-Object { $_.r } }
  } | Sort-Object
  $bytes = [Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))
  [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes)).Replace('-', '').ToLower()
}
