import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  parseProbeArgs,
  probeExitCode,
} from "../../../scripts/harness/backend-probe.ts";

Deno.test("backend-probe args: positional only keeps the M1-28 defaults", async () => {
  assertEquals(await parseProbeArgs(["Cronus281", "C:\\s"]), {
    container: "Cronus281",
    secretsDir: "C:\\s",
    enforced: false,
    command: null,
    withholdToken: false,
  });
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

Deno.test("backend-probe exit code: non-zero on any preflight problem or a sandbox that did not exit 0", () => {
  const ok = { exitCode: 0 };
  assertEquals(probeExitCode({ problems: [], sandbox: ok }), 0);
  assertEquals(probeExitCode({ problems: ["listeners: x"], sandbox: ok }), 1);
  assertEquals(probeExitCode({ problems: ["preflight"], sandbox: null }), 1);
  assertEquals(probeExitCode({ problems: [], sandbox: null }), 1);
  assertEquals(probeExitCode({ problems: [], sandbox: { exitCode: 3 } }), 1);
});
