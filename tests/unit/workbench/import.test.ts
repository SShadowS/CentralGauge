import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  importPromotedTask,
  listPromotedTasks,
} from "../../../src/workbench/import.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

const TASK_YML = `id: CG-AL-X090
prompt_template: code-gen.md
fix_template: bugfix.md
max_attempts: 2
description: test fixture
domains:
  - codeunits
metrics:
  - compile_pass
metadata:
  category: business-logic
  tags: []
  difficulty: hard
  cohort: ado-trap-2026
  origin: hand-authored
expected:
  compile: true
  testApp: tests/al/hard/CG-AL-X090.Test.al
  testCodeunitId: 88900
`;

async function seedRepo(
  root: string,
  opts?: { prereq?: boolean; companion?: boolean; legacy?: boolean },
) {
  await Deno.mkdir(join(root, "tasks/hard"), { recursive: true });
  await Deno.mkdir(join(root, "tests/al/hard"), { recursive: true });
  await Deno.writeTextFile(
    join(root, "tasks/hard/CG-AL-X090-fixture-slug.yml"),
    TASK_YML,
  );
  await Deno.writeTextFile(
    join(root, "tests/al/hard/CG-AL-X090.Test.al"),
    'codeunit 88900 "T" {}',
  );
  if (opts?.companion) {
    await Deno.writeTextFile(
      join(root, "tests/al/hard/CG-AL-X090.Helper.al"),
      'enum 70900 "H" {}',
    );
  }
  if (opts?.prereq) {
    await Deno.mkdir(join(root, "tests/al/dependencies/CG-AL-X090"), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(root, "tests/al/dependencies/CG-AL-X090/app.json"),
      "{}",
    );
  }
  if (opts?.legacy) {
    // A legacy (non-X-series) promoted task - listPromotedTasks must omit
    // it, and importPromotedTask must refuse it early.
    await Deno.mkdir(join(root, "tasks/easy"), { recursive: true });
    await Deno.writeTextFile(
      join(root, "tasks/easy/CG-AL-E900-legacy-fixture.yml"),
      "id: CG-AL-E900\n",
    );
  }
}

Deno.test("importPromotedTask", async (t) => {
  await t.step(
    "copies yml, oracle, companion, prereq into a draft and records importedFrom",
    async () => {
      const root = await createTempDir("wb-import");
      try {
        await seedRepo(root, { prereq: true, companion: true });
        const scratch = join(root, "scratch");
        const res = await importPromotedTask("CG-AL-X090", {
          repoRoot: root,
          scratchRoot: scratch,
        });

        assertEquals(res.id, "CG-AL-X090");
        assert(await Deno.stat(join(scratch, "CG-AL-X090/task.yml")));
        assert(
          await Deno.stat(
            join(scratch, "CG-AL-X090/correct/CG-AL-X090.Test.al"),
          ),
        );
        assert(
          await Deno.stat(
            join(scratch, "CG-AL-X090/correct/CG-AL-X090.Helper.al"),
          ),
        );
        assert(await Deno.stat(join(scratch, "CG-AL-X090/correct/app.json")));
        assert(await Deno.stat(join(scratch, "CG-AL-X090/naive/app.json")));
        assert(await Deno.stat(join(scratch, "CG-AL-X090/prereq/app.json")));

        const meta = JSON.parse(
          await Deno.readTextFile(join(scratch, "CG-AL-X090/.meta.json")),
        );
        assertEquals(
          meta.importedFrom.taskYml,
          "tasks/hard/CG-AL-X090-fixture-slug.yml",
        );
        assertEquals(
          meta.importedFrom.testFile,
          "tests/al/hard/CG-AL-X090.Test.al",
        );
        assertEquals(meta.importedFrom.companions, [
          "tests/al/hard/CG-AL-X090.Helper.al",
        ]);
        assertEquals(
          meta.importedFrom.prereqDir,
          "tests/al/dependencies/CG-AL-X090",
        );
        assertEquals(meta.slug, "fixture-slug");
        assertEquals(meta.testCodeunitId, 88900);
        assertEquals(meta.withPrereq, true);
      } finally {
        await cleanupTempDir(root);
      }
    },
  );

  await t.step(
    "works without prereq or companions (importedFrom.prereqDir null, companions [])",
    async () => {
      const root = await createTempDir("wb-import");
      try {
        await seedRepo(root);
        const res = await importPromotedTask("CG-AL-X090", {
          repoRoot: root,
          scratchRoot: join(root, "scratch"),
        });
        assertEquals(res.importedFrom.prereqDir, null);
        assertEquals(res.importedFrom.companions, []);
      } finally {
        await cleanupTempDir(root);
      }
    },
  );

  await t.step("refuses when the draft dir already exists", async () => {
    const root = await createTempDir("wb-import");
    try {
      await seedRepo(root);
      const scratch = join(root, "scratch");
      await Deno.mkdir(join(scratch, "CG-AL-X090"), { recursive: true });
      await assertRejects(
        () =>
          importPromotedTask("CG-AL-X090", {
            repoRoot: root,
            scratchRoot: scratch,
          }),
        Error,
        "already exists",
      );
    } finally {
      await cleanupTempDir(root);
    }
  });

  await t.step("throws a naming error for an unknown id", async () => {
    const root = await createTempDir("wb-import");
    try {
      await seedRepo(root);
      await assertRejects(
        () =>
          importPromotedTask("CG-AL-X999", {
            repoRoot: root,
            scratchRoot: join(root, "scratch"),
          }),
        Error,
        "CG-AL-X999",
      );
    } finally {
      await cleanupTempDir(root);
    }
  });

  await t.step(
    "rejects a legacy (non-X-series) id before touching the filesystem, without creating a scratch dir",
    async () => {
      const root = await createTempDir("wb-import");
      try {
        await seedRepo(root, { legacy: true });
        const scratch = join(root, "scratch");
        await assertRejects(
          () =>
            importPromotedTask("CG-AL-E900", {
              repoRoot: root,
              scratchRoot: scratch,
            }),
          Error,
          "Only X-series",
        );
        await assertRejects(
          () => Deno.stat(join(scratch, "CG-AL-E900")),
          Deno.errors.NotFound,
        );
      } finally {
        await cleanupTempDir(root);
      }
    },
  );
});

Deno.test("listPromotedTasks returns id/slug/difficulty from tasks/**", async () => {
  const root = await createTempDir("wb-import");
  try {
    await seedRepo(root, { legacy: true });
    const list = await listPromotedTasks(root);
    assertEquals(list, [{
      id: "CG-AL-X090",
      slug: "fixture-slug",
      difficulty: "hard",
    }]);
  } finally {
    await cleanupTempDir(root);
  }
});
