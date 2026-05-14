import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { readTasksFromDir } from "../../../../cli/commands/populate-task-set-command.ts";

async function writeTask(
  tasksDir: string,
  difficulty: string,
  fileName: string,
  yaml: string,
): Promise<void> {
  const dir = join(tasksDir, difficulty);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(join(dir, fileName), yaml);
}

describe("readTasksFromDir domains extraction", () => {
  it("extracts the domains array onto the task row", async () => {
    const tasksDir = await Deno.makeTempDir({ prefix: "cg-pts-" });
    try {
      await writeTask(
        tasksDir,
        "easy",
        "CG-AL-E001.yml",
        `id: CG-AL-E001
prompt_template: code-gen.md
fix_template: bugfix.md
max_attempts: 2
description: Sample task for domains extraction.
domains: [tables, flowfields]
expected:
  compile: true
metrics:
  - compile_pass
`,
      );
      const rows = await readTasksFromDir(tasksDir);
      assertEquals(rows.length, 1);
      assertEquals(rows[0]!.task_id, "CG-AL-E001");
      assertEquals(rows[0]!.domains, ["tables", "flowfields"]);
    } finally {
      await Deno.remove(tasksDir, { recursive: true });
    }
  });

  it("defaults domains to an empty array when the key is absent", async () => {
    const tasksDir = await Deno.makeTempDir({ prefix: "cg-pts-" });
    try {
      await writeTask(
        tasksDir,
        "easy",
        "CG-AL-E002.yml",
        `id: CG-AL-E002
prompt_template: code-gen.md
fix_template: bugfix.md
max_attempts: 2
description: Sample task with no domains key.
expected:
  compile: true
metrics:
  - compile_pass
`,
      );
      const rows = await readTasksFromDir(tasksDir);
      assertEquals(rows[0]!.domains, []);
    } finally {
      await Deno.remove(tasksDir, { recursive: true });
    }
  });
});
