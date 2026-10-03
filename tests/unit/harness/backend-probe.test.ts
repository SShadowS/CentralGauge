import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  assertMountContained,
  exportProxyLog,
  parseProbeArgs,
  probeExitCode,
  runThenExport,
} from "../../../scripts/harness/backend-probe.ts";

/** A sandbox that ran to exit 0 and was cleaned up. */
const OK = {
  exitCode: 0,
  timedOut: false,
  confirmedGone: true,
  cleanup: "ok",
};

Deno.test("backend-probe args: positional only keeps the M1-28 defaults", async () => {
  assertEquals(await parseProbeArgs(["Cronus281", "C:\\s"]), {
    container: "Cronus281",
    secretsDir: "C:\\s",
    enforced: false,
    command: null,
    withholdToken: false,
    image: null,
    hosts: null,
    mount: null,
    claudeOauth: false,
  });
});

Deno.test("backend-probe args: --image and --route (M3-08) resolve the route's hosts", async () => {
  assertEquals(
    await parseProbeArgs([
      "Cronus281",
      "C:\\s",
      "--enforced",
      "--image",
      "sha256:abc",
      "--route",
      "openrouter:api-key",
    ]),
    {
      container: "Cronus281",
      secretsDir: "C:\\s",
      enforced: true,
      command: null,
      withholdToken: false,
      image: "sha256:abc",
      hosts: ["openrouter.ai"],
      mount: null,
      claudeOauth: false,
    },
  );
  await assertRejects(() =>
    parseProbeArgs(["C", "S", "--route", "openrouter:api-key"])
  );
  await assertRejects(() =>
    parseProbeArgs(["C", "S", "--enforced", "--route", "nope:x"])
  );
  await assertRejects(() => parseProbeArgs(["C", "S", "--image"]));
});

Deno.test("backend-probe args: --enforced, --command-file (JSON string array) and --withhold-token", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const f = join(dir, "cmd.json");
    await Deno.writeTextFile(
      f,
      JSON.stringify(["powershell", "-Command", 'a "b"']),
    );
    assertEquals(
      await parseProbeArgs([
        "--enforced",
        "Cronus281",
        "C:\\s",
        "--command-file",
        f,
        "--withhold-token",
      ]),
      {
        container: "Cronus281",
        secretsDir: "C:\\s",
        enforced: true,
        command: ["powershell", "-Command", 'a "b"'],
        withholdToken: true,
        image: null,
        hosts: null,
        mount: null,
        claudeOauth: false,
      },
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("backend-probe args: a command file that is not a non-empty string array is refused", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const f = join(dir, "cmd.json");
    for (const bad of ["[]", "[1]", "{}", '"x"']) {
      await Deno.writeTextFile(f, bad);
      await assertRejects(() =>
        parseProbeArgs(["C", "S", "--command-file", f])
      );
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("backend-probe args: missing positionals, a missing flag value or an unknown flag are refused", async () => {
  await assertRejects(() => parseProbeArgs(["Cronus281"]));
  await assertRejects(() => parseProbeArgs(["C", "S", "--bogus"]));
  await assertRejects(() => parseProbeArgs(["C", "S", "--command-file"]));
});

Deno.test("backend-probe args: --mount takes an absolute dir under H:\\cg-coord\\m9\\ only (M9-01a)", async () => {
  const ok = await parseProbeArgs([
    "C",
    "S",
    "--mount",
    "H:\\cg-coord\\m9\\spike-01\\probe",
  ]);
  assertEquals(ok.mount, "H:\\cg-coord\\m9\\spike-01\\probe");
  assertEquals(
    (await parseProbeArgs([
      "C",
      "S",
      "--mount",
      "h:/CG-COORD/m9/spike-01/probe/",
    ]))
      .mount,
    "h:\\CG-COORD\\m9\\spike-01\\probe",
  );
  for (
    const bad of [
      "H:\\cg-coord\\m9",
      "H:\\cg-coord\\m9\\",
      "H:\\cg-coord\\m9x\\a",
      "H:\\cg-coord\\m9\\..\\tasks",
      "H:\\cg-coord\\tasks\\M9-01",
      "probe",
      "m9\\spike-01",
      "C:\\cg-coord\\m9\\a",
    ]
  ) {
    await assertRejects(
      () => parseProbeArgs(["C", "S", "--mount", bad]),
      Error,
      "--mount",
      bad,
    );
  }
  await assertRejects(() => parseProbeArgs(["C", "S", "--mount"]));
});

Deno.test("backend-probe args: --claude-oauth needs --enforced (M9-01a)", async () => {
  await assertRejects(
    () => parseProbeArgs(["C", "S", "--claude-oauth"]),
    Error,
    "--claude-oauth needs --enforced",
  );
  assertEquals(
    (await parseProbeArgs(["C", "S", "--enforced", "--claude-oauth"]))
      .claudeOauth,
    true,
  );
});

Deno.test("backend-probe args: --claude-oauth refuses any route but the first-party Anthropic one (M9-01a run 002)", async () => {
  await assertRejects(
    () =>
      parseProbeArgs([
        "C",
        "S",
        "--enforced",
        "--claude-oauth",
        "--route",
        "openrouter:api-key",
      ]),
    Error,
    "--claude-oauth needs the first-party Anthropic route",
  );
});

Deno.test({
  name:
    "backend-probe mount: a real dir under the root passes; a junction at or under it is refused (M9-01a run 002)",
  ignore: Deno.build.os !== "windows",
  fn: async () => {
    const root = await Deno.makeTempDir();
    const outside = await Deno.makeTempDir();
    try {
      const ok = join(root, "spike", "probe");
      await Deno.mkdir(join(ok, "sub"), { recursive: true });
      await Deno.writeTextFile(join(ok, "sub", "f.txt"), "x");
      assertEquals(await assertMountContained(ok, root), ok);
      const mklink = async (link: string, target: string) => {
        const o = await new Deno.Command("cmd", {
          args: ["/c", "mklink", "/J", link, target],
          stdout: "null",
          stderr: "null",
        }).output();
        assertEquals(o.code, 0, `mklink /J ${link}`);
      };
      // A junction below the mount points outside the root.
      await mklink(join(ok, "sub", "escape"), outside);
      await assertRejects(
        () => assertMountContained(ok, root),
        Error,
        "reparse point",
      );
      // The mount itself (or an ancestor under the root) is a junction.
      const j = join(root, "jdir");
      await mklink(j, outside);
      await assertRejects(
        () => assertMountContained(j, root),
        Error,
        "reparse point",
      );
      // Not under the root at all.
      await assertRejects(
        () => assertMountContained(outside, root),
        Error,
        "under",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
      await Deno.remove(outside, { recursive: true });
    }
  },
});

Deno.test("backend-probe proxy log export: allowed-host lines only, denied targets reduced to counts (M9-01a run 002)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const src = join(dir, "egress.jsonl");
    const secret = "sk-ant-oat01-secretvalue0123456789";
    await Deno.writeTextFile(
      src,
      [
        {
          at: "t1",
          decision: "allow",
          target: "api.anthropic.com:443",
          reason: "allowed",
          extra: "x",
        },
        {
          at: "t2",
          decision: "deny",
          target: `${secret}:443`,
          reason: "host not allowed",
        },
        {
          at: "t3",
          decision: "deny",
          target: "1.1.1.1:443",
          reason: "ip literal",
        },
        {
          at: "t4",
          decision: "allow",
          target: "evil.example:443",
          reason: "allowed",
        },
      ].map((l) => JSON.stringify(l)).join("\n") + "\nnot json\n",
    );
    const dst = join(dir, "out", "egress-proxy.jsonl");
    assertEquals(await exportProxyLog(src, dst, ["api.anthropic.com"]), []);
    const text = await Deno.readTextFile(dst);
    assertEquals(text.includes(secret), false);
    assertEquals(text.includes("evil.example"), false);
    const lines = text.trim().split("\n").map((l) => JSON.parse(l));
    assertEquals(lines, [
      { at: "t1", decision: "allow", target: "api.anthropic.com:443" },
      { summary: true, allowed: 1, withheld: 4 },
    ]);
    // A missing source is a problem (the caller turns it into a non-zero exit).
    const p = await exportProxyLog(join(dir, "nope.jsonl"), dst, [
      "api.anthropic.com",
    ]);
    assertEquals(p.length, 1);
    assertStringIncludes(p[0]!, "proxy log not exported");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("backend-probe export gate: nothing is exported unless the probe returned (scrub done) (M9-01a run 003)", async () => {
  let exported = 0;
  const exportLog = () => {
    exported++;
    return Promise.resolve([]);
  };
  // The probe throws (teardown or scrub failure): no export, the error propagates.
  await assertRejects(
    () =>
      runThenExport(
        () => Promise.reject(new Error("capture scrub failed: x")),
        exportLog,
      ),
    Error,
    "capture scrub failed",
  );
  assertEquals(exported, 0);
  // The probe returned: the export runs once and its problems come back.
  const r = await runThenExport(
    () => Promise.resolve({ problems: [], sandbox: OK }),
    () => {
      exported++;
      return Promise.resolve(["proxy log not exported: y"]);
    },
  );
  assertEquals(exported, 1);
  assertEquals(r.exportProblems, ["proxy log not exported: y"]);
  assertEquals(
    probeExitCode({
      problems: [...r.result.problems, ...r.exportProblems],
      sandbox: r.result.sandbox,
    }),
    1,
  );
});

Deno.test("backend-probe exit code: non-zero on any preflight problem or a sandbox that did not exit 0", () => {
  const ok = OK;
  assertEquals(probeExitCode({ problems: [], sandbox: ok }), 0);
  assertEquals(probeExitCode({ problems: ["listeners: x"], sandbox: ok }), 1);
  assertEquals(probeExitCode({ problems: ["preflight"], sandbox: null }), 1);
  assertEquals(probeExitCode({ problems: [], sandbox: null }), 1);
  assertEquals(
    probeExitCode({ problems: [], sandbox: { ...OK, exitCode: 3 } }),
    1,
  );
});

Deno.test("backend-probe exit code: exit 0 is not enough when the sandbox timed out, is not confirmed gone, or left a cleanup problem (M3-07c)", () => {
  for (
    const bad of [
      { ...OK, timedOut: true },
      { ...OK, confirmedGone: false },
      { ...OK, cleanup: "container still present" },
    ]
  ) {
    assertEquals(
      probeExitCode({ problems: [], sandbox: bad }),
      1,
      JSON.stringify(bad),
    );
  }
});

Deno.test("backend-probe: --enforced with --withhold-token is refused before any environment is opened (M3-07c)", async () => {
  const o = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-all",
      "scripts/harness/backend-probe.ts",
      "--enforced",
      "cg-no-such-container",
      "C:\\cg-no-such-secrets",
      "--withhold-token",
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const err = new TextDecoder().decode(o.stderr);
  assertEquals(o.code !== 0, true, err);
  assertStringIncludes(err, "--withhold-token is not for --enforced runs");
});
