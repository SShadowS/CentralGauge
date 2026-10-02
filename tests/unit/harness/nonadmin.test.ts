/**
 * H-01: the agent runs as the non-admin built-in ContainerUser. The run arg
 * (sandbox.ts) is the primary control; the images end as ContainerUser and
 * every agent entrypoint refuses to start as an administrator.
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import {
  ADMIN_REFUSAL_EXIT,
  ADMIN_REFUSAL_MARKER,
  checkSandboxPrivilege,
  groupProblems,
  PRIVILEGE_ARGV,
  SANDBOX_USER,
} from "../../../src/harness/sandbox.ts";
import {
  ADMIN_GROUPS_CSV,
  FakeDocker,
  USER_GROUPS_CSV,
} from "./fake-docker.ts";

const GUARD = "harness/images/base/cg-nonadmin.ps1";
const ENTRYPOINTS = {
  "claude-code": ["$env:USERPROFILE", "& claude @claudeArgs"],
  pi: ["$env:PI_CODING_AGENT_DIR =", "& pi --version"],
} as const;
const code = (text: string) =>
  text.split(/\r?\n/).map((l) => l.trim()).filter((l) =>
    l !== "" && !l.startsWith("#")
  );

Deno.test("H-01 guard: one implementation, in the base image; exit 86 with the marker; only a refusal can be forced", async () => {
  const base = await Deno.readTextFile(
    "harness/images/base/Dockerfile.windows",
  );
  assert(/^COPY cg-nonadmin\.ps1 C:\/cg-nonadmin\.ps1\s*$/m.test(base), base);
  const g = await Deno.readTextFile(GUARD);
  assertStringIncludes(g, ADMIN_REFUSAL_MARKER);
  assertStringIncludes(g, `exit ${ADMIN_REFUSAL_EXIT}`);
  assertStringIncludes(
    g,
    "[Security.Principal.WindowsBuiltInRole]::Administrator",
  );
  assertStringIncludes(g, "ContainerAdministrator");
  assert(!/param\s*\(/i.test(g), "no parameters");
  assertEquals(
    [...new Set(g.match(/\$env:\w+/g))],
    ["$env:CG_NONADMIN_FORCE_ADMIN"],
    "the only input can force a refusal, never skip one",
  );
  for (const h of ["claude-code", "pi", "mock"]) {
    const df = await Deno.readTextFile(
      `harness/images/${h}/Dockerfile.windows`,
    );
    assert(!df.includes("cg-nonadmin"), `${h} copies no second guard`);
  }
});

Deno.test("H-01 entrypoints: the guard runs first, before config, secrets, ready and the agent; any non-zero exits 86", async () => {
  for (const [h, own] of Object.entries(ENTRYPOINTS)) {
    const run = await Deno.readTextFile(`harness/images/${h}/run.ps1`);
    const lines = code(run);
    assertEquals(lines.slice(0, 3), [
      "$ErrorActionPreference = 'Stop'",
      "& 'C:\\cg-nonadmin.ps1'",
      "if ($LASTEXITCODE -ne 0) { exit 86 }",
    ], h);
    const body = lines.join("\n"); // comments may name anything
    const guard = body.indexOf("& 'C:\\cg-nonadmin.ps1'");
    for (
      const later of ["C:\\config", "cg-secrets", "ready", ...own]
    ) {
      const at = body.indexOf(later);
      assert(at > guard, `${h}: ${later} after the guard`);
    }
  }
});

Deno.test("H-01 images: npm into a machine-wide prefix; the agent images end as ContainerUser", async () => {
  const pkgs = {
    "claude-code": "@anthropic-ai/claude-code@2.1.282",
    pi: "@earendil-works/pi-coding-agent@0.87.1",
  };
  for (const [h, pkg] of Object.entries(pkgs)) {
    const df = await Deno.readTextFile(
      `harness/images/${h}/Dockerfile.windows`,
    );
    assertStringIncludes(df, `npm install -g --prefix C:\\cg-npm ${pkg};`);
    assertStringIncludes(
      df,
      "[Environment]::SetEnvironmentVariable('PATH', 'C:\\cg-npm;' + [Environment]::GetEnvironmentVariable('PATH', 'Machine'), [EnvironmentVariableTarget]::Machine)",
    );
    assert(!df.includes("npm config get prefix"), h);
  }
  for (const h of ["claude-code", "pi", "mock"]) {
    const lines = code(
      await Deno.readTextFile(`harness/images/${h}/Dockerfile.windows`),
    );
    assertEquals(lines.at(-2), "USER ContainerUser", h);
    assert(lines.at(-1)!.startsWith("CMD "), h);
    // Exec form is JSON: the script path must parse to C:\<script> ("C:\r..." would be a carriage return).
    const cmd = JSON.parse(lines.at(-1)!.slice(4)) as string[];
    assertEquals(
      cmd.at(-1),
      h === "mock" ? "C:\\mock.ps1" : "C:\\run.ps1",
      h,
    );
    assertEquals(lines.filter((l) => /^USER\b/.test(l)).length, 1, h);
  }
});

Deno.test("H-01 pi: C:\\pi-agent exists at build time, Users may modify it (by SID); run.ps1 creates it only if missing", async () => {
  const df = await Deno.readTextFile("harness/images/pi/Dockerfile.windows");
  assertStringIncludes(
    df,
    "New-Item -ItemType Directory -Force -Path C:\\pi-agent",
  );
  assertStringIncludes(
    df,
    "icacls C:\\pi-agent /grant '*S-1-5-32-545:(OI)(CI)M'",
  );
  assert(
    df.indexOf("icacls C:\\pi-agent") < df.indexOf("USER ContainerUser"),
    "granted while still admin",
  );
  assert(!/OPENROUTER|api-key|cg-secrets/i.test(df));
  const run = await Deno.readTextFile("harness/images/pi/run.ps1");
  assertStringIncludes(
    run,
    "if (-not (Test-Path $env:PI_CODING_AGENT_DIR)) { New-Item -ItemType Directory -Path $env:PI_CODING_AGENT_DIR | Out-Null }",
  );
});

const guardRun = async (env: Record<string, string>) => {
  const out = await new Deno.Command("powershell", {
    args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", GUARD],
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return { code: out.code, stderr: new TextDecoder().decode(out.stderr) };
};

Deno.test({
  name:
    "H-01 guard on the host (non-elevated): passes silently; CG_NONADMIN_FORCE_ADMIN=1 refuses with 86 and the marker",
  ignore: Deno.build.os !== "windows",
  async fn() {
    assertEquals(await guardRun({ CG_NONADMIN_FORCE_ADMIN: "" }), {
      code: 0,
      stderr: "",
    });
    assertEquals((await guardRun({ CG_NONADMIN_FORCE_ADMIN: "0" })).code, 0);
    const r = await guardRun({ CG_NONADMIN_FORCE_ADMIN: "1" });
    assertEquals(r.code, ADMIN_REFUSAL_EXIT);
    assert(r.stderr.startsWith(`${ADMIN_REFUSAL_MARKER} (`), r.stderr);
    assert(r.stderr.includes(Deno.env.get("USERNAME") ?? "?"), r.stderr);
  },
});

Deno.test({
  name:
    "H-01 guard: an exception inside the guard fails closed with 86 (constrained language mode makes the identity call throw)",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const out = await new Deno.Command("powershell", {
      args: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `$ExecutionContext.SessionState.LanguageMode = 'ConstrainedLanguage'; & '${GUARD}'; exit $LASTEXITCODE`,
      ],
      env: { CG_NONADMIN_FORCE_ADMIN: "" },
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(out.code, ADMIN_REFUSAL_EXIT);
  },
});

// H-01 run 002: the harness's own privilege check (never the entrypoint's output).

const row = (name: string, type: string, sid: string, attrs: string) =>
  `"${name}","${type}","${sid}","${attrs}"`;
const ENABLED = "Mandatory group, Enabled by default, Enabled group";

Deno.test("groupProblems: ContainerUser's real-looking output is clean", () => {
  assertEquals(groupProblems(USER_GROUPS_CSV), []);
  assertEquals(PRIVILEGE_ARGV.slice(1), ["/groups", "/fo", "csv", "/nh"]);
});

Deno.test("privilege check (H-01 run 003): whoami is the absolute System32 binary, never a name a staged file could shadow", () => {
  // docker exec starts in the image's WORKDIR (C:\workspace, agent-writable
  // and staged by the harness): a bare "whoami" would resolve to a
  // C:\workspace\whoami.exe first. Only the full path is trusted.
  assertEquals(PRIVILEGE_ARGV[0], "C:\\Windows\\System32\\whoami.exe");
  const exe = PRIVILEGE_ARGV[0]!;
  assert(/^[A-Za-z]:\\/.test(exe), "absolute");
  assert(!exe.toLowerCase().includes("workspace"));
  // A shadow staged in the workspace is never the program the check runs.
  const shadow = "C:\\workspace\\whoami.exe";
  assert(exe.toLowerCase() !== shadow.toLowerCase());
  for (const bare of ["whoami", "whoami.exe", ".\\whoami.exe"]) {
    assert(exe !== bare, bare);
  }
});

Deno.test("groupProblems: ContainerAdministrator's output names the enabled Administrators group and the high label", () => {
  const p = groupProblems(ADMIN_GROUPS_CSV);
  assertEquals(p.length, 2, p.join("; "));
  assertStringIncludes(p[0]!, "S-1-5-32-544");
  assertStringIncludes(p[1]!, "S-1-16-12288");
});

Deno.test("groupProblems: strict; Administrators anywhere but deny-only, system or higher labels, a missing label, empty or unparseable output all fail", () => {
  const label = row(
    "Mandatory Label\\Medium Mandatory Level",
    "Label",
    "S-1-16-8192",
    "",
  );
  const bad: [string, string][] = [
    ["", "no output"],
    ["  \r\n", "no output"],
    ["garbage\r\n", "unparseable"],
    [`${label}\r\nnot csv`, "unparseable"],
    [`"a","b","c"\r\n${label}`, "unparseable"],
    [`${row("x", "Alias", "not-a-sid", ENABLED)}\r\n${label}`, "unparseable"],
    [
      row("Everyone", "Well-known group", "S-1-1-0", ENABLED),
      "no mandatory label",
    ],
    [
      `${label}\r\n${row("Mandatory Label\\High", "Label", "S-1-16-8448", "")}`,
      "more than one mandatory label",
    ],
    [
      row(
        "Mandatory Label\\System Mandatory Level",
        "Label",
        "S-1-16-16384",
        "",
      ),
      "S-1-16-16384",
    ],
    [
      `${
        row(
          "BUILTIN\\Administrators",
          "Alias",
          "S-1-5-32-544",
          "Mandatory group, Enabled by default, Enabled group",
        )
      }\r\n${label}`,
      "S-1-5-32-544",
    ],
    [
      `${
        row(
          "BUILTIN\\Administratorer",
          "Alias",
          "S-1-5-32-544",
          "Obligatorisk gruppe",
        )
      }\r\n${label}`,
      "S-1-5-32-544",
    ],
  ];
  for (const [text, want] of bad) {
    const p = groupProblems(text);
    assert(p.length > 0, JSON.stringify(text));
    assertStringIncludes(p.join("; "), want, JSON.stringify(text));
  }
  // A filtered (UAC) token's deny-only Administrators is not an enabled group.
  assertEquals(
    groupProblems(
      `${
        row(
          "BUILTIN\\Administrators",
          "Alias",
          "S-1-5-32-544",
          "Group used for deny only",
        )
      }\r\n${label}`,
    ),
    [],
  );
});

Deno.test("checkSandboxPrivilege: Config.User exactly ContainerUser, then whoami as ContainerUser; any failure, error or timeout throws", async () => {
  const d = new FakeDocker();
  d.configUsers.set("sb", SANDBOX_USER);
  await checkSandboxPrivilege(d, "sb", 100);
  assertEquals(d.privilegeCalls.map((c) => [c.op, c.user, c.argv]), [
    ["configUser", undefined, undefined],
    ["exec", SANDBOX_USER, PRIVILEGE_ARGV],
  ]);
  const fails: [(d: FakeDocker) => void, string][] = [
    [
      (d) => d.configUsers.set("sb", "ContainerAdministrator"),
      "ContainerAdministrator",
    ],
    [(d) => d.configUsers.set("sb", "containeruser"), "containeruser"],
    [(d) => d.configUsers.set("sb", ""), "not ContainerUser"],
    [(d) => d.configUsers.set("sb", null), "not ContainerUser"],
    [
      (d) => (d.execAnswer = { code: 0, stdout: ADMIN_GROUPS_CSV, stderr: "" }),
      "S-1-5-32-544",
    ],
    [
      (
        d,
      ) => (d.execAnswer = {
        code: 1,
        stdout: USER_GROUPS_CSV,
        stderr: "nope",
      }),
      "exited 1",
    ],
    [(d) => (d.execAnswer = { code: 0, stdout: "", stderr: "" }), "no output"],
    [(d) => (d.execAnswer = new Error("exec blew up")), "exec blew up"],
    [(d) => (d.execAnswer = "hang"), "timed out"],
  ];
  for (const [arrange, want] of fails) {
    const d = new FakeDocker();
    d.configUsers.set("sb", SANDBOX_USER);
    arrange(d);
    await assertRejects(() => checkSandboxPrivilege(d, "sb", 100), Error, want);
  }
});

// H-01 run 004 (H:\cg-coord\reviews\H-01-003\reject-pi-image-build.md).

const LOCKDOWN = "harness/images/base/cg-lockdown.ps1";
const IMAGES = ["base", "claude-code", "pi", "mock"] as const;
/** Dockerfile instructions with backslash continuations joined. */
const instructions = (text: string) =>
  code(text.replace(/\s*\\\r?\n\s*/g, " "));

Deno.test("H-01 run 004: no shell-form RUN carries a double quote (the Windows docker command line drops them before PowerShell parses)", async () => {
  for (const h of IMAGES) {
    const runs = instructions(
      await Deno.readTextFile(`harness/images/${h}/Dockerfile.windows`),
    ).filter((l) => /^RUN\s/.test(l) && !/^RUN\s+\[/.test(l));
    assert(runs.length > 0 || h === "mock", h);
    for (const r of runs) assert(!r.includes('"'), `${h}: ${r}`);
  }
  const pi = await Deno.readTextFile("harness/images/pi/Dockerfile.windows");
  assertStringIncludes(pi, "icacls C:\\pi-agent /grant '*S-1-5-32-545:(OI)(CI)M'");
});

const LOCKED: Record<(typeof IMAGES)[number], string[]> = {
  base: [
    "C:\\cg-al.ps1",
    "C:\\Windows\\System32\\cg-al.cmd",
    "C:\\Git",
    "C:\\al-tools-mcp.mjs",
    "C:\\al-tools-tools.json",
    "C:\\egress-check.ps1",
    "C:\\cg-nonadmin.ps1",
    "C:\\cg-lockdown.ps1",
    "C:\\Program Files\\nodejs",
  ],
  "claude-code": ["C:\\cg-npm", "C:\\run.ps1"],
  pi: ["C:\\cg-npm", "C:\\run.ps1", "C:\\cg-budget.ts"],
  mock: ["C:\\mock.ps1"],
};

Deno.test("H-01 run 004: each image locks every harness-owned path it adds, after its last COPY and RUN, before USER", async () => {
  for (const h of IMAGES) {
    const lines = instructions(
      await Deno.readTextFile(`harness/images/${h}/Dockerfile.windows`),
    );
    const at = lines.findIndex((l) => l.includes("C:\\cg-lockdown.ps1 "));
    assert(at >= 0, `${h}: no lockdown`);
    const l = lines[at]!;
    assert(
      l.startsWith(
        "RUN powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\\cg-lockdown.ps1 ",
      ),
      l,
    );
    assertStringIncludes(
      l,
      "; if ($LASTEXITCODE -ne 0) { throw ('cg-lockdown failed: ' + $LASTEXITCODE) }",
    );
    const args = l.slice(l.indexOf("cg-lockdown.ps1 ") + 16, l.indexOf(";"))
      .match(/'[^']*'|\S+/g)!.map((a) => a.replace(/^'|'$/g, ""));
    assertEquals(args, LOCKED[h], h);
    lines.forEach((x, i) => {
      if (i !== at && /^(RUN|COPY)\s/.test(x)) assert(i < at, `${h}: ${x}`);
      if (/^USER\s/.test(x)) assert(i > at, `${h}: ${x}`);
    });
    // Every file the image COPYs is a locked path or lies under one.
    for (const c of lines.filter((x) => /^COPY\s/.test(x))) {
      const dest = c.split(/\s+/).at(-1)!.replaceAll("/", "\\");
      assert(
        args.some((p) => dest === p || dest.startsWith(p + "\\")),
        `${h}: ${dest} not locked`,
      );
    }
  }
  // C:\pi-agent is the agent's own directory: Users keep Modify there.
  assert(!LOCKED.pi.includes("C:\\pi-agent"));
});

const pwsh = async (args: string[]) => {
  const out = await new Deno.Command("powershell", {
    args: ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const d = new TextDecoder();
  return {
    code: out.code,
    out: d.decode(out.stdout) + d.decode(out.stderr),
  };
};

/** A tree shaped like the C:\ root default: Authenticated Users Modify, inherited. */
const rootShapedTree = async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-lockdown-" });
  await Deno.mkdir(`${dir}\\tool\\sub`, { recursive: true });
  await Deno.writeTextFile(`${dir}\\tool\\sub\\shim.cmd`, "@echo off");
  await Deno.writeTextFile(`${dir}\\run.ps1`, "exit 0");
  const g = await pwsh([
    "-Command",
    `icacls '${dir}' /grant '*S-1-5-11:(OI)(CI)M' /Q; exit $LASTEXITCODE`,
  ]);
  assertEquals(g.code, 0, g.out);
  return dir;
};
const dropTree = async (dir: string) => {
  await pwsh(["-Command", `icacls '${dir}' /reset /T /C /Q | Out-Null`]);
  await Deno.remove(dir, { recursive: true });
};

Deno.test({
  name:
    "H-01 run 004: cg-lockdown -VerifyOnly fails the root-COPY shape (Authenticated Users Modify) on files and inside directories",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const dir = await rootShapedTree();
    try {
      const r = await pwsh([
        "-File",
        LOCKDOWN,
        "-VerifyOnly",
        `${dir}\\run.ps1`,
        `${dir}\\tool`,
      ]);
      assertEquals(r.code, 1, r.out);
      assertStringIncludes(r.out, `[FAIL] write S-1-5-11 ${dir}\\run.ps1`);
      assertStringIncludes(r.out, `[FAIL] write S-1-5-11 ${dir}\\tool\\sub\\shim.cmd`);
    } finally {
      await dropTree(dir);
    }
  },
});

Deno.test({
  name:
    "H-01 run 004: cg-lockdown removes every non-admin write grant on files and whole trees; only Users read/execute remains",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const dir = await rootShapedTree();
    // Children that do not just inherit (review, H-01 run 004): an explicit
    // Authenticated Users Modify ACE, a child with inheritance disabled and
    // its own Users Modify ACE, and a hidden file.
    const explicitAce = `${dir}\\tool\\explicit.cmd`;
    const protectedChild = `${dir}\\tool\\sub\\protected.cmd`;
    const hidden = `${dir}\\tool\\hidden.cmd`;
    for (const f of [explicitAce, protectedChild, hidden]) {
      await Deno.writeTextFile(f, "@echo off");
    }
    const s = await pwsh([
      "-Command",
      [
        `icacls '${explicitAce}' /grant '*S-1-5-11:M' /Q`,
        `if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`,
        `icacls '${protectedChild}' /inheritance:d /Q`,
        `if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`,
        `icacls '${protectedChild}' /grant '*S-1-5-32-545:M' /Q`,
        `if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`,
        `attrib +h '${hidden}'`,
        `exit $LASTEXITCODE`,
      ].join("; "),
    ]);
    assertEquals(s.code, 0, s.out);
    try {
      const r = await pwsh([
        "-File",
        LOCKDOWN,
        `${dir}\\run.ps1`,
        `${dir}\\tool`,
      ]);
      // On the host the owner is this (non-container) user, which the
      // in-image check refuses; the DACL itself must be clean.
      const fails = r.out.split(/\r?\n/).filter((x) => x.startsWith("[FAIL]"));
      assert(fails.length > 0, r.out);
      for (const f of fails) assert(f.startsWith("[FAIL] owner "), f);
      for (
        const p of [
          `${dir}\\run.ps1`,
          `${dir}\\tool\\sub\\shim.cmd`,
          explicitAce,
          protectedChild,
          hidden,
        ]
      ) {
        const a = await pwsh(["-Command", `icacls '${p}'`]);
        assert(!a.out.includes("S-1-5-11") && !/Authenticated Users/.test(a.out), a.out);
        assert(/BUILTIN\\Users:(\(I\))?\(RX\)/.test(a.out), a.out);
        // Every Users ACE is read/execute only: no write right anywhere.
        const users = a.out.match(/BUILTIN\\Users:\S*/g) ?? [];
        for (const u of users) {
          assert(/^BUILTIN\\Users:(\(I\))?\(RX\)$/.test(u), `${p}: ${u}`);
        }
      }
    } finally {
      await dropTree(dir);
    }
  },
});
