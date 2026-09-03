import { assertEquals } from "@std/assert";
import { validateRepo } from "../../../.claude/skills/refresh-task-taxonomy/pipeline/validate-taxonomy.ts";
import { buildDraft } from "../../../.claude/skills/refresh-task-taxonomy/pipeline/build-taxonomy.ts";
import { emitCatalogYaml } from "../../../.claude/skills/refresh-task-taxonomy/pipeline/catalog-yaml.ts";

const opts = {
  tasksDir: "tests/fixtures/taxonomy/manifests",
  starterDir: "tests/fixtures/taxonomy/starter",
};

async function tmpCatalog(mutate?: (text: string) => string): Promise<string> {
  const { catalog } = await buildDraft(opts);
  const dir = await Deno.makeTempDir();
  const text = emitCatalogYaml(catalog);
  await Deno.writeTextFile(`${dir}/cat.yml`, mutate ? mutate(text) : text);
  await Deno.writeTextFile(
    `${dir}/counts.json`,
    JSON.stringify({
      "build-from-spec": 1,
      "runtime-trap": 1,
      "diagnose-single": 1,
      "diagnose-composite": 1,
    }),
  );
  return dir;
}

Deno.test("a manifest missing from the catalog, and a catalog task missing from the manifests, are reported", async () => {
  const dir = await tmpCatalog((t) =>
    t.replace(/  CG-AL-H001:[\s\S]*?min_bc_version: \d+\n/, "")
  );
  const { issues } = await validateRepo({
    catalogPath: `${dir}/cat.yml`,
    ...opts,
    expectedCountsPath: `${dir}/counts.json`,
  });
  assertEquals(issues.some((i) => i.code === "task_not_in_catalog"), true);
});

Deno.test("expected per-format counts are asserted", async () => {
  const dir = await tmpCatalog();
  await Deno.writeTextFile(
    `${dir}/counts.json`,
    JSON.stringify({ "build-from-spec": 7 }),
  );
  const { issues } = await validateRepo({
    catalogPath: `${dir}/cat.yml`,
    ...opts,
    expectedCountsPath: `${dir}/counts.json`,
  });
  assertEquals(issues.some((i) => i.code === "count_mismatch"), true);
});
