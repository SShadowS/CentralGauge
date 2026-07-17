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
domains: [codeunits]
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

  it("rejects a manifest with no domains field (now required)", async () => {
    const yaml = `
id: CG-AL-H999
prompt_template: code-gen.md
fix_template: bugfix.md
max_attempts: 2
description: Missing domains should now fail.
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

  // T9: passthrough previously swallowed typos silently — a typo'd
  // `expected.mustContian` (missing the 'a') would just be ignored, and the
  // task would run with mustContain unset, no error, no signal to the
  // author. .strict() must now name the offending key.
  it("rejects a manifest with a typo'd key inside expected (T9)", async () => {
    const yaml = `
id: CG-AL-H999
prompt_template: code-gen.md
fix_template: bugfix.md
max_attempts: 2
description: Typo'd expected key should fail loudly.
domains: [codeunits]
expected:
  compile: true
  mustContian:
    - procedure Foo
metrics:
  - compile_pass
`;
    await withTempManifest(yaml, async (p) => {
      const err = await assertRejects(() => loadTaskManifest(p), Error);
      assertStringIncludes(err.message, "mustContian");
    });
  });

  it("rejects a manifest with an unknown top-level key (T9)", async () => {
    const yaml = `
id: CG-AL-H999
prompt_template: code-gen.md
fix_template: bugfix.md
max_attempts: 2
description: Unknown top-level key should fail loudly.
domains: [codeunits]
expected:
  compile: true
metrics:
  - compile_pass
autor: someone
`;
    await withTempManifest(yaml, async (p) => {
      const err = await assertRejects(() => loadTaskManifest(p), Error);
      assertStringIncludes(err.message, "autor");
    });
  });

  it("still accepts metadata with unlisted passthrough keys (T9)", async () => {
    const yaml = `
id: CG-AL-H999
prompt_template: code-gen.md
fix_template: bugfix.md
max_attempts: 2
description: metadata stays passthrough per T9.
domains: [codeunits]
expected:
  compile: true
metrics:
  - compile_pass
metadata:
  difficulty: hard
  cohort: ado-trap-2026
  origin: pr-mined
`;
    await withTempManifest(yaml, async (p) => {
      const m = await loadTaskManifest(p);
      assertEquals(
        (m.metadata as unknown as Record<string, unknown>)["cohort"],
        "ado-trap-2026",
      );
    });
  });
});
