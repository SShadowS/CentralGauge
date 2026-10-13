import { assert, assertEquals, assertStringIncludes } from "@std/assert";
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
  } elseif ($Op -eq 'get') {
    Get-Pinned (Get-Content -LiteralPath $Arg1 -Raw | ConvertFrom-Json) $Arg2
  } elseif ($Op -eq 'get2s') {
    Get-Pinned (Get-Content -LiteralPath $Arg1 -Raw | ConvertFrom-Json) $Arg2 2
  } elseif ($Op -eq 'args') {
    $a = Get-Content -LiteralPath $Arg1 -Raw | ConvertFrom-Json
    Assert-ReleaseArgs $a.source $a.release $a.url $a.sha256
  } elseif ($Op -eq 'wrapper') {
    $h = Install-WrapperZip $Arg1 @('al-call-hierarchy.exe', 'al-lsp-wrapper.exe') $Arg2
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $h -Compress))
  } elseif ($Op -eq 'depsrc') {
    $def = Get-Content -LiteralPath $Arg1 -Raw | ConvertFrom-Json
    Set-DependencySource $def
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $def.lsp_json.al.env -Compress))
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

// Fail with a clear message if antivirus quarantined a fixture (a vanished file otherwise
// surfaces as a confusing hash mismatch or missing-executable error).
async function assertPresent(...paths: string[]) {
  for (const p of paths) {
    try {
      await Deno.stat(p);
    } catch {
      throw new Error(`fixture ${p} vanished (antivirus quarantine?)`);
    }
  }
}

// Plainly textual content so ML scanners do not mistake the .exe-named fixtures for stub binaries.
const FIXTURE_A = "CentralGauge test fixture a: not an executable\n";
const FIXTURE_B = "CentralGauge test fixture b: not an executable\n";

async function tree(t: string) {
  const root = join(t, "lsp");
  await Deno.mkdir(join(root, "bin"), { recursive: true });
  const a = new TextEncoder().encode(FIXTURE_A);
  const b = new TextEncoder().encode(FIXTURE_B);
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
      const aExe = join(root, "bin", "a.exe");
      await assertPresent(aExe, join(root, "b.exe"), manifest);
      const ok = await run("exes", root, manifest);
      assertEquals([ok.code, ok.out.trim()], [0, "OK"]);

      await Deno.writeTextFile(aExe, "CentralGauge test fixture a: tampered\n");
      await assertPresent(aExe);
      const bad = await run("exes", root, manifest);
      assertEquals(bad.code, 3);
      assertStringIncludes(bad.out, "hash mismatch for bin\\a.exe");
      await Deno.writeTextFile(aExe, FIXTURE_A);

      await Deno.mkdir(join(root, "deep", "er"), { recursive: true });
      const evil = join(root, "deep", "er", "evil.EXE");
      await Deno.writeTextFile(
        evil,
        "CentralGauge test fixture: extra, not an executable\n",
      );
      await assertPresent(aExe, join(root, "b.exe"), evil);
      const extra = await run("exes", root, manifest);
      assertEquals(extra.code, 3);
      assertStringIncludes(
        extra.out,
        "unexpected executable: deep\\er\\evil.exe",
      );
      await Deno.remove(join(root, "deep"), { recursive: true });

      await Deno.remove(join(root, "b.exe"));
      await assertPresent(aExe, manifest);
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
        await assertPresent(p);
        return p;
      };
      // Assert-ZipSafe checks entry names only, so no entry needs an .exe name.
      const clean = await mk("clean.zip", "dir/ok.bin|dir/sub/readme.txt");
      assertEquals((await run("zip", clean, "")).code, 0);
      for (
        const [n, entry] of [
          ["dots", "..\\evil.bin"],
          ["dots-mid", "a/../../evil.bin"],
          ["abs", "/abs.bin"],
          ["drive", "C:\\evil.bin"],
          ["ads", "dir/file.txt:stream"],
        ]
      ) {
        const z = await mk(`${n}.zip`, `dir/ok.bin|${entry}`);
        const r = await run("zip", z, "");
        assertEquals(r.code, 3, `${n}: ${r.out}`);
        assertStringIncludes(r.out, "unsafe archive entry");
      }
    });
  },
});

// M10-08a: the VS Marketplace answers the AL vsix with Content-Encoding: gzip, and the pin
// is the hash of that raw gzip body. Get-Pinned must save the bytes on the wire, not a
// transport-decoded body: the raw pin is accepted, the decoded body's hash is refused.
Deno.test({
  name:
    "install-lsp.ps1 (PS 5.1): Get-Pinned saves the raw Content-Encoding: gzip body and checks the pin against it, not the decoded body",
  ignore: !WIN,
  async fn() {
    const plain = new TextEncoder().encode(
      "CentralGauge test fixture: gzip-on-the-wire body\n".repeat(64),
    );
    const gz = new Uint8Array(
      await new Response(
        new Blob([plain]).stream().pipeThrough(new CompressionStream("gzip")),
      ).arrayBuffer(),
    );
    const server = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen() {} },
      () =>
        new Response(gz, {
          headers: {
            "content-type": "application/octet-stream",
            "content-encoding": "gzip",
          },
        }),
    );
    try {
      const url = `http://127.0.0.1:${server.addr.port}/al.vsix`;
      await withTemp(async (t, run) => {
        const pin = async (name: string, hash: string) => {
          const p = join(t, name);
          await Deno.writeTextFile(
            p,
            JSON.stringify({ url, algorithm: "SHA256", hash }),
          );
          return p;
        };
        const out = join(t, "raw.vsix");
        const ok = await run("get", await pin("raw.json", await sha(gz)), out);
        assertEquals([ok.code, ok.out.trim()], [0, "OK"]);
        assertEquals(await Deno.readFile(out), gz);

        const bad = await run(
          "get",
          await pin("decoded.json", await sha(plain)),
          join(t, "decoded.vsix"),
        );
        assertEquals(bad.code, 3, bad.out);
        assertStringIncludes(bad.out, "hash mismatch for " + url);
      });
    } finally {
      await server.shutdown();
    }
  },
});

// M10-10: the wrapper release `images build` resolved reaches install-lsp.ps1 as three build args.
const RECIPE = JSON.parse(
  await Deno.readTextFile("harness/images/claude-code/lsp/al-lsp.json"),
);
const REL = {
  release: "v1.18.8",
  url:
    "https://github.com/SShadowS/al-lsp-for-agents/releases/download/v1.18.8/al-lsp-wrapper-windows-x64.zip",
  sha256: "142418c8cc5b75b703e647a6a7c4fc4b52f0969d71470fe052199c64d5079bf1",
};

Deno.test({
  name:
    "install-lsp.ps1 (PS 5.1, M10-10): Assert-ReleaseArgs accepts the exact resolved release and refuses any malformed tag, digest, URL or recipe source",
  ignore: !WIN,
  async fn() {
    await withTemp(async (t, run) => {
      const check = async (name: string, over: Record<string, unknown>) => {
        const p = join(t, `${name}.json`);
        await Deno.writeTextFile(
          p,
          JSON.stringify({ source: RECIPE.source, ...REL, ...over }),
        );
        return await run("args", p, "");
      };
      const ok = await check("ok", {});
      assertEquals([ok.code, ok.out.trim()], [0, "OK"]);
      const src = RECIPE.source;
      const bad: [string, Record<string, unknown>, string][] = [
        ["no-tag", { release: "" }, "release tag"],
        ["short-tag", { release: "v1.18" }, "release tag"],
        ["no-v", { release: "1.18.8" }, "release tag"],
        ["rc", { release: "v1.18.8-rc1" }, "release tag"],
        ["nl", { release: "v1.18.8\n" }, "release tag"],
        ["no-sha", { sha256: "" }, "sha256"],
        ["upper", { sha256: REL.sha256.toUpperCase() }, "sha256"],
        ["sha-63", { sha256: REL.sha256.slice(1) }, "sha256"],
        ["prefixed", { sha256: `sha256:${REL.sha256}` }, "sha256"],
        ["no-url", { url: "" }, "URL"],
        ["http", { url: REL.url.replace("https:", "http:") }, "URL"],
        ["repo", { url: REL.url.replace("SShadowS", "evil") }, "URL"],
        ["tag", { url: REL.url.replace("/v1.18.8/", "/v1.18.7/") }, "URL"],
        ["asset", { url: REL.url.replace("windows", "linux") }, "URL"],
        ["query", { url: REL.url + "?x=1" }, "URL"],
        ["src-repo", { source: { ...src, repo: "evil/al-lsp" } }, "repo"],
        [
          "src-exes",
          { source: { ...src, exes: [...src.exes, "evil.exe"] } },
          "exes",
        ],
        [
          "src-mode",
          { source: { ...src, dependency_source: "fast" } },
          "dependency_source",
        ],
      ];
      for (const [name, over, msg] of bad) {
        const r = await check(name, over);
        assertEquals(r.code, 3, `${name}: ${r.out}`);
        assertStringIncludes(r.out, "REFUSED", name);
        assertStringIncludes(r.out, msg, name);
      }
    });
  },
});

Deno.test({
  name:
    "install-lsp.ps1 (PS 5.1, M10-10): a digest mismatch refuses and leaves no file behind; a match is promoted to the target",
  ignore: !WIN,
  async fn() {
    const body = new TextEncoder().encode(
      "CentralGauge test fixture: release asset body\n".repeat(32),
    );
    const server = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen() {} },
      () => new Response(body),
    );
    try {
      const url = `http://127.0.0.1:${server.addr.port}/wrapper.zip`;
      await withTemp(async (t, run) => {
        const pin = join(t, "pin.json");
        const out = join(t, "wrapper.zip");
        await Deno.writeTextFile(
          pin,
          JSON.stringify({ url, algorithm: "SHA256", hash: "e".repeat(64) }),
        );
        const bad = await run("get", pin, out);
        assertEquals(bad.code, 3, bad.out);
        assertStringIncludes(bad.out, "hash mismatch for " + url);
        assertEquals(
          [...Deno.readDirSync(t)].map((e) => e.name).sort(),
          ["pin.json", "runner.ps1"],
          "neither the target nor a partial download remains",
        );
        await Deno.writeTextFile(
          pin,
          JSON.stringify({ url, algorithm: "SHA256", hash: await sha(body) }),
        );
        const ok = await run("get", pin, out);
        assertEquals([ok.code, ok.out.trim()], [0, "OK"]);
        assertEquals(await Deno.readFile(out), body);
        assertEquals(
          [...Deno.readDirSync(t)].map((e) => e.name).sort(),
          ["pin.json", "runner.ps1", "wrapper.zip"],
        );
      });
    } finally {
      await server.shutdown();
    }
  },
});

Deno.test({
  name:
    "install-lsp.ps1 (PS 5.1, M10-08a minor): a body that stalls after the headers hits the transfer deadline and leaves no file",
  ignore: !WIN,
  async fn() {
    let release = () => {};
    const done = new Promise<void>((r) => release = r);
    const server = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen() {} },
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            async start(c) {
              c.enqueue(new TextEncoder().encode("partial body\n"));
              await done;
              c.close();
            },
          }),
        ),
    );
    try {
      const url = `http://127.0.0.1:${server.addr.port}/stall.zip`;
      await withTemp(async (t, run) => {
        const pin = join(t, "pin.json");
        await Deno.writeTextFile(
          pin,
          JSON.stringify({ url, algorithm: "SHA256", hash: "e".repeat(64) }),
        );
        const started = Date.now();
        const r = await run("get2s", pin, join(t, "stall.zip"));
        assertEquals(r.code, 3, r.out);
        assertStringIncludes(r.out, "timed out");
        assert(Date.now() - started < 60_000, "bounded by the deadline");
        assertEquals(
          [...Deno.readDirSync(t)].map((e) => e.name).sort(),
          ["pin.json", "runner.ps1"],
        );
      });
    } finally {
      release();
      await server.shutdown();
    }
  },
});

Deno.test({
  name:
    "install-lsp.ps1 (PS 5.1, M10-10): Install-WrapperZip takes exactly the two recipe exes from the one zip and refuses a missing, doubled or unsafe entry",
  ignore: !WIN,
  async fn() {
    await withTemp(async (t, run) => {
      const mk = async (name: string, entries: string) => {
        const p = join(t, name);
        const r = await run("mkzip", p, entries);
        assertEquals([r.code, r.out.trim()], [0, "OK"]);
        await assertPresent(p);
        return p;
      };
      const bin = async (name: string) => {
        const b = join(t, `bin-${name}`);
        await Deno.mkdir(b);
        return b;
      };
      const x = await sha(new TextEncoder().encode("x"));
      const okBin = await bin("ok");
      const ok = await run(
        "wrapper",
        await mk(
          "ok.zip",
          "pkg/bin/al-call-hierarchy.exe|pkg/bin/al-lsp-wrapper.exe|pkg/bin/other.exe|pkg/README.md",
        ),
        okBin,
      );
      assertEquals(ok.code, 0, ok.out);
      assertEquals(JSON.parse(ok.out.trim().split(/\r?\n/)[0]!), {
        "al-call-hierarchy.exe": x,
        "al-lsp-wrapper.exe": x,
      });
      assertEquals([...Deno.readDirSync(okBin)].map((e) => e.name).sort(), [
        "al-call-hierarchy.exe",
        "al-lsp-wrapper.exe",
      ]);
      for (
        const [name, entries, msg] of [
          [
            "missing",
            "pkg/al-lsp-wrapper.exe",
            "exactly one al-call-hierarchy.exe",
          ],
          [
            "doubled",
            "a/al-call-hierarchy.exe|b/al-call-hierarchy.exe|a/al-lsp-wrapper.exe",
            "exactly one al-call-hierarchy.exe",
          ],
          [
            "unsafe",
            "al-call-hierarchy.exe|al-lsp-wrapper.exe|../evil.bin",
            "unsafe archive entry",
          ],
        ]
      ) {
        const r = await run(
          "wrapper",
          await mk(`${name}.zip`, entries!),
          await bin(name!),
        );
        assertEquals(r.code, 3, `${name}: ${r.out}`);
        assertStringIncludes(r.out, msg!, name);
      }
    });
  },
});

Deno.test({
  name:
    "install-lsp.ps1 (PS 5.1, M10-10): AL_SEM_DEPENDENCY_SOURCE stays unset for embedded, is set for symbols, and an unknown mode or a hand-set variable is refused",
  ignore: !WIN,
  async fn() {
    await withTemp(async (t, run) => {
      const env = async (name: string, def: unknown) => {
        const p = join(t, `${name}.json`);
        await Deno.writeTextFile(p, JSON.stringify(def));
        return await run("depsrc", p, "");
      };
      const at = (mode: string, extra: Record<string, string> = {}) => ({
        ...RECIPE,
        source: { ...RECIPE.source, dependency_source: mode },
        lsp_json: {
          al: {
            ...RECIPE.lsp_json.al,
            env: { ...RECIPE.lsp_json.al.env, ...extra },
          },
        },
      });
      const embedded = await env("embedded", RECIPE);
      assertEquals(embedded.code, 0, embedded.out);
      assertEquals(
        JSON.parse(embedded.out.trim().split(/\r?\n/)[0]!),
        RECIPE.lsp_json.al.env,
      );
      const symbols = await env("symbols", at("symbols"));
      assertEquals(symbols.code, 0, symbols.out);
      assertEquals(JSON.parse(symbols.out.trim().split(/\r?\n/)[0]!), {
        ...RECIPE.lsp_json.al.env,
        AL_SEM_DEPENDENCY_SOURCE: "symbols",
      });
      const fast = await env("fast", at("fast"));
      assertEquals(fast.code, 3, fast.out);
      assertStringIncludes(fast.out, "dependency_source");
      const hand = await env(
        "hand",
        at("embedded", { AL_SEM_DEPENDENCY_SOURCE: "symbols" }),
      );
      assertEquals(hand.code, 3, hand.out);
      assertStringIncludes(hand.out, "AL_SEM_DEPENDENCY_SOURCE");
    });
  },
});
