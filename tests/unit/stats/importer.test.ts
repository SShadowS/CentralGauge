/**
 * V5 + V10 — JsonImporter must derive taskSetHash from actual on-disk task
 * content (never a bare task ID), and must use a nullish (not falsy) guard
 * when deciding whether to recompute pass rates from raw results.
 */
import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertNotEquals } from "@std/assert";
import { join } from "@std/path";
import { JsonImporter } from "../../../src/stats/importer.ts";
import { InMemoryStorage } from "../../../src/stats/factory.ts";
import { resolveCurrentTaskSetHash } from "../../../src/ingest/catalog/task-set-hash.ts";

async function makeProjectRoot(): Promise<string> {
  const root = await Deno.makeTempDir();
  await Deno.mkdir(`${root}/tasks/easy`, { recursive: true });
  await Deno.writeTextFile(`${root}/tasks/easy/a.yml`, "id: CG-AL-E001");
  return root;
}

function minimalResultFile(overrides?: {
  results?: unknown[];
  stats?: Record<string, unknown>;
}): string {
  const results = overrides?.results ?? [
    {
      taskId: "CG-AL-E001",
      context: { llmProvider: "mock", llmModel: "mock-gpt-4" },
      attempts: [],
      success: true,
      finalScore: 100,
      totalTokensUsed: 0,
      totalCost: 0,
      totalDuration: 0,
      passedAttemptNumber: 1,
      successRate: 1,
    },
  ];
  const stats = overrides?.stats ?? {
    totalTokens: 0,
    totalCost: 0,
    totalDuration: 0,
    overallPassRate: 1,
    averageScore: 100,
    perModel: {},
    perTask: {},
  };
  return JSON.stringify({ results, stats });
}

describe("JsonImporter (V5/V10)", () => {
  it("V5: taskSetHash matches the canonical on-disk hash, not a bare task-id hash", async () => {
    const projectRoot = await makeProjectRoot();
    const resultsDir = await Deno.makeTempDir();
    try {
      const filePath = join(resultsDir, "benchmark-results-1700000000000.json");
      await Deno.writeTextFile(filePath, minimalResultFile());

      const importer = new JsonImporter(projectRoot);
      const storage = new InMemoryStorage();
      await storage.open();
      const imported = await importer.importFile(filePath, storage);
      assertEquals(imported, true);

      const run = await storage.getRun("1700000000000");
      const expectedHash = await resolveCurrentTaskSetHash(projectRoot);
      assertEquals(run?.taskSetHash, expectedHash);
      // Old behavior hashed `[{id:"CG-AL-E001", contentHash:"CG-AL-E001"}]`
      // through generateTaskSetHash — a fixed 16-char hex string derived
      // from nothing but the task id text. Guard against regressing to
      // something id-shaped instead of the real 64-char content hash.
      assertEquals(run?.taskSetHash.length, 64);
    } finally {
      await Deno.remove(projectRoot, { recursive: true });
      await Deno.remove(resultsDir, { recursive: true });
    }
  });

  it("V5: two runs against the same task content get the same taskSetHash", async () => {
    const projectRoot = await makeProjectRoot();
    const resultsDir = await Deno.makeTempDir();
    try {
      const file1 = join(resultsDir, "benchmark-results-1700000000001.json");
      const file2 = join(resultsDir, "benchmark-results-1700000000002.json");
      await Deno.writeTextFile(file1, minimalResultFile());
      await Deno.writeTextFile(file2, minimalResultFile());

      const importer = new JsonImporter(projectRoot);
      const storage = new InMemoryStorage();
      await storage.open();
      await importer.importFile(file1, storage);
      await importer.importFile(file2, storage);

      const run1 = await storage.getRun("1700000000001");
      const run2 = await storage.getRun("1700000000002");
      assertEquals(run1?.taskSetHash, run2?.taskSetHash);
    } finally {
      await Deno.remove(projectRoot, { recursive: true });
      await Deno.remove(resultsDir, { recursive: true });
    }
  });

  it("V5: changing on-disk task content changes the imported taskSetHash", async () => {
    const projectRoot = await makeProjectRoot();
    const resultsDir = await Deno.makeTempDir();
    try {
      const file1 = join(resultsDir, "benchmark-results-1700000000003.json");
      await Deno.writeTextFile(file1, minimalResultFile());
      const importer1 = new JsonImporter(projectRoot);
      const storage = new InMemoryStorage();
      await storage.open();
      await importer1.importFile(file1, storage);
      const run1 = await storage.getRun("1700000000003");

      // Mutate the task content and import a second run.
      await Deno.writeTextFile(
        `${projectRoot}/tasks/easy/a.yml`,
        "id: CG-AL-E001\nchanged: true",
      );
      const file2 = join(resultsDir, "benchmark-results-1700000000004.json");
      await Deno.writeTextFile(file2, minimalResultFile());
      const importer2 = new JsonImporter(projectRoot);
      await importer2.importFile(file2, storage);
      const run2 = await storage.getRun("1700000000004");

      assertNotEquals(run1?.taskSetHash, run2?.taskSetHash);
    } finally {
      await Deno.remove(projectRoot, { recursive: true });
      await Deno.remove(resultsDir, { recursive: true });
    }
  });

  it("V10: trusts an explicit passRate1=0/passRate2=0 instead of recomputing from results", async () => {
    const projectRoot = await makeProjectRoot();
    const resultsDir = await Deno.makeTempDir();
    try {
      const filePath = join(resultsDir, "benchmark-results-1700000000005.json");
      // Results that WOULD recompute to a non-zero passRate1 if the (buggy)
      // falsy guard fired — proves the explicit 0 from `stats` is trusted.
      await Deno.writeTextFile(
        filePath,
        minimalResultFile({
          results: [
            {
              taskId: "CG-AL-E001",
              context: { llmProvider: "mock", llmModel: "mock-gpt-4" },
              attempts: [],
              success: true,
              finalScore: 100,
              totalTokensUsed: 0,
              totalCost: 0,
              totalDuration: 0,
              passedAttemptNumber: 1,
              successRate: 1,
            },
            {
              taskId: "CG-AL-E002",
              context: { llmProvider: "mock", llmModel: "mock-gpt-4" },
              attempts: [],
              success: false,
              finalScore: 0,
              totalTokensUsed: 0,
              totalCost: 0,
              totalDuration: 0,
              passedAttemptNumber: 0,
              successRate: 0,
            },
          ],
          stats: {
            totalTokens: 0,
            totalCost: 0,
            totalDuration: 0,
            overallPassRate: 0,
            averageScore: 0,
            passRate1: 0,
            passRate2: 0,
            perModel: {},
            perTask: {},
          },
        }),
      );

      const importer = new JsonImporter(projectRoot);
      const storage = new InMemoryStorage();
      await storage.open();
      await importer.importFile(filePath, storage);
      const run = await storage.getRun("1700000000005");

      assertEquals(
        run?.passRate1,
        0,
        "explicit passRate1=0 must be trusted, not overwritten by a recompute",
      );
      assertEquals(run?.passRate2, 0);
    } finally {
      await Deno.remove(projectRoot, { recursive: true });
      await Deno.remove(resultsDir, { recursive: true });
    }
  });

  it("V10: still recomputes pass rates when stats omits both fields entirely", async () => {
    const projectRoot = await makeProjectRoot();
    const resultsDir = await Deno.makeTempDir();
    try {
      const filePath = join(resultsDir, "benchmark-results-1700000000006.json");
      await Deno.writeTextFile(
        filePath,
        minimalResultFile({
          results: [
            {
              taskId: "CG-AL-E001",
              context: { llmProvider: "mock", llmModel: "mock-gpt-4" },
              attempts: [],
              success: true,
              finalScore: 100,
              totalTokensUsed: 0,
              totalCost: 0,
              totalDuration: 0,
              passedAttemptNumber: 1,
              successRate: 1,
            },
          ],
          stats: {
            totalTokens: 0,
            totalCost: 0,
            totalDuration: 0,
            overallPassRate: 1,
            averageScore: 100,
            // passRate1/passRate2 intentionally omitted.
            perModel: {},
            perTask: {},
          },
        }),
      );

      const importer = new JsonImporter(projectRoot);
      const storage = new InMemoryStorage();
      await storage.open();
      await importer.importFile(filePath, storage);
      const run = await storage.getRun("1700000000006");

      assertEquals(run?.passRate1, 1);
      assertEquals(run?.passRate2, 1);
    } finally {
      await Deno.remove(projectRoot, { recursive: true });
      await Deno.remove(resultsDir, { recursive: true });
    }
  });
});
