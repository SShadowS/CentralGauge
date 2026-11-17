# H-108, read-only: processes created per hook invocation, old hooks against the
# candidate. Uses the job-object TotalProcesses counter from Fable's count-procs.ps1
# (this pwsh joins a limit-free job; children inherit it). Hooks only read state;
# the fmt samples use non-.ts or missing paths, so nothing is written.
param([string]$Root = 'U:/Git/CentralGauge-wt/lane-infra', [int]$Repeat = 3)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class JobCount {
  [StructLayout(LayoutKind.Sequential)]
  public struct BASIC_ACCT {
    public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
    public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
  }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr a, string n);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr j, int cls, out BASIC_ACCT info, int len, IntPtr ret);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  static IntPtr job;
  public static void Init() {
    job = CreateJobObject(IntPtr.Zero, null);
    if (!AssignProcessToJobObject(job, GetCurrentProcess())) throw new Exception("assign failed " + Marshal.GetLastWin32Error());
  }
  public static uint Total() {
    BASIC_ACCT i; QueryInformationJobObject(job, 1, out i, Marshal.SizeOf(typeof(BASIC_ACCT)), IntPtr.Zero); return i.TotalProcesses;
  }
}
'@
[JobCount]::Init()
$env:CLAUDE_PROJECT_DIR = $Root
Set-Location $Root
$bash = 'C:\Program Files\Git\usr\bin\bash.exe'
$env:PATH = 'C:\Program Files\Git\usr\bin;C:\Program Files\Git\mingw64\bin;' + $env:PATH
$settings = Get-Content (Join-Path $Root '.claude\settings.json') -Raw | ConvertFrom-Json
$oldPre = $settings.hooks.PreToolUse[0].hooks | ForEach-Object command
$oldPost = $settings.hooks.PostToolUse[0].hooks[0].command
$cand = (Join-Path $PSScriptRoot '..\hooks') -replace '\\', '/'

# One hook = one `bash -c <command>` (Claude Code's shell form on Windows), or
# for the exec form one direct `bash.exe <script>`.
function Count($mode, $arg, $json) {
  $n = 0
  for ($i = 0; $i -lt $Repeat; $i++) {
    $b = [JobCount]::Total()
    if ($mode -eq 'shell') { $json | & $bash -c $arg 2>&1 | Out-Null }
    else { $json | & $bash $arg 2>&1 | Out-Null }
    $n += [JobCount]::Total() - $b
  }
  [Math]::Round($n / $Repeat, 1)
}

$base = Count shell 'true' '{}'
"baseline bash -c true: $base"
$samples = [ordered]@{
  'ls -la'                    = 'ls -la'
  'git status --short'        = 'git status --short'
  'grep -r foo src'           = 'grep -r foo src'
  'deno task test:unit'       = 'deno task test:unit'
  'cd site && npm run deploy' = 'cd site && npm run deploy'
  'cd site && npx vitest run' = 'cd site && npx vitest run'
}
'| Bash call | old: 4 hooks (shell form) | new: guard.sh (shell form) | new: guard.sh (exec form) |'
'| --- | --- | --- | --- |'
foreach ($k in $samples.Keys) {
  $json = (@{ tool_name = 'Bash'; tool_input = @{ command = $samples[$k]; description = 'x' } } | ConvertTo-Json -Compress)
  $old = 0; foreach ($c in $oldPre) { $old += Count shell $c $json }
  $newShell = Count shell "bash `"$cand/guard.sh`"" $json
  $newExec = Count exec "$cand/guard.sh" $json
  "| ``$k`` | $old | $newShell | $newExec |"
}
''
'| Edit call | old deno-fmt-check (shell form) | new (shell form) | new (exec form) |'
'| --- | --- | --- | --- |'
$edits = [ordered]@{
  'README.md'         = "$Root/README.md"
  'missing.ts'        = "$Root/no-such-file.ts"
}
foreach ($k in $edits.Keys) {
  $json = (@{ tool_name = 'Edit'; tool_input = @{ file_path = $edits[$k]; old_string = 'a'; new_string = 'b' } } | ConvertTo-Json -Compress)
  $old = Count shell $oldPost $json
  $newShell = Count shell "bash `"$cand/deno-fmt-check.sh`"" $json
  $newExec = Count exec "$cand/deno-fmt-check.sh" $json
  "| ``$k`` | $old | $newShell | $newExec |"
}
