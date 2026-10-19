import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ConfigurationError } from "../../../src/errors.ts";
import { lineageCompat, loadLineage } from "../../../src/harness/lineage.ts";
import { goldenReset, RESET_PHASES } from "../../../src/harness/reset.ts";
import { sha256Hex } from "../../../src/harness/hash.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

const REPO_LINEAGE = "infra/harness-reset/lineages/golden-o09-v1.json";

Deno.test("H-35 S3.2 loadLineage: the shipped golden-o09-v1 lineage loads, its stored inventory hash-verified", async () => {
  const l = await loadLineage(REPO_LINEAGE);
  assertEquals(l.id, "golden-o09-v1");
  assertEquals(l.reset_policy_version, 1);
  assertEquals(l.runner.package_id, "ede0ce05-9ed6-42f2-bbb4-bfee95bb033a");
});

async function copyLineage(
  edit: (j: Record<string, unknown>) => void = () => {},
  inventory?: string,
) {
  const dir = await Deno.realPath(await testTempDir());
  const j = JSON.parse(await Deno.readTextFile(REPO_LINEAGE));
  edit(j);
  await Deno.writeTextFile(join(dir, "l.json"), JSON.stringify(j));
  await Deno.writeTextFile(
    join(dir, j.inventory.path),
    inventory ??
      await Deno.readTextFile(
        join("infra/harness-reset/lineages", j.inventory.path),
      ),
  );
  return join(dir, "l.json");
}

Deno.test("H-35 S3.2 loadLineage: a changed inventory, an unknown field or a missing one is refused (configuration, before any reset)", async () => {
  await assertRejects(
    async () => loadLineage(await copyLineage(() => {}, "tampered\n")),
    ConfigurationError,
    "inventory",
  );
  await assertRejects(
    async () => loadLineage(await copyLineage((j) => (j["extra"] = 1))),
    ConfigurationError,
  );
  await assertRejects(
    async () =>
      loadLineage(await copyLineage((j) => delete j["golden_sha256"])),
    ConfigurationError,
  );
});

Deno.test("H-35 S3.2 goldenReset: runs lane-ops' script per container with the lineage and a pinned docker context, and parses its markers", async () => {
  const lineagePath = await copyLineage();
  const lineage = await loadLineage(lineagePath);
  const calls: { cmd: string; args: string[]; env: Record<string, string> }[] =
    [];
  const m = goldenReset({
    repoRoot: "R",
    lineagePath,
    lineage,
    dockerEnv: { DOCKER_CONTEXT: "desktop-windows" },
    spawn: (cmd, args, env) => {
      calls.push({ cmd, args, env });
      return Promise.resolve({
        code: 0,
        stdout: [
          ...RESET_PHASES.map((p) => `RESET_STEP ${p} 5`),
          "RESET_OK",
        ].join("\r\n"),
      });
    },
  });
  assertEquals([m.id, m.policyVersion], ["golden-restore", 1]);
  const r = await m.reset("Cronus283");
  assert(r.ok);
  assertEquals(calls, [{
    cmd: "pwsh",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      join("R", "infra", "harness-reset", "reset-golden.ps1"),
      "-Container",
      "Cronus283",
      "-Lineage",
      lineagePath,
    ],
    env: { DOCKER_CONTEXT: "desktop-windows" },
  }]);
  // The script's own failure marker comes through.
  const failing = goldenReset({
    repoRoot: "R",
    lineagePath,
    lineage,
    dockerEnv: {},
    spawn: () =>
      Promise.resolve({
        code: 1,
        stdout: "RESET_FAILED snapshot_guard snapshot of CRONUS exists (1)",
      }),
  });
  assertEquals((await failing.reset("C1")).failed_step, "snapshot_guard");
});

Deno.test("H-35 S3.2 loadLineage: the stored inventory hash is sha256 of its bytes", async () => {
  const j = JSON.parse(await Deno.readTextFile(REPO_LINEAGE));
  const bytes = await Deno.readFile(
    join("infra/harness-reset/lineages", j.inventory.path),
  );
  assertEquals(await sha256Hex(bytes), j.inventory.sha256);
});

Deno.test("H-35 S3.3 lineageCompat: identity fields only (no credentials, no host path); goldenReset carries it as its compat", async () => {
  const lineagePath = await copyLineage();
  const lineage = await loadLineage(lineagePath);
  const compat = lineageCompat(lineage);
  assert(!("soap_password" in compat) && !("soap_user" in compat));
  assert(!("golden_path_template" in compat));
  assertEquals(compat["golden_sha256"], lineage.golden_sha256);
  assertEquals(compat["inventory"], lineage.inventory);
  const m = goldenReset({
    repoRoot: "R",
    lineagePath,
    lineage,
    dockerEnv: {},
    spawn: () => Promise.resolve({ code: 0, stdout: "" }),
  });
  assertEquals(m.compat, { lineage: compat });
});
