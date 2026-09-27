# H-01: the agent never runs as an administrator (an admin sandbox could
# change its own IP). Every agent entrypoint runs this first, before any
# config, secret or ready read; the runner maps exit 86 plus this line to
# setup_failed. CG_NONADMIN_FORCE_ADMIN=1 only forces a refusal (host tests);
# nothing can skip one. Any error here fails closed in the caller.
$ErrorActionPreference = 'Stop'
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$admin = ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) -or
  ($id.Name -match '(^|\\)ContainerAdministrator$') -or
  ($env:CG_NONADMIN_FORCE_ADMIN -eq '1')
if ($admin) {
  [Console]::Error.WriteLine("cg-harness: refusing to run the agent as an administrator ($($id.Name))")
  exit 86
}
exit 0
