import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { loadTaskManifest } from "../../../src/tasks/loader.ts";

async function withTempManifest<T>(
  content: string,
  fn: (path: string) => Promise<T>,
): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: "cg-manifest-" });
  const path = join(dir, "task.yml");
  await Deno.writeTextFile(path, content);
  try {
    return await fn(path);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

describe("loadTaskManifest schema validation", () => {
  it("accepts a well-formed manifest", async () => {
    const yaml = `
id: CG-AL-H999
prompt_template: code-gen.md
fix_template: bugfix.md
max_attempts: 2
description: A valid manifest for schema testing.
expected:
  compile: true
  testApp: tests/al/hard/CG-AL-H999.Test.al
  testCodeunitId: 80999
metrics:
  - compile_pass
`;
    await withTempManifest(yaml, async (p) => {
      const m = await loadTaskManifest(p);
      if (m.id !== "CG-AL-H999") throw new Error("id mismatch");
    });
  });

  it("accepts a manifest with valid domains", async () => {
    const yaml = `
id: CG-AL-H999
prompt_template: code-gen.md
fix_template: bugfix.md
max_attempts: 2
description: A valid manifest with domains.
domains: [tables, flowfields]
expected:
  compile: true
metrics:
  - compile_pass
`;
    await withTempManifest(yaml, async (p) => {
      const m = await loadTaskManifest(p);
      assertEquals(m.domains, ["tables", "flowfields"]);
    });
  });

  it("rejects a manifest with an unknown domain value", async () => {
    const yaml = `
id: CG-AL-H999
prompt_template: code-gen.md
fix_template: bugfix.md
max_attempts: 2
description: Unknown domain value should fail.
domains: [tables, not-a-domain]
expected:
  compile: true
metrics:
  - compile_pass
`;
    await withTempManifest(yaml, async (p) => {
      const err = await assertRejects(() => loadTaskManifest(p), Error);
      assertStringIncludes(err.message, "domains.1");
    });
  });

  it("rejects a manifest with an empty domains array", async () => {
    const yaml = `
id: CG-AL-H999
prompt_template: code-gen.md
fix_template: bugfix.md
max_attempts: 2
description: Empty domains should fail.
domains: []
expected:
  compile: true
metrics:
  - compile_pass
`;
    await withTempManifest(yaml, async (p) => {
      const err = await assertRejects(() => loadTaskManifest(p), Error);
      assertStringIncludes(err.message, "domains");
    });
  });

  it("rejects manifest missing fix_template (the H048/H049 regression)", async () => {
    const yaml = `
id: CG-AL-H999
prompt_template: code-gen.md
max_attempts: 2
description: Missing fix_template field on purpose.
expected:
  compile: true
metrics:
  - compile_pass
`;
    await withTempManifest(yaml, async (p) => {
      const err = await assertRejects(
        () => loadTaskManifest(p),
        Error,
        "Invalid task manifest",
      );
      assertStringIncludes(err.message, "fix_template");
    });
  });

  it("rejects manifest with a malformed id", async () => {
    const yaml = `
id: NOT-A-CG-AL-ID
prompt_template: code-gen.md
fix_template: bugfix.md
max_attempts: 2
description: Bad id should fail schema.
expected:
  compile: true
metrics:
  - compile_pass
`;
    await withTempManifest(yaml, async (p) => {
      const err = await assertRejects(() => loadTaskManifest(p), Error);
      assertStringIncludes(err.message, "id");
    });
  });

  it("rejects manifest with non-positive max_attempts", async () => {
    const yaml = `
id: CG-AL-H999
prompt_template: code-gen.md
fix_template: bugfix.md
max_attempts: 0
description: Zero attempts is invalid.
expected:
  compile: true
metrics:
  - compile_pass
`;
    await withTempManifest(yaml, async (p) => {
      const err = await assertRejects(() => loadTaskManifest(p), Error);
      assertStringIncludes(err.message, "max_attempts");
    });
  });
});
