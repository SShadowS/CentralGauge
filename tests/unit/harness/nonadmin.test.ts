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
  PI_STAGE_ARGV,
  PI_STAGE_USER,
  PRIVILEGE_ARGV,
  SANDBOX_USER,
  stagePiConfig,
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

Deno.test("H-01 pi: C:\\pi-agent exists at build time with an explicit ACL (by SID, run 005: no Users Modify); run.ps1 never creates it", async () => {
  const df = await Deno.readTextFile("harness/images/pi/Dockerfile.windows");
  assertStringIncludes(
    df,
    "New-Item -ItemType Directory -Force -Path C:\\pi-agent",
  );
  for (const g of PI_AGENT_ICACLS) assertStringIncludes(df, g);
  assert(!df.includes("(OI)(CI)M"), "no Users Modify (H-01 run 005)");
  assert(
    df.lastIndexOf("icacls C:\\pi-agent") < df.indexOf("USER ContainerUser"),
    "granted while still admin",
  );
  assert(!/OPENROUTER|api-key|cg-secrets/i.test(df));
  const run = await Deno.readTextFile("harness/images/pi/run.ps1");
  assert(!run.includes("New-Item"), "run.ps1 creates nothing");
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
  // H-01 run 005: the C:\pi-agent grants (single-quoted) replace run 004's Users Modify.
  for (const g of PI_AGENT_ICACLS) assertStringIncludes(pi, g);
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
  "claude-code": [
    "C:\\cg-npm",
    "C:\\run.ps1",
    "C:\\cg-inventory.ps1",
    "C:\\cg-lsp",
  ],
  pi: ["C:\\cg-npm", "C:\\run.ps1", "C:\\cg-budget.ts", "C:\\cg-pi-stage.ps1"],
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
  // C:\pi-agent carries its own ACL (H-01 run 005), not cg-lockdown's.
  assert(!LOCKED.pi.includes("C:\\pi-agent"));
});

const pwsh = async (args: string[], env?: Record<string, string>) => {
  const out = await new Deno.Command("powershell", {
    args: ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args],
    ...(env ? { env } : {}),
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
      assertStringIncludes(
        r.out,
        `[FAIL] write S-1-5-11 ${dir}\\tool\\sub\\shim.cmd`,
      );
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
        assert(
          !a.out.includes("S-1-5-11") && !/Authenticated Users/.test(a.out),
          a.out,
        );
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

// H-01 run 005 (H:\cg-coord\reviews\H-01-004\review-gpt61sol.md P2): pi's
// harness-generated config is staged admin-owned by the harness; C:\pi-agent
// lets the agent add only its own (lock) subdirectories. That ContainerUser
// cannot create/replace/delete a file there but can make and remove its own
// lock dir is provable only in a container (ops-proof-plan Run 005); these
// tests pin the Dockerfile, the scripts and the ACL shape on host temp dirs.

const PI_DF = "harness/images/pi/Dockerfile.windows";
const PI_RUN = "harness/images/pi/run.ps1";
const PI_STAGE = "harness/images/pi/cg-pi-stage.ps1";
/**
 * cg-pi-stage as the image runs it: Windows PowerShell's own module path (the
 * host's inherited pwsh 7 PSModulePath hides Get-FileHash).
 */
const runStage = (args: string[]) =>
  pwsh(["-File", PI_STAGE, ...args], {
    PSModulePath: `${
      Deno.env.get("SystemRoot") ?? "C:\\Windows"
    }\\system32\\WindowsPowerShell\\v1.0\\Modules`,
  });
const PI_AGENT_ICACLS = [
  "icacls C:\\pi-agent /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' '*S-1-3-0:(OI)(CI)(IO)F' /Q",
  "icacls C:\\pi-agent /grant '*S-1-5-32-545:(AD)' /Q",
];

Deno.test("H-01 run 005: the pi Dockerfile gives C:\\pi-agent its explicit ACL (inheritance off, Users RX + AD on the folder only, CREATOR OWNER inherit-only), each icacls checked", async () => {
  const lines = instructions(await Deno.readTextFile(PI_DF));
  const run = lines.filter((l) => l.includes("C:\\pi-agent"));
  const fail =
    "if ($LASTEXITCODE -ne 0) { throw ('icacls C:\\pi-agent failed: ' + $LASTEXITCODE) }";
  assertEquals(run, [
    "RUN New-Item -ItemType Directory -Force -Path C:\\pi-agent | Out-Null; " +
    `${PI_AGENT_ICACLS[0]}; ${fail}; ${PI_AGENT_ICACLS[1]}; ${fail}`,
  ]);
  // Users never get create-file (WD), delete-child (DC), modify or full here.
  const users = run[0]!.match(/\*S-1-5-32-545:\S+'/g)!;
  assertEquals(users, ["*S-1-5-32-545:(OI)(CI)RX'", "*S-1-5-32-545:(AD)'"]);
});

Deno.test("H-01 run 005: cg-pi-stage.ps1 is COPYed to C:\\cg-pi-stage.ps1 and locked; PI_STAGE_ARGV runs exactly it with the absolute powershell path", async () => {
  const lines = instructions(await Deno.readTextFile(PI_DF));
  assert(
    lines.includes("COPY cg-pi-stage.ps1 C:/cg-pi-stage.ps1"),
    lines.join("\n"),
  );
  assert(LOCKED.pi.includes("C:\\cg-pi-stage.ps1"));
  assertEquals(PI_STAGE_USER, "ContainerAdministrator");
  const exe = PI_STAGE_ARGV[0]!;
  // docker exec starts in WORKDIR C:\workspace (agent-staged): never a bare name.
  assertEquals(
    exe,
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  );
  assertEquals(PI_STAGE_ARGV.slice(1), [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    "C:\\cg-pi-stage.ps1",
  ]);
  // The stage script holds the validations run.ps1 used to run.
  const s = await Deno.readTextFile(PI_STAGE);
  for (
    const x of [
      "[string]$Dir = 'C:\\pi-agent'",
      "[string]$Config = 'C:\\config'",
      "-is [bool]",
      "-cne 'off'",
      "exit 4",
      "instructions bundle holds unexpected files",
      "pi instructions bundle must hold AGENTS.md",
      "Get-FileHash",
      "'settings.json'",
      "'AGENTS.md'",
      "'auth.json'",
      "'/setowner'",
    ]
  ) assertStringIncludes(s, x);
  assert(!/cg-secrets|OPENROUTER/i.test(s));
});

Deno.test("H-01 run 005: run.ps1 writes nothing into C:\\pi-agent; after ready it requires the staged settings.json; pi skips prompt templates and themes", async () => {
  const run = await Deno.readTextFile(PI_RUN);
  const body = code(run).join("\n");
  for (
    const w of [
      "New-Item",
      "WriteAllText",
      "WriteAllBytes",
      "Copy-Item",
      "Set-Content",
      "Out-File",
      "Move-Item",
      "Remove-Item",
      "AGENTS.md",
    ]
  ) assert(!body.includes(w), w);
  const need =
    'if (-not (Test-Path -LiteralPath "$env:PI_CODING_AGENT_DIR\\settings.json" -PathType Leaf)) {';
  assertStringIncludes(body, need);
  const at = body.indexOf(need);
  assert(at > body.indexOf("while (-not (Test-Path 'C:\\cg-secrets\\ready'))"));
  assert(at > body.indexOf("$env:PI_CODING_AGENT_DIR = 'C:\\pi-agent'"));
  assert(at < body.indexOf("& pi --version"));
  assertStringIncludes(
    body.slice(at, body.indexOf("}", at)),
    "[Console]::Error.WriteLine('[FAIL] ",
  );
  // Defense in depth: the recorded pi_settings are still validated.
  assertStringIncludes(body, "-cne 'off'");
  const piArgs = body.split("\n").find((l) => l.startsWith("$piArgs = @("))!;
  assertStringIncludes(piArgs, "'--no-prompt-templates', '--no-themes'");
});

Deno.test("H-01 run 005: stagePiConfig execs PI_STAGE_ARGV as ContainerAdministrator; non-zero, error or timeout throws", async () => {
  const d = new FakeDocker();
  await stagePiConfig(d, "sb", 100);
  assertEquals(d.privilegeCalls.map((c) => [c.op, c.name, c.user, c.argv]), [
    ["exec", "sb", PI_STAGE_USER, PI_STAGE_ARGV],
  ]);
  const fails: [FakeDocker["stageAnswer"], string][] = [
    [
      { code: 1, stdout: "[FAIL] owner S-1-5-21-1 C:\\pi-agent", stderr: "" },
      "[FAIL] owner",
    ],
    [
      { code: 4, stdout: "", stderr: "[FAIL] settings.pi_settings" },
      "exited 4",
    ],
    [new Error("exec blew up"), "exec blew up"],
    ["hang", "timed out"],
  ];
  for (const [answer, want] of fails) {
    const d = new FakeDocker();
    d.stageAnswer = answer;
    await assertRejects(() => stagePiConfig(d, "sb", 100), Error, want);
  }
});

/** The Dockerfile's own icacls segments for C:\pi-agent, aimed at `dir`. */
const piAgentGrants = async (dir: string) => {
  const segs = instructions(await Deno.readTextFile(PI_DF))
    .flatMap((l) => l.replace(/^RUN /, "").split("; "))
    .filter((s) => s.startsWith("icacls C:\\pi-agent "));
  assertEquals(segs, PI_AGENT_ICACLS);
  return segs.map((s) => s.replace("C:\\pi-agent", `'${dir}'`));
};
const ps1 = (cmds: string[]) =>
  pwsh([
    "-Command",
    cmds.map((c) => `${c}; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`)
      .join("; ") + "; exit 0",
  ]);
const fails = (out: string) =>
  out.split(/\r?\n/).filter((x) => x.startsWith("[FAIL]"));
const meSid = async () => {
  const r = await pwsh([
    "-Command",
    "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
  ]);
  return r.out.trim();
};
/** A temp dir with the Dockerfile's exact C:\pi-agent ACL. */
const piAgentDir = async () => {
  const dir = await Deno.makeTempDir({ prefix: "cg-pi-agent-" });
  const g = await ps1(await piAgentGrants(dir));
  assertEquals(g.code, 0, g.out);
  return dir;
};
/** C:\config as the harness writes it: valid pi_settings and an AGENTS.md/CLAUDE.md bundle. */
const piConfigDir = async (piSettings: unknown) => {
  const cfg = await Deno.makeTempDir({ prefix: "cg-pi-config-" });
  await Deno.writeTextFile(
    `${cfg}\\settings.json`,
    JSON.stringify({ settings: { pi_settings: piSettings } }),
  );
  await Deno.mkdir(`${cfg}\\bundle\\instructions`, { recursive: true });
  for (const f of ["AGENTS.md", "CLAUDE.md"]) {
    await Deno.writeTextFile(
      `${cfg}\\bundle\\instructions\\${f}`,
      "Environment facts: \u00e6\u00f8\u00e5.\n",
    );
  }
  return cfg;
};
const GOOD_PI = { compaction: { enabled: false }, cacheWarming: "off" };

Deno.test({
  name:
    "H-01 run 005: cg-pi-stage -VerifyOnly fails the run 004 shape (Users (OI)(CI)M) on the dir and on a file in it",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const dir = await Deno.makeTempDir({ prefix: "cg-pi-agent-" });
    try {
      await Deno.writeTextFile(`${dir}\\settings.json`, "{}");
      const g = await ps1([
        `icacls '${dir}' /grant '*S-1-5-32-545:(OI)(CI)M' /Q`,
      ]);
      assertEquals(g.code, 0, g.out);
      const r = await runStage(["-VerifyOnly", dir]);
      assertEquals(r.code, 1, r.out);
      assertStringIncludes(r.out, `[FAIL] write S-1-5-32-545 ${dir}\r\n`);
      assertStringIncludes(
        r.out,
        `[FAIL] write S-1-5-32-545 ${dir}\\settings.json`,
      );
    } finally {
      await dropTree(dir);
    }
  },
});

Deno.test({
  name:
    "H-01 run 005: the Dockerfile's C:\\pi-agent ACL plus cg-pi-stage's files pass -VerifyOnly but for the host owner; a Users write grant on a staged file fails",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const dir = await piAgentDir();
    const cfg = await piConfigDir(GOOD_PI);
    const me = await meSid();
    assert(/^S-1-5-21-/.test(me), me);
    try {
      // The Dockerfile shape alone: only the (host) owner is not an admin.
      let r = await runStage(["-VerifyOnly", dir]);
      assertEquals(r.code, 1, r.out);
      assertEquals(fails(r.out), [`[FAIL] owner ${me} ${dir}`]);
      const acl = await pwsh(["-Command", `icacls '${dir}'`]);
      assert(/BUILTIN\\Users:\(OI\)\(CI\)\(RX\)/.test(acl.out), acl.out);
      assert(/BUILTIN\\Users:\(AD\)/.test(acl.out), acl.out);
      assert(/CREATOR OWNER:\(OI\)\(CI\)\(IO\)\(F\)/.test(acl.out), acl.out);
      assert(!/\(I\)/.test(acl.out), `inheritance off: ${acl.out}`);
      // The host user stands in for ContainerAdministrator while staging.
      let g = await ps1([`icacls '${dir}' /grant '*${me}:(OI)(CI)F' /Q`]);
      assertEquals(g.code, 0, g.out);
      r = await runStage(["-Dir", dir, "-Config", cfg, "-Owner", me]);
      assertEquals(r.code, 1, r.out);
      // Only the stand-in's own grant and the host owner are flagged.
      for (const f of fails(r.out)) {
        assert(
          f.startsWith("[FAIL] owner ") || f === `[FAIL] write ${me} ${dir}` ||
            f === `[FAIL] inherited append ${me} ${dir}`,
          f,
        );
      }
      g = await ps1([`icacls '${dir}' /remove:g '*${me}' /Q`]);
      assertEquals(g.code, 0, g.out);
      r = await runStage(["-VerifyOnly", dir]);
      assertEquals(r.code, 1, r.out);
      assertEquals(
        fails(r.out).sort(),
        [
          `[FAIL] owner ${me} ${dir}`,
          `[FAIL] owner ${me} ${dir}\\AGENTS.md`,
          `[FAIL] owner ${me} ${dir}\\auth.json`,
          `[FAIL] owner ${me} ${dir}\\settings.json`,
        ].sort(),
      );
      const names = [...Deno.readDirSync(dir)].map((e) => e.name).sort();
      assertEquals(names, ["AGENTS.md", "auth.json", "settings.json"]);
      assertEquals(
        [...await Deno.readFile(`${dir}\\auth.json`)],
        [...new TextEncoder().encode("{}")],
      );
      assertEquals(
        await Deno.readFile(`${dir}\\AGENTS.md`),
        await Deno.readFile(`${cfg}\\bundle\\instructions\\AGENTS.md`),
      );
      const settings = await Deno.readFile(`${dir}\\settings.json`);
      assert(settings[0] !== 0xef, "no BOM");
      assertEquals(JSON.parse(new TextDecoder().decode(settings)), GOOD_PI);
      for (const f of ["settings.json", "AGENTS.md", "auth.json"]) {
        const a = await pwsh(["-Command", `icacls '${dir}\\${f}'`]);
        const users = a.out.match(/BUILTIN\\Users:\S*/g) ?? [];
        assertEquals(users, ["BUILTIN\\Users:(RX)"], `${f}: ${a.out}`);
        assert(!/\(I\)/.test(a.out), `${f}: ${a.out}`);
      }
      // A staged file carrying a Users write grant fails the check.
      g = await ps1([
        `icacls '${dir}\\settings.json' /grant '*S-1-5-32-545:M' /Q`,
      ]);
      assertEquals(g.code, 0, g.out);
      r = await runStage(["-VerifyOnly", dir]);
      assertEquals(r.code, 1, r.out);
      assertStringIncludes(
        r.out,
        `[FAIL] write S-1-5-32-545 ${dir}\\settings.json`,
      );
      // An inheritable append (create-file on every child) fails on the dir.
      g = await ps1([`icacls '${dir}' /grant '*S-1-5-32-545:(OI)(CI)(AD)' /Q`]);
      assertEquals(g.code, 0, g.out);
      r = await runStage(["-VerifyOnly", dir]);
      assertStringIncludes(
        r.out,
        `[FAIL] inherited append S-1-5-32-545 ${dir}`,
      );
    } finally {
      await dropTree(dir);
      await Deno.remove(cfg, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "H-01 run 005: cg-pi-stage refuses a non-empty agent dir and invalid pi_settings, writing nothing",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const me = await meSid();
    const stage = (dir: string, cfg: string) =>
      runStage(["-Dir", dir, "-Config", cfg, "-Owner", me]);
    const good = await piConfigDir(GOOD_PI);
    const bad = await piConfigDir({
      compaction: { enabled: true },
      cacheWarming: "off",
    });
    const dirs: string[] = [];
    try {
      for (const pre of ["settings.json.lock", "settings.json", null]) {
        const dir = await piAgentDir();
        dirs.push(dir);
        const g = await ps1([`icacls '${dir}' /grant '*${me}:(OI)(CI)F' /Q`]);
        assertEquals(g.code, 0, g.out);
        if (pre === "settings.json") {
          await Deno.writeTextFile(`${dir}\\${pre}`, "{}");
        } else if (pre) await Deno.mkdir(`${dir}\\${pre}`);
        const r = await stage(dir, pre ? good : bad);
        assert(r.code !== 0, r.out);
        if (pre) {
          assertStringIncludes(r.out, `[FAIL] ${dir} is not empty: ${pre}`);
          assertEquals([...Deno.readDirSync(dir)].map((e) => e.name), [pre]);
        } else {
          assertEquals(r.code, 4, r.out);
          assertStringIncludes(r.out, "[FAIL] settings.pi_settings");
          assertEquals([...Deno.readDirSync(dir)], []);
        }
      }
    } finally {
      for (const d of dirs) await dropTree(d);
      await Deno.remove(good, { recursive: true });
      await Deno.remove(bad, { recursive: true });
    }
  },
});

// H-01s: the base build (H-01q run 001) failed its own verify because an
// EXPLICIT ACE on a supplied root (C:\cg-al.ps1, C:\Git: Authenticated Users
// Modify) survived /inheritance:r + /grant:r, and the children reset then
// inherited it from C:\Git. Lock() must leave exactly the three ACEs.
Deno.test({
  name:
    "H-01s: cg-lockdown leaves exactly SYSTEM, Administrators and Users on a supplied root that carries explicit ACEs of other SIDs, and on its children",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const dir = await Deno.makeTempDir({ prefix: "cg-lockdown-h01s-" });
    const file = `${dir}\\cg-al.ps1`;
    const tree = `${dir}\\Git`;
    const child = `${tree}\\usr\\bin\\cg-al`;
    await Deno.mkdir(`${tree}\\usr\\bin`, { recursive: true });
    await Deno.writeTextFile(file, "exit 0");
    await Deno.writeTextFile(child, "#!/bin/sh");
    const s = await pwsh([
      "-Command",
      [
        `icacls '${file}' /grant '*S-1-5-11:M' '*S-1-1-0:RX' /Q`,
        `if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`,
        `icacls '${tree}' /grant '*S-1-5-11:(OI)(CI)M' '*S-1-1-0:(OI)(CI)RX' /Q`,
        `exit $LASTEXITCODE`,
      ].join("; "),
    ]);
    assertEquals(s.code, 0, s.out);
    try {
      const r = await pwsh(["-File", LOCKDOWN, file, tree]);
      // On the host the owner is the test user; the DACL itself must be clean.
      const fails = r.out.split(/\r?\n/).filter((x) => x.startsWith("[FAIL]"));
      for (const f of fails) assert(f.startsWith("[FAIL] owner "), f);
      for (const p of [file, tree, `${tree}\\usr`, child]) {
        const a = await pwsh([
          "-Command",
          `(Get-Item -LiteralPath '${p}' -Force).GetAccessControl().GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value }`,
        ]);
        assertEquals(
          [...new Set(a.out.split(/\r?\n/).filter((x) => x !== ""))].sort(),
          ["S-1-5-18", "S-1-5-32-544", "S-1-5-32-545"],
          `${p}: ${a.out}`,
        );
      }
    } finally {
      await dropTree(dir);
    }
  },
});

// H-01t (review H-01s-001): the exact DACL, read from the raw descriptor (every ACE,
// callback and conditional ones included), a fresh DACL rather than purging rules,
// and no ACL operation through a reparse point.

/** `protected=<bool>` then one sorted `<AceType> <SID> 0x<mask> <AceFlags>` line per ACE. */
const rawDacl = async (p: string): Promise<string[]> => {
  const r = await pwsh([
    "-Command",
    [
      `$s = (Get-Item -LiteralPath '${p}' -Force).GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)`,
      `$raw = New-Object System.Security.AccessControl.RawSecurityDescriptor -ArgumentList @($s.GetSecurityDescriptorBinaryForm(), 0)`,
      `'protected=' + (($raw.ControlFlags -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclProtected) -ne 0)`,
      `foreach ($a in $raw.DiscretionaryAcl) { '{0} {1} 0x{2:x} {3}' -f $a.AceType, $a.SecurityIdentifier, $a.AccessMask, $a.AceFlags }`,
    ].join("; "),
  ]);
  const lines = r.out.split(/\r?\n/).filter((x) => x !== "");
  return [lines[0]!, ...lines.slice(1).sort()];
};
const FULL = "0x1f01ff";
const RX = "0x1200a9";
const three = (flags: string) =>
  [
    `AccessAllowed S-1-5-18 ${FULL} ${flags}`,
    `AccessAllowed S-1-5-32-544 ${FULL} ${flags}`,
    `AccessAllowed S-1-5-32-545 ${RX} ${flags}`,
  ].sort();
/** An explicit conditional (callback) allow ACE: Authenticated Users full control. */
const plantConditional = (p: string) =>
  pwsh([
    "-Command",
    [
      `$i = Get-Item -LiteralPath '${p}' -Force`,
      `$s = $i.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)`,
      `$s.SetSecurityDescriptorSddlForm('D:(A;;FA;;;SY)(A;;FA;;;BA)(XA;;FA;;;AU;(Member_of {SID(BA)}))', [System.Security.AccessControl.AccessControlSections]::Access)`,
      `$i.SetAccessControl($s)`,
    ].join("; "),
  ]);

Deno.test({
  name:
    "H-01t: cg-lockdown leaves the exact DACL: protected roots with SYSTEM F, Administrators F, Users RX (OI|CI on directories), children inheriting only those",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const dir = await Deno.makeTempDir({ prefix: "cg-lockdown-h01t-" });
    const file = `${dir}\\run.ps1`;
    const tree = `${dir}\\Git`;
    await Deno.mkdir(`${tree}\\usr\\bin`, { recursive: true });
    await Deno.writeTextFile(file, "exit 0");
    await Deno.writeTextFile(`${tree}\\usr\\bin\\cg-al`, "#!/bin/sh");
    const s = await pwsh([
      "-Command",
      `icacls '${tree}\\usr' /grant '*S-1-5-11:(OI)(CI)M' /Q; exit $LASTEXITCODE`,
    ]);
    assertEquals(s.code, 0, s.out);
    try {
      const r = await pwsh(["-File", LOCKDOWN, file, tree]);
      for (
        const f of r.out.split(/\r?\n/).filter((x) => x.startsWith("[FAIL]"))
      ) {
        assert(f.startsWith("[FAIL] owner "), f);
      }
      assertEquals(await rawDacl(file), ["protected=True", ...three("None")]);
      assertEquals(await rawDacl(tree), [
        "protected=True",
        ...three("ObjectInherit, ContainerInherit"),
      ]);
      assertEquals(await rawDacl(`${tree}\\usr`), [
        "protected=False",
        ...three("ObjectInherit, ContainerInherit, Inherited"),
      ]);
      assertEquals(await rawDacl(`${tree}\\usr\\bin\\cg-al`), [
        "protected=False",
        ...three("Inherited"),
      ]);
    } finally {
      await dropTree(dir);
    }
  },
});

Deno.test({
  name:
    "H-01t: a conditional (callback) ACE is a [FAIL] in the verify pass and gone after cg-lockdown (fresh DACL)",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const dir = await Deno.makeTempDir({ prefix: "cg-lockdown-h01t-" });
    const file = `${dir}\\cg-al.ps1`;
    await Deno.writeTextFile(file, "exit 0");
    const s = await plantConditional(file);
    assertEquals(s.code, 0, s.out);
    try {
      assert(
        (await rawDacl(file)).some((l) =>
          l.startsWith("AccessAllowedCallback S-1-5-11 ")
        ),
        "the conditional ACE is planted",
      );
      const v = await pwsh(["-File", LOCKDOWN, "-VerifyOnly", file]);
      assertEquals(v.code, 1, v.out);
      assertStringIncludes(
        v.out,
        `[FAIL] ace AccessAllowedCallback S-1-5-11 ${file}`,
      );
      await pwsh(["-File", LOCKDOWN, file]);
      assertEquals(await rawDacl(file), ["protected=True", ...three("None")]);
    } finally {
      await dropTree(dir);
    }
  },
});

Deno.test({
  name:
    "H-01t: a junction inside a supplied tree is refused before any ACL changes (target untouched) and is a [FAIL] in the verify pass",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const dir = await Deno.makeTempDir({ prefix: "cg-lockdown-h01t-" });
    const tree = `${dir}\\Git`;
    const outside = `${dir}\\outside`;
    const link = `${tree}\\usr\\link`;
    await Deno.mkdir(`${tree}\\usr`, { recursive: true });
    await Deno.mkdir(outside);
    await Deno.writeTextFile(`${outside}\\secret.txt`, "x");
    const s = await pwsh([
      "-Command",
      [
        `icacls '${outside}' /grant '*S-1-5-11:(OI)(CI)M' /Q`,
        `if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`,
        `icacls '${tree}' /grant '*S-1-5-11:(OI)(CI)M' /Q`,
        `if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`,
        `New-Item -ItemType Junction -Path '${link}' -Target '${outside}' | Out-Null`,
      ].join("; "),
    ]);
    assertEquals(s.code, 0, s.out);
    const before = {
      tree: await rawDacl(tree),
      outside: await rawDacl(outside),
      secret: await rawDacl(`${outside}\\secret.txt`),
    };
    try {
      const r = await pwsh(["-File", LOCKDOWN, tree]);
      assert(r.code !== 0, r.out);
      assertStringIncludes(r.out, `reparse point ${link}`);
      assertEquals(
        {
          tree: await rawDacl(tree),
          outside: await rawDacl(outside),
          secret: await rawDacl(`${outside}\\secret.txt`),
        },
        before,
        "nothing changed before the refusal",
      );
      const v = await pwsh(["-File", LOCKDOWN, "-VerifyOnly", tree]);
      assertEquals(v.code, 1, v.out);
      assertStringIncludes(v.out, `[FAIL] reparse ${link}`);
      assert(
        !v.out.includes("secret.txt"),
        "the verify pass does not walk through the link",
      );
    } finally {
      await pwsh(["-Command", `[System.IO.Directory]::Delete('${link}')`]);
      await dropTree(dir);
    }
  },
});
