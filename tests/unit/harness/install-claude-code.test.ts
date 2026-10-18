import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { testTempDir } from "../../utils/temp-dir.ts";

// H-03: Windows PowerShell 5.1 behaviour of install-claude-code.ps1's functions on temp
// fixtures. The script is dot-sourced with -LibOnly, so the image install itself never runs;
// npm is a fake .cmd, tar is the real %SystemRoot%\System32\tar.exe on local archives.
const SCRIPT = join(
  Deno.cwd(),
  "harness/images/claude-code/install-claude-code.ps1",
);
const WIN = Deno.build.os === "windows";
const TAR = `${Deno.env.get("SystemRoot") ?? "C:\\Windows"}\\System32\\tar.exe`;
const V = "2.1.296";

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
  if ($Op -eq 'sri') {
    [Console]::Out.WriteLine((ConvertFrom-Sri $Arg1))
  } elseif ($Op -eq 'args') {
    $a = Get-Content -LiteralPath $Arg1 -Raw | ConvertFrom-Json
    Assert-ClaudeArgs $a.version $a.main_url $a.main_integrity $a.win_url $a.win_integrity
  } elseif ($Op -eq 'get') {
    Get-Pinned (Get-Content -LiteralPath $Arg1 -Raw | ConvertFrom-Json) $Arg2
  } elseif ($Op -eq 'entries') {
    Assert-TarEntries ($Arg1 -split '\\|')
  } elseif ($Op -eq 'expect') {
    $h = Get-ExpectedExe '${TAR}' $Arg1 $Arg2 '${V}'
    [Console]::Out.WriteLine('HASH ' + $h)
  } elseif ($Op -eq 'install') {
    $a = Get-Content -LiteralPath $Arg1 -Raw | ConvertFrom-Json
    $m = Install-ClaudeCode $a.npm $a.tar $a.main $a.win $a.prefix $a.scratch
    Assert-ClaudeInstall $a.prefix '${V}' $a.hash
    [Console]::Out.WriteLine('METHOD ' + $m)
  } elseif ($Op -eq 'assert') {
    $a = Get-Content -LiteralPath $Arg1 -Raw | ConvertFrom-Json
    Assert-ClaudeInstall $a.prefix '${V}' $a.hash
  } elseif ($Op -eq 'version') {
    Assert-ClaudeVersion $Arg1 $Arg2
  }
  [Console]::Out.WriteLine('OK')
} catch {
  [Console]::Out.WriteLine('REFUSED: ' + $_.Exception.Message)
  exit 3
}
`;

const hex = (b: ArrayBuffer) =>
  Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const sha256 = async (s: string) =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

async function withTemp(
  fn: (
    t: string,
    run: (op: string, a1: string, a2?: string) => ReturnType<typeof ps>,
  ) => Promise<void>,
) {
  const base = Deno.env.get("TEMP") ?? Deno.makeTempDirSync();
  const t = await testTempDir({ dir: base, prefix: "installcc-" });
  try {
    const runner = join(t, "runner.ps1");
    await Deno.writeTextFile(runner, RUNNER);
    await fn(t, (op, a1, a2 = "") => ps(runner, [op, a1, a2]));
  } finally {
    await Deno.remove(t, { recursive: true });
  }
}

const json = async (t: string, name: string, v: unknown) => {
  const p = join(t, `${name}.json`);
  await Deno.writeTextFile(p, JSON.stringify(v));
  return p;
};

// Plainly textual content so ML scanners do not mistake the .exe-named fixtures for binaries.
const EXE =
  "CentralGauge test fixture: the platform claude.exe, not an executable\n";
const STUB =
  "CentralGauge test fixture: the 500-byte stub, not an executable\n";

/** A package dir packed as an npm tarball (entries under package/) with the real tar.exe. */
async function tgz(
  t: string,
  name: string,
  files: Record<string, string>,
): Promise<string> {
  const src = join(t, `src-${name}`);
  for (const [rel, text] of Object.entries(files)) {
    const p = join(src, "package", ...rel.split("/"));
    await Deno.mkdir(join(p, ".."), { recursive: true });
    await Deno.writeTextFile(p, text);
  }
  const out = join(t, `${name}.tgz`);
  const r = await new Deno.Command(TAR, {
    args: ["-czf", out, "-C", src, "package"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(r.code, 0, new TextDecoder().decode(r.stderr));
  return out;
}

const winFiles = (over: Record<string, string> = {}) => ({
  "package.json": JSON.stringify({
    name: "@anthropic-ai/claude-code-win32-x64",
    version: V,
  }),
  "claude.exe": EXE,
  ...over,
});
const mainFiles = () => ({
  "package.json": JSON.stringify({
    name: "@anthropic-ai/claude-code",
    version: V,
    bin: { claude: "bin/claude.exe" },
  }),
  "bin/claude.exe": STUB,
  "install.cjs": "throw new Error('never runs')\n",
});

Deno.test({
  name:
    "install-claude-code.ps1 (PS 5.1, H-03): an SRI decodes to the sha512 hex Get-FileHash reports; malformed SRIs are refused",
  ignore: !WIN,
  async fn() {
    await withTemp(async (_t, run) => {
      const body = new TextEncoder().encode("CentralGauge fixture body\n");
      const digest = await crypto.subtle.digest("SHA-512", body);
      const b64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
      const r = await run("sri", `sha512-${b64}`);
      assertEquals(r.code, 0, r.out);
      assertEquals(r.out.trim().split(/\r?\n/)[0], hex(digest));
      for (const bad of ["sha256-abc", "sha512-", `sha512-${"A".repeat(86)}`]) {
        const b = await run("sri", bad);
        assertEquals(b.code, 3, `${bad}: ${b.out}`);
        assertStringIncludes(b.out, "integrity");
      }
    });
  },
});

Deno.test({
  name:
    "install-claude-code.ps1 (PS 5.1, H-03): Assert-ClaudeArgs accepts the exact resolution and refuses any malformed version, URL or integrity",
  ignore: !WIN,
  async fn() {
    const ok = {
      version: V,
      main_url:
        `https://registry.npmjs.org/@anthropic-ai/claude-code/-/claude-code-${V}.tgz`,
      main_integrity: `sha512-${"M".repeat(86)}==`,
      win_url:
        `https://registry.npmjs.org/@anthropic-ai/claude-code-win32-x64/-/claude-code-win32-x64-${V}.tgz`,
      win_integrity: `sha512-${"W".repeat(86)}==`,
    };
    await withTemp(async (t, run) => {
      const good = await run("args", await json(t, "ok", ok));
      assertEquals([good.code, good.out.trim()], [0, "OK"]);
      const bad: [string, Record<string, string>, string][] = [
        ["pre", { version: `${V}-beta.1` }, "version"],
        ["lead0", { version: "2.01.296" }, "version"],
        ["empty", { version: "" }, "version"],
        ["http", { main_url: ok.main_url.replace("https:", "http:") }, "URL"],
        ["other v", { main_url: ok.main_url.replace(V, "2.1.295") }, "URL"],
        ["win as main", { main_url: ok.win_url }, "URL"],
        ["query", { win_url: `${ok.win_url}?x=1` }, "URL"],
        ["sri", { main_integrity: "sha1-abc" }, "integrity"],
        [
          "win sri",
          { win_integrity: `sha512-${"W".repeat(85)}==` },
          "integrity",
        ],
      ];
      for (const [name, over, msg] of bad) {
        const r = await run("args", await json(t, name, { ...ok, ...over }));
        assertEquals(r.code, 3, `${name}: ${r.out}`);
        assertStringIncludes(r.out, msg, name);
      }
    });
  },
});

Deno.test({
  name:
    "install-claude-code.ps1 (PS 5.1, H-03): a sha512 mismatch refuses and leaves no file; a match is promoted",
  ignore: !WIN,
  async fn() {
    const body = new TextEncoder().encode(
      "CentralGauge test fixture: npm tarball body\n".repeat(16),
    );
    const server = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen() {} },
      () => new Response(body),
    );
    try {
      const url = `http://127.0.0.1:${server.addr.port}/claude-code.tgz`;
      await withTemp(async (t, run) => {
        const pin = join(t, "pin.json");
        const out = join(t, "claude-code.tgz");
        await Deno.writeTextFile(
          pin,
          JSON.stringify({ url, algorithm: "SHA512", hash: "e".repeat(128) }),
        );
        const bad = await run("get", pin, out);
        assertEquals(bad.code, 3, bad.out);
        assertStringIncludes(bad.out, "hash mismatch for " + url);
        assertEquals(
          [...Deno.readDirSync(t)].map((e) => e.name).sort(),
          ["pin.json", "runner.ps1"],
        );
        await Deno.writeTextFile(
          pin,
          JSON.stringify({
            url,
            algorithm: "SHA512",
            hash: hex(await crypto.subtle.digest("SHA-512", body)),
          }),
        );
        const ok = await run("get", pin, out);
        assertEquals([ok.code, ok.out.trim()], [0, "OK"]);
        assertEquals(await Deno.readFile(out), body);
      });
    } finally {
      await server.shutdown();
    }
  },
});

Deno.test({
  name:
    "install-claude-code.ps1 (PS 5.1, H-03): tar entries outside package/, rooted, drive, colon, backslash or .. are refused",
  ignore: !WIN,
  async fn() {
    await withTemp(async (_t, run) => {
      const ok = await run("entries", "package/|package/bin/claude.exe");
      assertEquals([ok.code, ok.out.trim()], [0, "OK"]);
      for (
        const e of [
          "../evil",
          "package/../evil",
          "/abs",
          "C:/evil",
          "package\\evil",
          "package/a:stream",
          "other/x",
        ]
      ) {
        const r = await run("entries", `package/ok|${e}`);
        assertEquals(r.code, 3, `${e}: ${r.out}`);
        assertStringIncludes(r.out, "unsafe archive entry");
      }
    });
  },
});

Deno.test({
  name:
    "install-claude-code.ps1 (PS 5.1, H-03): the expected claude.exe hash comes from the verified platform archive before any install; a missing exe or another package is refused",
  ignore: !WIN,
  async fn() {
    await withTemp(async (t, run) => {
      const win = await tgz(t, "win", winFiles());
      const r = await run("expect", win, join(t, "scratch"));
      assertEquals(r.code, 0, r.out);
      assertStringIncludes(r.out, `HASH ${await sha256(EXE)}`);
      const noExe = await tgz(t, "noexe", {
        "package.json": winFiles()["package.json"],
      });
      const a = await run("expect", noExe, join(t, "scratch2"));
      assertEquals(a.code, 3, a.out);
      assertStringIncludes(a.out, "no package/claude.exe");
      const other = await tgz(
        t,
        "other",
        winFiles({
          "package.json": JSON.stringify({
            name: "@anthropic-ai/claude-code-win32-x64",
            version: "2.1.295",
          }),
        }),
      );
      const b = await run("expect", other, join(t, "scratch3"));
      assertEquals(b.code, 3, b.out);
      assertStringIncludes(b.out, "@2.1.295");
    });
  },
});

Deno.test({
  name:
    "install-claude-code.ps1 (PS 5.1, H-03): an npm exit failure falls back to tar.exe on the same verified archives with identical postconditions; npm exit 0 without the install and a failing tar are refused",
  ignore: !WIN,
  async fn() {
    await withTemp(async (t, run) => {
      const win = await tgz(t, "win", winFiles());
      const main = await tgz(t, "main", mainFiles());
      const cmd = async (name: string, code: number) => {
        const p = join(t, `${name}.cmd`);
        await Deno.writeTextFile(p, `@echo ${name} %*\r\n@exit /b ${code}\r\n`);
        return p;
      };
      const install = async (
        name: string,
        o: { npm: string; tar?: string },
      ) => {
        const prefix = join(t, `prefix-${name}`);
        // npm's shims, which neither path may leave behind.
        await Deno.mkdir(prefix, { recursive: true });
        await Deno.writeTextFile(join(prefix, "claude.cmd"), "@echo shim\r\n");
        const r = await run(
          "install",
          await json(t, name, {
            npm: o.npm,
            tar: o.tar ?? TAR,
            main,
            win,
            prefix,
            scratch: join(t, `scratch-${name}`),
            hash: await sha256(EXE),
          }),
        );
        return { r, prefix };
      };
      const fb = await install("fallback", { npm: await cmd("npm-fails", 7) });
      assertEquals(fb.r.code, 0, fb.r.out);
      assertStringIncludes(fb.r.out, "npm install failed (exit 7)");
      assertStringIncludes(fb.r.out, "METHOD tar");
      const nm = join(fb.prefix, "node_modules", "@anthropic-ai");
      assertEquals(
        await Deno.readTextFile(join(nm, "claude-code", "bin", "claude.exe")),
        EXE,
        "the verified binary replaced the stub",
      );
      assertEquals(
        [...Deno.readDirSync(fb.prefix)].map((e) => e.name),
        ["node_modules"],
        "no shim left",
      );

      const silent = await install("silent", { npm: await cmd("npm-ok", 0) });
      assertEquals(silent.r.code, 3, silent.r.out);
      assertStringIncludes(silent.r.out, "node_modules");
      const npmLines = silent.r.out.split(/\r?\n/).filter((l) =>
        l.startsWith("npm-ok ")
      );
      assertEquals(npmLines.length, 2, silent.r.out);
      for (const l of npmLines) {
        for (
          const flag of [
            "install -g --prefix",
            "--offline",
            "--ignore-scripts",
            "--registry http://127.0.0.1:9/",
          ]
        ) assertStringIncludes(l, flag);
      }
      assertStringIncludes(npmLines[1]!, "--omit=optional");

      const noTar = await install("notar", {
        npm: await cmd("npm-fails2", 7),
        tar: await cmd("tar-fails", 5),
      });
      assertEquals(noTar.r.code, 3, noTar.r.out);
      assertStringIncludes(noTar.r.out, "exit 5");
    });
  },
});

Deno.test({
  name:
    "install-claude-code.ps1 (PS 5.1, H-03): the postconditions refuse a stub left in place, an extra executable and an extra package",
  ignore: !WIN,
  async fn() {
    await withTemp(async (t, run) => {
      const tree = async (
        name: string,
        extra: (p: string) => Promise<void>,
      ) => {
        const prefix = join(t, name);
        const nm = join(prefix, "node_modules", "@anthropic-ai");
        for (
          const [rel, text] of Object.entries({
            "claude-code/package.json": mainFiles()["package.json"],
            "claude-code/bin/claude.exe": EXE,
            "claude-code-win32-x64/package.json": winFiles()["package.json"],
            "claude-code-win32-x64/claude.exe": EXE,
          })
        ) {
          await Deno.mkdir(join(nm, rel, ".."), { recursive: true });
          await Deno.writeTextFile(join(nm, rel), text);
        }
        await extra(nm);
        return await run(
          "assert",
          await json(t, name, { prefix, hash: await sha256(EXE) }),
        );
      };
      const ok = await tree("ok", () => Promise.resolve());
      assertEquals([ok.code, ok.out.trim()], [0, "OK"]);
      const stub = await tree(
        "stub",
        (nm) =>
          Deno.writeTextFile(
            join(nm, "claude-code", "bin", "claude.exe"),
            STUB,
          ),
      );
      assertEquals(stub.code, 3, stub.out);
      assertStringIncludes(stub.out, "hash mismatch");
      const extra = await tree(
        "extra",
        (nm) => Deno.writeTextFile(join(nm, "claude-code", "vendor.exe"), STUB),
      );
      assertEquals(extra.code, 3, extra.out);
      assertStringIncludes(extra.out, "vendor.exe");
      const pkg = await tree("pkg", (nm) => Deno.mkdir(join(nm, "evil")));
      assertEquals(pkg.code, 3, pkg.out);
      assertStringIncludes(pkg.out, "evil");
    });
  },
});

Deno.test({
  name:
    "install-claude-code.ps1 (PS 5.1, H-03): claude --version must start with the resolved version",
  ignore: !WIN,
  async fn() {
    await withTemp(async (t, run) => {
      const fake = async (name: string, line: string, code = 0) => {
        const p = join(t, `${name}.cmd`);
        await Deno.writeTextFile(p, `@echo ${line}\r\n@exit /b ${code}\r\n`);
        return p;
      };
      const ok = await run(
        "version",
        await fake("ok", `${V} (Claude Code)`),
        V,
      );
      assertEquals([ok.code, ok.out.trim()], [0, "OK"]);
      const other = await run(
        "version",
        await fake("other", "2.1.2960 (Claude Code)"),
        V,
      );
      assertEquals(other.code, 3, other.out);
      const failed = await run(
        "version",
        await fake("failed", `${V} (Claude Code)`, 1),
        V,
      );
      assertEquals(failed.code, 3, failed.out);
      assert(failed.out.includes("exit 1"), failed.out);
    });
  },
});
