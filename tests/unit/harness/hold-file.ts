/**
 * Holds a file open with no sharing, as the host holds a live bind mount, so
 * removing its directory fails with os error 32 (M5-08a). Deno's own handles
 * allow delete, so a PowerShell child holds it. Windows only.
 */
export async function holdExclusive(
  path: string,
): Promise<() => Promise<void>> {
  const child = new Deno.Command("powershell", {
    args: [
      "-NoProfile",
      "-Command",
      `$f = [IO.File]::Open('${
        path.replaceAll("'", "''")
      }', 'Open', 'Read', 'None'); [Console]::Out.WriteLine('held'); [Console]::Out.Flush(); [void][Console]::In.ReadLine(); $f.Close()`,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "null",
  }).spawn();
  const reader = child.stdout.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  if (!first.includes("held")) throw new Error(`could not hold ${path}`);
  return async () => {
    const w = child.stdin.getWriter();
    await w.write(new TextEncoder().encode("\n"));
    await w.close();
    reader.releaseLock();
    await child.stdout.cancel();
    await child.status;
  };
}
