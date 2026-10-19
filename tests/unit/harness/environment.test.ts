import { assert, assertEquals, assertRejects } from "@std/assert";

import {
  checkEnvironments,
  createBaseline,
  envFpOf,
  instanceManifestPath,
  readInstanceManifest,
  renderEnvCheck,
} from "../../../src/harness/environment.ts";
import { hashJson } from "../../../src/harness/hash.ts";
import { FakeBc, OK_RESET } from "./fake-bc.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

const COMPAT = {
  lineage: { id: "golden-test", golden_sha256: "a".repeat(64) },
};
const MECH = {
  ...OK_RESET,
  id: "golden-restore",
  compat: COMPAT,
  fsDigest: () => Promise.resolve([]),
};
const LOCK = "b".repeat(64);

Deno.test("H-35 S3.4 envFpOf: hashJson of compat, mechanism, lock digest and compiler identity", async () => {
  assertEquals(
    await envFpOf({
      compat: COMPAT,
      mechanism: "golden-restore",
      lockDigest: LOCK,
      compiler: "c1",
    }),
    await hashJson({
      compat: COMPAT,
      mechanism: "golden-restore",
      symbols_lock: LOCK,
      compiler: "c1",
    }),
  );
});

Deno.test("H-35 S3.4 createBaseline: resets the container, then writes its instance manifest naming the lineage and the env_fp; a failed reset writes none", async () => {
  const root = await Deno.realPath(await testTempDir());
  const bc = new FakeBc();
  const m = await createBaseline(bc, MECH, "C1", {
    resultsRoot: root,
    lineageId: "golden-test",
    lockDigest: LOCK,
  });
  assertEquals(m.container, "C1");
  assertEquals(m.lineage_id, "golden-test");
  assertEquals(
    m.env_fp,
    await envFpOf({
      compat: COMPAT,
      mechanism: "golden-restore",
      lockDigest: LOCK,
      compiler: await bc.harnessCompilerIdentity("C1"),
    }),
  );
  assertEquals(await readInstanceManifest(root, "C1"), m);
  const failing = {
    ...MECH,
    reset: (c: string) =>
      OK_RESET.reset(c).then((r) => ({
        ...r,
        ok: false,
        failed_step: "restore",
        error: "x",
      })),
  };
  await assertRejects(
    () =>
      createBaseline(bc, failing, "C2", {
        resultsRoot: root,
        lineageId: "golden-test",
        lockDigest: LOCK,
      }),
    Error,
    "reset of C2 failed at restore",
  );
  assertEquals(await readInstanceManifest(root, "C2"), null);
});

Deno.test("H-35 S3.4 checkEnvironments: admissible only when every container's manifest names the lineage and its env_fp equals the live one, all sharing one", async () => {
  const root = await Deno.realPath(await testTempDir());
  const bc = new FakeBc();
  const o = { resultsRoot: root, lineageId: "golden-test", lockDigest: LOCK };
  await createBaseline(bc, MECH, "C1", o);
  await createBaseline(bc, MECH, "C2", o);
  const ok = await checkEnvironments(bc, MECH, ["C1", "C2"], o);
  assert(ok.admissible);
  assertEquals(new Set(ok.rows.map((r) => r.env_fp)).size, 1);
  assert(renderEnvCheck(ok).includes("[OK]"));
  // No manifest for C3: not admissible.
  const missing = await checkEnvironments(bc, MECH, ["C1", "C3"], o);
  assertEquals(missing.admissible, false);
  assertEquals(missing.rows[1]!.why, "no instance manifest");
  // Another lineage named in the manifest.
  const other = await checkEnvironments(bc, MECH, ["C1"], {
    ...o,
    lineageId: "golden-other",
  });
  assertEquals(other.admissible, false);
  // The live compiler changed since the baseline (stale manifest).
  bc.compilerId = "upgraded";
  const stale = await checkEnvironments(bc, MECH, ["C1"], o);
  assertEquals(stale.admissible, false);
  assert(stale.rows[0]!.why!.includes("env_fp"));
  // A tampered manifest file is refused, not trusted.
  await Deno.writeTextFile(instanceManifestPath(root, "C2"), "{");
  const bad = await checkEnvironments(bc, MECH, ["C2"], o);
  assertEquals(bad.admissible, false);
});

Deno.test("H-35 S3 L4: a lineage without an fs section (L4 not configured) is not admissible, whatever its containers", async () => {
  const root = await Deno.realPath(await testTempDir());
  const bc = new FakeBc();
  const o = { resultsRoot: root, lineageId: "golden-test", lockDigest: LOCK };
  const { fsDigest: _, ...noL4 } = MECH;
  await createBaseline(bc, noL4, "C1", o);
  const c = await checkEnvironments(bc, noL4, ["C1"], o);
  assertEquals(c.admissible, false);
  assertEquals(c.rows[0]!.why, null);
  assert(c.refusal?.includes("L4"));
  assert(renderEnvCheck(c).includes(c.refusal!));
});
