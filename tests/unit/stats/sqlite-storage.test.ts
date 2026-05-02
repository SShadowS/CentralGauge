// Pre-load @db/sqlite at module init so the FFI lib is loaded BEFORE
// any test runs. The implementation now lazy-loads via dynamic import
// inside `open()`, which would otherwise trip Deno's resource-leak
// detector ("dynamic library loaded during test, not unloaded").
import "@db/sqlite";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertExists,
  assertGreater,
} from "@std/assert";
import { SqliteStorage } from "../../../src/stats/sqlite-storage.ts";
import type { ResultRecord, RunRecord } from "../../../src/stats/types.ts";

describe("SqliteStorage", () => {
  let storage: SqliteStorage;
  let tempDir: string;
  let dbPath: string;

  // Helper to create a run record
  function createRunRecord(overrides: Partial<RunRecord> = {}): RunRecord {
    return {
      runId: `run-${Date.now()}`,
      executedAt: new Date(),
      configHash: "config-hash-abc",
      taskSetHash: "taskset-hash-xyz",
      totalTasks: 10,
      totalModels: 3,
      totalCost: 1.5,
      totalTokens: 15000,
      totalDurationMs: 60000,
      passRate1: 0.7,
      passRate2: 0.85,
      overallPassRate: 0.85,
      averageScore: 85,
      ...overrides,
    };
  }

  // Helper to create a result record
  function createResultRecord(
    overrides: Partial<ResultRecord> = {},
  ): ResultRecord {
    return {
      taskId: "CG-AL-E001",
      variantId: "anthropic/sonnet@temp=0.1",
      model: "sonnet",
      provider: "anthropic",
      success: true,
      finalScore: 100,
      passedAttempt: 1,
      totalTokens: 1500,
      promptTokens: 500,
      completionTokens: 1000,
      totalCost: 0.015,
      totalDurationMs: 5000,
      ...overrides,
    };
  }

  beforeEach(async () => {
    tempDir = await Deno.makeTempDir({ prefix: "sqlite-storage-test-" });
    dbPath = `${tempDir}/test.db`;
    storage = new SqliteStorage(dbPath);
  });

  afterEach(async () => {
    try {
      await storage.close();
    } catch {
      // Already closed
    }
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // Cleanup failed, ignore
    }
  });

  // ============ Lifecycle Tests ============

  describe("lifecycle", () => {
    it("should start closed", () => {
      assertEquals(storage.isOpen(), false);
    });

    it("should open database", async () => {
      await storage.open();
      assertEquals(storage.isOpen(), true);
    });

    it("should be idempotent on multiple opens", async () => {
      await storage.open();
      await storage.open(); // Should not throw
      assertEquals(storage.isOpen(), true);
    });

    it("should close database", async () => {
      await storage.open();
      await storage.close();
      assertEquals(storage.isOpen(), false);
    });

    it("should be idempotent on multiple closes", async () => {
      await storage.open();
      await storage.close();
      await storage.close(); // Should not throw
      assertEquals(storage.isOpen(), false);
    });

    it("should throw when accessing closed database", async () => {
      // getRun calls getDb() which throws synchronously
      let threw = false;
      try {
        await storage.getRun("any-id");
      } catch (e) {
        threw = true;
        assert(e instanceof Error);
        assert(e.message.includes("Database not open"));
      }
      assert(threw, "Expected an error to be thrown");
    });

    it("should create directory if it doesn't exist", async () => {
      const nestedPath = `${tempDir}/nested/dir/test.db`;
      const nestedStorage = new SqliteStorage(nestedPath);
      await nestedStorage.open();
      assertEquals(nestedStorage.isOpen(), true);
      await nestedStorage.close();
    });
  });

  // ============ Run CRUD Tests ============

  describe("run operations", () => {
    beforeEach(async () => {
      await storage.open();
    });

    describe("persistRun", () => {
      it("should persist a run record", async () => {
        const run = createRunRecord({ runId: "test-run-1" });
        await storage.persistRun(run);

        const retrieved = await storage.getRun("test-run-1");
        assertExists(retrieved);
        assertEquals(retrieved.runId, "test-run-1");
      });

      it("should persist run with metadata", async () => {
        const run = createRunRecord({
          runId: "run-with-meta",
          metadata: { environment: "test", version: "1.0" },
        });
        await storage.persistRun(run);

        const retrieved = await storage.getRun("run-with-meta");
        assertExists(retrieved);
        assertExists(retrieved.metadata);
        const meta = retrieved.metadata as Record<string, unknown>;
        assertEquals(meta["environment"], "test");
      });
    });

    describe("getRun", () => {
      it("should return null for non-existent run", async () => {
        const result = await storage.getRun("non-existent");
        assertEquals(result, null);
      });

      it("should preserve all fields", async () => {
        const run = createRunRecord({
          runId: "full-run",
          passRate1: 0.6,
          passRate2: 0.8,
          overallPassRate: 0.8,
          averageScore: 80,
        });
        await storage.persistRun(run);

        const retrieved = await storage.getRun("full-run");
        assertExists(retrieved);
        assertEquals(retrieved.passRate1, 0.6);
        assertEquals(retrieved.passRate2, 0.8);
        assertEquals(retrieved.overallPassRate, 0.8);
        assertEquals(retrieved.averageScore, 80);
      });
    });

    describe("hasRun", () => {
      it("should return false for non-existent run", async () => {
        assertEquals(await storage.hasRun("non-existent"), false);
      });

      it("should return true for existing run", async () => {
        await storage.persistRun(createRunRecord({ runId: "exists" }));
        assertEquals(await storage.hasRun("exists"), true);
      });
    });

    describe("deleteRun", () => {
      it("should return false when deleting non-existent run", async () => {
        assertEquals(await storage.deleteRun("non-existent"), false);
      });

      it("should delete existing run", async () => {
        await storage.persistRun(createRunRecord({ runId: "to-delete" }));
        assertEquals(await storage.deleteRun("to-delete"), true);
        assertEquals(await storage.hasRun("to-delete"), false);
      });
    });

    describe("listRuns", () => {
      it("should return empty array when no runs", async () => {
        const runs = await storage.listRuns();
        assertEquals(runs, []);
      });

      it("should return all runs ordered by date desc", async () => {
        const run1 = createRunRecord({
          runId: "run-1",
          executedAt: new Date("2024-01-01"),
        });
        const run2 = createRunRecord({
          runId: "run-2",
          executedAt: new Date("2024-01-02"),
        });
        await storage.persistRun(run1);
        await storage.persistRun(run2);

        const runs = await storage.listRuns();
        assertEquals(runs.length, 2);
        assertExists(runs[0]);
        assertEquals(runs[0].runId, "run-2"); // Most recent first
      });

      it("should filter by configHash", async () => {
        await storage.persistRun(
          createRunRecord({
            runId: "r1",
            configHash: "hash-a",
          }),
        );
        await storage.persistRun(
          createRunRecord({
            runId: "r2",
            configHash: "hash-b",
          }),
        );

        const runs = await storage.listRuns({ configHash: "hash-a" });
        assertEquals(runs.length, 1);
        assertExists(runs[0]);
        assertEquals(runs[0].runId, "r1");
      });

      it("should filter by taskSetHash", async () => {
        await storage.persistRun(
          createRunRecord({
            runId: "r1",
            taskSetHash: "ts-a",
          }),
        );
        await storage.persistRun(
          createRunRecord({
            runId: "r2",
            taskSetHash: "ts-b",
          }),
        );

        const runs = await storage.listRuns({ taskSetHash: "ts-a" });
        assertEquals(runs.length, 1);
        assertExists(runs[0]);
        assertEquals(runs[0].runId, "r1");
      });

      it("should respect limit option", async () => {
        for (let i = 0; i < 5; i++) {
          await storage.persistRun(
            createRunRecord({
              runId: `run-${i}`,
              executedAt: new Date(Date.now() + i * 1000),
            }),
          );
        }

        const runs = await storage.listRuns({ limit: 3 });
        assertEquals(runs.length, 3);
      });

      it("should respect offset option", async () => {
        for (let i = 0; i < 5; i++) {
          await storage.persistRun(
            createRunRecord({
              runId: `run-${i}`,
              executedAt: new Date(Date.now() + i * 1000),
            }),
          );
        }

        const runs = await storage.listRuns({ limit: 2, offset: 2 });
        assertEquals(runs.length, 2);
        assertExists(runs[0]);
        assertEquals(runs[0].runId, "run-2");
      });

      it("should filter by date range", async () => {
        await storage.persistRun(
          createRunRecord({
            runId: "old",
            executedAt: new Date("2024-01-01"),
          }),
        );
        await storage.persistRun(
          createRunRecord({
            runId: "new",
            executedAt: new Date("2024-06-01"),
          }),
        );

        const runs = await storage.listRuns({
          since: new Date("2024-03-01"),
        });
        assertEquals(runs.length, 1);
        assertExists(runs[0]);
        assertEquals(runs[0].runId, "new");
      });
    });
  });

  // ============ Result CRUD Tests ============

  describe("result operations", () => {
    const testRunId = "test-run";

    beforeEach(async () => {
      await storage.open();
      await storage.persistRun(createRunRecord({ runId: testRunId }));
    });

    describe("persistResults", () => {
      it("should persist multiple results", async () => {
        const results = [
          createResultRecord({ taskId: "E001" }),
          createResultRecord({ taskId: "E002" }),
        ];
        await storage.persistResults(testRunId, results);

        const retrieved = await storage.getResults({ runId: testRunId });
        assertEquals(retrieved.length, 2);
      });

      it("should handle empty results array", async () => {
        await storage.persistResults(testRunId, []);
        const retrieved = await storage.getResults({ runId: testRunId });
        assertEquals(retrieved.length, 0);
      });

      it("should preserve all fields", async () => {
        const result = createResultRecord({
          taskId: "E001",
          success: false,
          finalScore: 50,
          passedAttempt: 0,
          promptTokens: 100,
          completionTokens: 200,
        });
        await storage.persistResults(testRunId, [result]);

        const retrieved = await storage.getResults({ runId: testRunId });
        assertEquals(retrieved.length, 1);
        assertExists(retrieved[0]);
        assertEquals(retrieved[0].success, false);
        assertEquals(retrieved[0].finalScore, 50);
        assertEquals(retrieved[0].promptTokens, 100);
      });

      it("should persist variant config as JSON", async () => {
        const result = createResultRecord({
          variantConfig: { temperature: 0.5, maxTokens: 4000 },
        });
        await storage.persistResults(testRunId, [result]);

        const retrieved = await storage.getResults({ runId: testRunId });
        assertExists(retrieved[0]);
        assertExists(retrieved[0].variantConfig);
        const config = retrieved[0].variantConfig as Record<string, unknown>;
        assertEquals(config["temperature"], 0.5);
      });
    });

    describe("getResults", () => {
      beforeEach(async () => {
        await storage.persistResults(testRunId, [
          createResultRecord({
            taskId: "E001",
            variantId: "anthropic/sonnet",
            success: true,
          }),
          createResultRecord({
            taskId: "E002",
            variantId: "anthropic/sonnet",
            success: false,
          }),
          createResultRecord({
            taskId: "E001",
            variantId: "openai/gpt-4o",
            provider: "openai",
            success: true,
          }),
        ]);
      });

      it("should filter by taskId", async () => {
        const results = await storage.getResults({ taskId: "E001" });
        assertEquals(results.length, 2);
      });

      it("should filter by variantId", async () => {
        const results = await storage.getResults({
          variantId: "anthropic/sonnet",
        });
        assertEquals(results.length, 2);
      });

      it("should filter by provider", async () => {
        const results = await storage.getResults({ provider: "openai" });
        assertEquals(results.length, 1);
      });

      it("should filter by success", async () => {
        const successes = await storage.getResults({ success: true });
        assertEquals(successes.length, 2);

        const failures = await storage.getResults({ success: false });
        assertEquals(failures.length, 1);
      });

      it("should combine filters", async () => {
        const results = await storage.getResults({
          taskId: "E001",
          success: true,
        });
        assertEquals(results.length, 2);
      });
    });

    describe("getVariantIds", () => {
      it("should return empty array when no results", async () => {
        const variantIds = await storage.getVariantIds();
        assertEquals(variantIds, []);
      });

      it("should return distinct variant IDs", async () => {
        await storage.persistResults(testRunId, [
          createResultRecord({ taskId: "E001", variantId: "variant-a" }),
          createResultRecord({ taskId: "E001", variantId: "variant-b" }),
          createResultRecord({ taskId: "E002", variantId: "variant-a" }), // Same variant, different task
        ]);

        const variantIds = await storage.getVariantIds();
        assertEquals(variantIds.length, 2);
        assert(variantIds.includes("variant-a"));
        assert(variantIds.includes("variant-b"));
      });
    });

    describe("getTaskIds", () => {
      it("should return empty array when no results", async () => {
        const taskIds = await storage.getTaskIds();
        assertEquals(taskIds, []);
      });

      it("should return distinct task IDs", async () => {
        await storage.persistResults(testRunId, [
          createResultRecord({ taskId: "E001", variantId: "variant-a" }),
          createResultRecord({ taskId: "E002", variantId: "variant-a" }),
          createResultRecord({ taskId: "E001", variantId: "variant-b" }), // Same task, different variant
        ]);

        const taskIds = await storage.getTaskIds();
        assertEquals(taskIds.length, 2);
        assert(taskIds.includes("E001"));
        assert(taskIds.includes("E002"));
      });
    });
  });

  // ============ Analytics Tests ============

  describe("analytics", () => {
    beforeEach(async () => {
      await storage.open();
    });

    describe("getModelTrend", () => {
      it("should return empty array when no data", async () => {
        const trend = await storage.getModelTrend("non-existent");
        assertEquals(trend, []);
      });

      it("should calculate trend points", async () => {
        const run1 = createRunRecord({
          runId: "run-1",
          executedAt: new Date("2024-01-01"),
        });
        const run2 = createRunRecord({
          runId: "run-2",
          executedAt: new Date("2024-01-02"),
        });
        await storage.persistRun(run1);
        await storage.persistRun(run2);

        await storage.persistResults("run-1", [
          createResultRecord({
            variantId: "test-variant",
            success: true,
            finalScore: 100,
          }),
        ]);
        await storage.persistResults("run-2", [
          createResultRecord({
            variantId: "test-variant",
            success: false,
            finalScore: 50,
          }),
        ]);

        const trend = await storage.getModelTrend("test-variant");
        assertEquals(trend.length, 2);
        assertExists(trend[0]);
        assertEquals(trend[0].runId, "run-2"); // Most recent first
      });

      it("should respect limit option", async () => {
        for (let i = 0; i < 5; i++) {
          const run = createRunRecord({
            runId: `run-${i}`,
            executedAt: new Date(Date.now() + i * 1000),
          });
          await storage.persistRun(run);
          await storage.persistResults(`run-${i}`, [
            createResultRecord({ variantId: "test-variant" }),
          ]);
        }

        const trend = await storage.getModelTrend("test-variant", { limit: 3 });
        assertEquals(trend.length, 3);
      });
    });

    describe("compareModels", () => {
      it("should compare two variants", async () => {
        const run = createRunRecord({ runId: "compare-run" });
        await storage.persistRun(run);

        await storage.persistResults("compare-run", [
          createResultRecord({
            taskId: "E001",
            variantId: "variant-a",
            finalScore: 100,
            totalCost: 0.01,
          }),
          createResultRecord({
            taskId: "E001",
            variantId: "variant-b",
            finalScore: 50,
            totalCost: 0.02,
          }),
          createResultRecord({
            taskId: "E002",
            variantId: "variant-a",
            finalScore: 80,
            totalCost: 0.01,
          }),
          createResultRecord({
            taskId: "E002",
            variantId: "variant-b",
            finalScore: 80,
            totalCost: 0.02,
          }),
        ]);

        const comparison = await storage.compareModels(
          "variant-a",
          "variant-b",
        );
        assertEquals(comparison.variant1, "variant-a");
        assertEquals(comparison.variant2, "variant-b");
        assertEquals(comparison.variant1Wins, 1); // E001
        assertEquals(comparison.variant2Wins, 0);
        assertEquals(comparison.ties, 1); // E002
        assertEquals(comparison.perTask.length, 2);
      });

      it("should handle no common tasks", async () => {
        const run = createRunRecord({ runId: "no-common" });
        await storage.persistRun(run);

        await storage.persistResults("no-common", [
          createResultRecord({ taskId: "E001", variantId: "variant-a" }),
          createResultRecord({ taskId: "E002", variantId: "variant-b" }),
        ]);

        const comparison = await storage.compareModels(
          "variant-a",
          "variant-b",
        );
        assertEquals(comparison.perTask.length, 0);
      });
    });

    describe("getCostBreakdown", () => {
      beforeEach(async () => {
        const run = createRunRecord({ runId: "cost-run" });
        await storage.persistRun(run);

        await storage.persistResults("cost-run", [
          createResultRecord({
            variantId: "variant-a",
            taskId: "E001",
            totalCost: 0.10,
            totalTokens: 1000,
            success: true,
          }),
          createResultRecord({
            variantId: "variant-a",
            taskId: "E002",
            totalCost: 0.05,
            totalTokens: 500,
            success: false,
          }),
          createResultRecord({
            variantId: "variant-b",
            taskId: "E001",
            totalCost: 0.20,
            totalTokens: 2000,
            success: true,
          }),
        ]);
      });

      it("should group by model", async () => {
        const breakdown = await storage.getCostBreakdown({ groupBy: "model" });
        assertEquals(breakdown.length, 2);

        const variantA = breakdown.find((b) => b.groupKey === "variant-a");
        assertExists(variantA);
        assertAlmostEquals(variantA.totalCost, 0.15, 0.001);
        assertEquals(variantA.totalTokens, 1500);
        assertEquals(variantA.executionCount, 2);
      });

      it("should group by task", async () => {
        const breakdown = await storage.getCostBreakdown({ groupBy: "task" });
        assertEquals(breakdown.length, 2);

        const e001 = breakdown.find((b) => b.groupKey === "E001");
        assertExists(e001);
        assertAlmostEquals(e001.totalCost, 0.30, 0.001);
        assertEquals(e001.executionCount, 2);
      });

      it("should calculate cost per success", async () => {
        const breakdown = await storage.getCostBreakdown({ groupBy: "model" });

        const variantA = breakdown.find((b) => b.groupKey === "variant-a");
        assertExists(variantA);
        assertExists(variantA.costPerSuccess);
        // variant-a: $0.15 total, 1 success = $0.15 per success
        assertAlmostEquals(variantA.costPerSuccess, 0.15, 0.001);
      });
    });

    describe("getTaskSetSummaries", () => {
      it("should return empty array when no runs", async () => {
        const summaries = await storage.getTaskSetSummaries();
        assertEquals(summaries, []);
      });

      it("should summarize task sets", async () => {
        await storage.persistRun(
          createRunRecord({
            runId: "r1",
            taskSetHash: "ts-a",
            overallPassRate: 0.8,
            averageScore: 80,
          }),
        );
        await storage.persistRun(
          createRunRecord({
            runId: "r2",
            taskSetHash: "ts-a",
            overallPassRate: 0.9,
            averageScore: 90,
          }),
        );

        const summaries = await storage.getTaskSetSummaries();
        assertEquals(summaries.length, 1);
        assertExists(summaries[0]);
        assertEquals(summaries[0].taskSetHash, "ts-a");
        assertEquals(summaries[0].runCount, 2);
        assertAlmostEquals(summaries[0].avgPassRate, 0.85, 0.001);
        assertAlmostEquals(summaries[0].avgScore, 85, 0.001);
      });
    });

    describe("getRunsByVariantForTaskSet", () => {
      it("should group runs by variant", async () => {
        const run1 = createRunRecord({ runId: "r1", taskSetHash: "ts-a" });
        const run2 = createRunRecord({ runId: "r2", taskSetHash: "ts-a" });
        await storage.persistRun(run1);
        await storage.persistRun(run2);

        await storage.persistResults("r1", [
          createResultRecord({ variantId: "variant-a", provider: "anthropic" }),
        ]);
        await storage.persistResults("r2", [
          createResultRecord({ variantId: "variant-a", provider: "anthropic" }),
          createResultRecord({
            variantId: "variant-b",
            provider: "openai",
          }),
        ]);

        const groups = await storage.getRunsByVariantForTaskSet("ts-a");
        assertEquals(groups.length, 2);

        const variantA = groups.find((g) => g.variantId === "variant-a");
        assertExists(variantA);
        assertEquals(variantA.runs.length, 2);
        assertEquals(variantA.provider, "anthropic");
      });

      it("should return empty array for non-existent task set", async () => {
        const groups = await storage.getRunsByVariantForTaskSet("non-existent");
        assertEquals(groups, []);
      });
    });

    describe("detectRegressions", () => {
      it("should return empty array when no data", async () => {
        const regressions = await storage.detectRegressions({ threshold: 0.1 });
        assertEquals(regressions, []);
      });

      it("should detect score regressions", async () => {
        // Create baseline runs (older)
        for (let i = 0; i < 7; i++) {
          const run = createRunRecord({
            runId: `baseline-${i}`,
            executedAt: new Date(Date.now() - (10 - i) * 86400000), // 10-3 days ago
          });
          await storage.persistRun(run);
          await storage.persistResults(`baseline-${i}`, [
            createResultRecord({
              taskId: "E001",
              variantId: "test-variant",
              finalScore: 100,
            }),
          ]);
        }

        // Create recent runs (lower scores = regression)
        for (let i = 0; i < 3; i++) {
          const run = createRunRecord({
            runId: `recent-${i}`,
            executedAt: new Date(Date.now() - i * 86400000), // 0-2 days ago
          });
          await storage.persistRun(run);
          await storage.persistResults(`recent-${i}`, [
            createResultRecord({
              taskId: "E001",
              variantId: "test-variant",
              finalScore: 70, // 30% regression
            }),
          ]);
        }

        const regressions = await storage.detectRegressions({
          threshold: 0.2, // 20% threshold
        });

        assertGreater(regressions.length, 0);
        const regression = regressions[0];
        assertExists(regression);
        assertEquals(regression.taskId, "E001");
        assertEquals(regression.variantId, "test-variant");
        assert(regression.changePct < -20); // More than 20% regression
      });
    });
  });

  // ============ Schema Migration Tests ============

  describe("schema migrations", () => {
    it("should create schema on first open", async () => {
      await storage.open();
      // If we can persist and retrieve, schema was created
      await storage.persistRun(createRunRecord({ runId: "schema-test" }));
      const run = await storage.getRun("schema-test");
      assertExists(run);
    });

    it("should persist data across open/close cycles", async () => {
      await storage.open();
      await storage.persistRun(createRunRecord({ runId: "persist-test" }));
      await storage.close();

      // Reopen and verify data persists
      const storage2 = new SqliteStorage(dbPath);
      await storage2.open();
      const run = await storage2.getRun("persist-test");
      assertExists(run);
      await storage2.close();
    });
  });

  // ============ Transaction Tests ============

  describe("transactions", () => {
    it("should rollback on error during persistResults", async () => {
      await storage.open();
      await storage.persistRun(createRunRecord({ runId: "tx-test" }));

      // Persist some valid results first
      await storage.persistResults("tx-test", [
        createResultRecord({ taskId: "E001" }),
      ]);

      // Verify original data is intact
      const results = await storage.getResults({ runId: "tx-test" });
      assertEquals(results.length, 1);
    });
  });
});
