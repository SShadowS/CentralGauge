/**
 * H-35 (ruling r5, "verify the cached package's target"): the manifest target
 * of a real compiled .app (NAVX header + zip, NavxManifest.xml deflated).
 * Fixtures: tests/fixtures/harness/packages/target-{cloud,onprem}.app, built by
 * alc 17 from a one-codeunit app with "target" Cloud and OnPrem.
 */

import { assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { packageManifestTarget } from "../../../src/container/app-package.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

const dir = fromFileUrl(
  new URL("../../fixtures/harness/packages/", import.meta.url),
);

Deno.test("H-35: the manifest target of a real Cloud and a real OnPrem package", async () => {
  assertEquals(
    await packageManifestTarget(join(dir, "target-cloud.app")),
    "Cloud",
  );
  assertEquals(
    await packageManifestTarget(join(dir, "target-onprem.app")),
    "OnPrem",
  );
});

Deno.test("H-35: a file that is not a NAVX package, or a truncated one, has no target (null, so a Cloud check refuses it)", async () => {
  const t = await testTempDir();
  const json = join(t, "fake.app");
  await Deno.writeTextFile(json, JSON.stringify({ target: "Cloud" }));
  assertEquals(await packageManifestTarget(json), null);
  const bytes = await Deno.readFile(join(dir, "target-cloud.app"));
  const cut = join(t, "cut.app");
  await Deno.writeFile(cut, bytes.subarray(0, bytes.length - 30));
  assertEquals(await packageManifestTarget(cut), null);
});
