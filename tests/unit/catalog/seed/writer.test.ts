import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse as parseYaml } from "@std/yaml";
import { ensureFamily } from "../../../../src/catalog/seed/writer.ts";
import { CatalogSeedError } from "../../../../src/errors.ts";
import { cleanupTempDir, createTempDir } from "../../../utils/test-helpers.ts";

describe("ensureFamily", () => {
  it("appends a new family row when slug not present", async () => {
    const dir = await createTempDir("seed-family");
    const path = `${dir}/model-families.yml`;
    await Deno.writeTextFile(
      path,
      `# header
- slug: claude
  vendor: Anthropic
  display_name: Claude
`,
    );

    try {
      const result = await ensureFamily(path, {
        slug: "grok",
        vendor: "xAI",
        display_name: "Grok",
      });
      assertEquals(result.added, true);

      const content = await Deno.readTextFile(path);
      const parsed = parseYaml(content) as Array<Record<string, string>>;
      assertEquals(parsed.length, 2);
      assertEquals(parsed[1]?.["slug"], "grok");
      assertEquals(parsed[1]?.["vendor"], "xAI");

      // Header comment preserved
      assertEquals(content.startsWith("# header"), true);
    } finally {
      await cleanupTempDir(dir);
    }
  });

  it(
    "returns added=false and writes nothing when family slug already present",
    async () => {
      const dir = await createTempDir("seed-family-skip");
      const path = `${dir}/model-families.yml`;
      const original = `- slug: claude
  vendor: Anthropic
  display_name: Claude
`;
      await Deno.writeTextFile(path, original);

      try {
        const result = await ensureFamily(path, {
          slug: "claude",
          vendor: "Anthropic",
          display_name: "Claude",
        });
        assertEquals(result.added, false);

        const content = await Deno.readTextFile(path);
        assertEquals(content, original);
      } finally {
        await cleanupTempDir(dir);
      }
    },
  );

  it("throws SEED_YAML_WRITE when target directory does not exist", async () => {
    const path = "/nonexistent-dir-for-seed-test-b4/model-families.yml";

    let caught: unknown = null;
    try {
      await ensureFamily(path, {
        slug: "test",
        vendor: "Test",
        display_name: "Test",
      });
    } catch (e) {
      caught = e;
    }
    assertEquals(caught instanceof CatalogSeedError, true);
    assertEquals((caught as CatalogSeedError).code, "SEED_YAML_WRITE");
  });
});
