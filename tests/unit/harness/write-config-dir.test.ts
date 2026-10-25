import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { writeConfigDir } from "../../../src/harness/execution.ts";
import { hashTree } from "../../../src/harness/hash.ts";
import { manifest } from "./fixtures.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

Deno.test("writeConfigDir (R-02): a plugin is staged as bundle/plugins/<folder name>, the name the image and init use", async () => {
  const root = await testTempDir({ prefix: "cg-wcd-" });
  const plugin = join(root, "bundles", "toyplug");
  await Deno.mkdir(join(plugin, "skills", "toy-review"), { recursive: true });
  await Deno.writeTextFile(
    join(plugin, "skills", "toy-review", "SKILL.md"),
    "skill\n",
  );
  const m = manifest("cc", {
    plugins: [{
      path: "bundles/toyplug",
      hash: await hashTree(plugin, "bundle"),
      files: [],
    }],
  });
  const out = join(root, "out");
  await writeConfigDir(root, out, m);
  assertEquals(
    await Deno.readTextFile(
      join(
        out,
        "bundle",
        "plugins",
        "toyplug",
        "skills",
        "toy-review",
        "SKILL.md",
      ),
    ),
    "skill\n",
  );
  const staged = [...Deno.readDirSync(join(out, "bundle", "plugins"))].map((
    e,
  ) => e.name);
  assertEquals(staged, ["toyplug"]);
  assert(!staged.includes("0"));
});
