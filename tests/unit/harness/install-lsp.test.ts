import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

// Windows PowerShell 5.1 behaviour of install-lsp.ps1's check functions on temp fixtures.
// The script is dot-sourced with -LibOnly, so the install itself never runs.
const SCRIPT = join(
  Deno.cwd(),
  "harness/images/claude-code/lsp/install-lsp.ps1",
);
const WIN = Deno.build.os === "windows";

const ps = async (file: string, args: string[]) => {
  const o = await new Deno.Command("powershell.exe", {
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      file,
      ...args,
    ],
    // A PowerShell 7 PSModulePath inherited from the parent hides 5.1's own modules.
    env: {
      PSModulePath: `${
        Deno.env.get("SystemRoot") ?? "C:\\Windows"
      }\\System32\\WindowsPowerShell\\v1.0\\Modules`,
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const d = new TextDecoder();
  return { code: o.code, out: d.decode(o.stdout) + d.decode(o.stderr) };
};

const RUNNER = `param([string]$Op, [string]$Arg1, [string]$Arg2)
$ErrorActionPreference = 'Stop'
. '${SCRIPT}' -LibOnly
try {
  if ($Op -eq 'exes') {
    Assert-ExeManifest $Arg1 (Get-Content -LiteralPath $Arg2 -Raw | ConvertFrom-Json)
  } elseif ($Op -eq 'zip') {
    Assert-ZipSafe $Arg1
  } elseif ($Op -eq 'mkzip') {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z = [IO.Compression.ZipFile]::Open($Arg1, 'Create')
    foreach ($n in ($Arg2 -split '\\|')) {
      $e = $z.CreateEntry($n)
      $w = New-Object IO.StreamWriter($e.Open())
      $w.Write('x')
      $w.Close()
    }
    $z.Dispose()
  }
  [Console]::Out.WriteLine('OK')
} catch {
  [Console]::Out.WriteLine('REFUSED: ' + $_.Exception.Message)
  exit 3
}
`;

const sha = async (b: Uint8Array<ArrayBuffer>) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b)))
    .map((x) => x.toString(16).padStart(2, "0")).join("");

async function withTemp(
  fn: (
    t: string,
    run: (op: string, a1: string, a2: string) => ReturnType<typeof ps>,
  ) => Promise<void>,
) {
  const base = Deno.env.get("TEMP") ?? Deno.makeTempDirSync();
  const t = await Deno.makeTempDir({ dir: base, prefix: "installlsp-" });
  try {
    const runner = join(t, "runner.ps1");
    await Deno.writeTextFile(runner, RUNNER);
    await fn(t, (op, a1, a2) => ps(runner, [op, a1, a2]));
  } finally {
    await Deno.remove(t, { recursive: true });
  }
}

async function tree(t: string) {
  const root = join(t, "lsp");
  await Deno.mkdir(join(root, "bin"), { recursive: true });
  const a = new TextEncoder().encode("exe-a");
  const b = new TextEncoder().encode("exe-b");
  await Deno.writeFile(join(root, "bin", "a.exe"), a);
  await Deno.writeFile(join(root, "b.exe"), b);
  await Deno.writeTextFile(join(root, "x.dll"), "dlls are not in the manifest");
  const manifest = join(t, "manifest.json");
  await Deno.writeTextFile(
    manifest,
    JSON.stringify({ "bin\\a.exe": await sha(a), "b.exe": await sha(b) }),
  );
  return { root, manifest };
}

Deno.test({
  name:
    "install-lsp.ps1 (PS 5.1): the exe manifest accepts the exact set and refuses tampered, extra and missing executables",
  ignore: !WIN,
  async fn() {
    await withTemp(async (t, run) => {
      const { root, manifest } = await tree(t);
      const ok = await run("exes", root, manifest);
      assertEquals([ok.code, ok.out.trim()], [0, "OK"]);

      await Deno.writeTextFile(join(root, "bin", "a.exe"), "tampered");
      const bad = await run("exes", root, manifest);
      assertEquals(bad.code, 3);
      assertStringIncludes(bad.out, "hash mismatch for bin\\a.exe");
      await Deno.writeTextFile(join(root, "bin", "a.exe"), "exe-a");

      await Deno.mkdir(join(root, "deep", "er"), { recursive: true });
      await Deno.writeTextFile(join(root, "deep", "er", "evil.EXE"), "x");
      const extra = await run("exes", root, manifest);
      assertEquals(extra.code, 3);
      assertStringIncludes(
        extra.out,
        "unexpected executable: deep\\er\\evil.exe",
      );
      await Deno.remove(join(root, "deep"), { recursive: true });

      await Deno.remove(join(root, "b.exe"));
      const gone = await run("exes", root, manifest);
      assertEquals(gone.code, 3);
      assertStringIncludes(gone.out, "missing executable: b.exe");
    });
  },
});

Deno.test({
  name:
    "install-lsp.ps1 (PS 5.1): a zip with a traversal, absolute or drive-qualified entry is refused before extraction; a clean zip passes",
  ignore: !WIN,
  async fn() {
    await withTemp(async (t, run) => {
      const mk = async (name: string, entries: string) => {
        const p = join(t, name);
        const r = await run("mkzip", p, entries);
        assertEquals([r.code, r.out.trim()], [0, "OK"]);
        return p;
      };
      const clean = await mk("clean.zip", "dir/ok.exe|dir/sub/readme.txt");
      assertEquals((await run("zip", clean, "")).code, 0);
      for (
        const [n, entry] of [
          ["dots", "..\\evil.exe"],
          ["dots-mid", "a/../../evil.exe"],
          ["abs", "/abs.exe"],
          ["drive", "C:\\evil.exe"],
          ["ads", "dir/file.txt:stream"],
        ]
      ) {
        const z = await mk(`${n}.zip`, `dir/ok.exe|${entry}`);
        const r = await run("zip", z, "");
        assertEquals(r.code, 3, `${n}: ${r.out}`);
        assertStringIncludes(r.out, "unsafe archive entry");
      }
    });
  },
});
