# H-35 S3 content root (design-r5 Sol HIGH: "canonical cryptographic content roots covering complete values/LOBs").
# Dot-sourced after reset-lib.ps1. Every user table of CRONUS is hashed server-side:
#   row hash   = SHA-256 of the row as FOR XML RAW with BINARY BASE64 (every column, LOBs included; NULL = absent attr)
#   table hash = SHA-256 of the row hashes' hex, sorted (a multiset: independent of physical order and keys)
#   root       = SHA-256 of sorted "table|hash" lines, minus the lineage's justified volatile exclusions
# A table that cannot be hashed is an error row, never skipped: the caller fails on any err.

$ContentRootSql = @'
SET NOCOUNT ON;
DECLARE @r TABLE (t sysname, n bigint NULL, h varchar(64) NULL, ms int, err nvarchar(400) NULL);
DECLARE @name sysname, @sql nvarchar(max), @n bigint, @h varchar(64), @t0 datetime2;
DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM sys.tables WHERE is_ms_shipped = 0 ORDER BY name;
OPEN c; FETCH NEXT FROM c INTO @name;
WHILE @@FETCH_STATUS = 0 BEGIN
  SET @t0 = SYSUTCDATETIME(); SET @n = NULL; SET @h = NULL;
  SET @sql = N'SELECT @n = COUNT_BIG(*), @h = CONVERT(varchar(64), HASHBYTES(''SHA2_256'', STRING_AGG(CONVERT(varchar(max), CONVERT(varchar(64), rh, 2)), '''') WITHIN GROUP (ORDER BY rh)), 2) FROM (SELECT HASHBYTES(''SHA2_256'', CONVERT(nvarchar(max), (SELECT t.* FOR XML RAW(''r''), BINARY BASE64))) AS rh FROM ' + QUOTENAME(@name) + N' t) x';
  BEGIN TRY
    EXEC sp_executesql @sql, N'@n bigint OUTPUT, @h varchar(64) OUTPUT', @n OUTPUT, @h OUTPUT;
    INSERT @r VALUES (@name, @n, ISNULL(@h, 'empty'), DATEDIFF(ms, @t0, SYSUTCDATETIME()), NULL);
  END TRY BEGIN CATCH
    INSERT @r VALUES (@name, NULL, NULL, DATEDIFF(ms, @t0, SYSUTCDATETIME()), ERROR_MESSAGE());
  END CATCH
  FETCH NEXT FROM c INTO @name;
END
CLOSE c; DEALLOCATE c;
SELECT t, n, h, ms, err FROM @r ORDER BY t;
'@

# Per-table rows: t (table), n (row count), h (hash hex or 'empty'), ms, err.
function Get-GoldenContentTables([string]$Container) {
  Invoke-InContainer $Container { param($q)
    Invoke-Sqlcmd -Database CRONUS -QueryTimeout 0 -MaxCharLength 4000 -Query $q |
      ForEach-Object { [pscustomobject]@{ t = $_.t; n = $_.n; h = $_.h; ms = $_.ms; err = $_.err } }
  } $ContentRootSql
}

# Root over the tables not matched by any -Exclude wildcard pattern. Throws if a table could not be hashed.
function Get-GoldenContentRoot($Tables, [string[]]$Exclude = @()) {
  $bad = @($Tables | Where-Object { $_.err -and "$($_.err)" -ne '' })
  if ($bad) { throw "content root: $($bad.Count) table(s) not hashed, first $($bad[0].t): $($bad[0].err)" }
  $lines = $Tables | Where-Object { $t = $_.t; -not ($Exclude | Where-Object { $t -like $_ }) } |
    ForEach-Object { "$($_.t)|$($_.h)" } | Sort-Object -CaseSensitive
  $bytes = [Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))
  [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes)).Replace('-', '').ToLower()
}
