# SPIKE (throwaway): M1-27 step 4, in-container state of the foreign 'CGR Leasing' app and its data
$m = Get-ChildItem 'C:\Program Files\Microsoft Dynamics NAV\*\Service\*.psm1','C:\Program Files\Microsoft Dynamics NAV\*\Service\*.psd1' -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*Apps.Management*' -or $_.Name -like 'Microsoft.Dynamics.Nav.Management.*' }
$m | ForEach-Object { Import-Module $_.FullName -WarningAction SilentlyContinue -ErrorAction SilentlyContinue }
"apps named CGR Leasing: " + ((@(Get-NAVAppInfo -ServerInstance BC -Tenant default -TenantSpecificProperties -Name 'CGR Leasing') | ForEach-Object { $_.Publisher + '/' + $_.AppId + '@' + $_.Version + ' installed=' + $_.IsInstalled }) -join '; ')
# Tenant data lives in the 'default' tenant database (multitenant container).
$tables = @(Invoke-Sqlcmd -ServerInstance 'localhost\SQLEXPRESS' -Database default -Query "SELECT name FROM sys.tables WHERE name LIKE '%FP Row%f0e1d2c3%'")
if ($tables.Count -eq 0) { "FP Row data tables: none" }
foreach ($t in $tables) {
  $n = (Invoke-Sqlcmd -ServerInstance 'localhost\SQLEXPRESS' -Database default -Query ("SELECT COUNT(*) AS c FROM [" + $t.name + "]")).c
  "FP Row data table: " + $t.name + " rows=" + $n
}
