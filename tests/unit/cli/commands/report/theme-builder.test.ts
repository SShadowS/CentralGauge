/**
 * Tests for theme page builder
 */

import { assert, assertEquals } from "@std/assert";
import type { BenchmarkResult } from "../../../../../cli/types/cli-types.ts";
import {
  calculateThemeSummaries,
  filterResultsByTheme,
  generateThemeNavHtml,
  generateThemePage,
  generateThemeSummaryHtml,
} from "../../../../../cli/commands/report/theme-builder.ts";
import { TASK_THEME_MAP, THEMES } from "../../../../../src/tasks/themes.ts";

// Grab first theme safely for use in tests
const firstTheme = THEMES[0]!;

/** Create a minimal BenchmarkResult for testing */
function mockResult(
  taskId: string,
  success: boolean,
  category?: string,
  tags?: string[],
): BenchmarkResult {
  const manifest: { description: string; category?: string; tags?: string[] } =
    {
      description: `Test task ${taskId}`,
    };
  if (category !== undefined) manifest.category = category;
  if (tags !== undefined) manifest.tags = tags;

  return {
    taskId,
    success,
    finalScore: success ? 100 : 0,
    totalDuration: 1000,
    attempts: [{ success }],
    context: {
      variantId: "test-model",
      llmModel: "test",
      llmProvider: "mock",
      manifest,
    },
  };
}

Deno.test("filterResultsByTheme", async (t) => {
  await t.step("filters by primary category", () => {
    const results = [
      mockResult("CG-AL-E001", true, "data-modeling"),
      mockResult("CG-AL-E005", true, "business-logic"),
      mockResult("CG-AL-E008", true, "interfaces-events"),
    ];

    const dataModeling = filterResultsByTheme(results, "data-modeling");
    assertEquals(dataModeling.length, 1);
    assertEquals(dataModeling[0]!.taskId, "CG-AL-E001");
  });

  await t.step("filters by tags", () => {
    const results = [
      mockResult("CG-AL-M005", true, "data-exchange", [
        "http",
        "json",
        "error-handling",
      ]),
    ];

    // Should match by tag
    const errorHandling = filterResultsByTheme(results, "error-handling");
    assertEquals(errorHandling.length, 1);

    // Should also match by primary category
    const dataExchange = filterResultsByTheme(results, "data-exchange");
    assertEquals(dataExchange.length, 1);
  });

  await t.step("falls back to TASK_THEME_MAP when no metadata", () => {
    const results: BenchmarkResult[] = [
      {
        taskId: "CG-AL-E001",
        success: true,
        finalScore: 100,
        totalDuration: 1000,
        attempts: [{ success: true }],
        // No context.manifest.category
      },
    ];

    const dataModeling = filterResultsByTheme(results, "data-modeling");
    assertEquals(dataModeling.length, 1);
    assertEquals(dataModeling[0]!.taskId, "CG-AL-E001");

    const businessLogic = filterResultsByTheme(results, "business-logic");
    assertEquals(businessLogic.length, 0);
  });

  await t.step(
    "handles raw TaskExecutionResult JSON shape (metadata nested)",
    () => {
      // Simulates what happens when TaskExecutionResult is serialized to JSON
      // and loaded back - manifest has metadata.category instead of category
      const results: BenchmarkResult[] = [
        {
          taskId: "CG-AL-H002",
          success: true,
          finalScore: 100,
          totalDuration: 1000,
          attempts: [{ success: true }],
          context: {
            variantId: "test-model",
            manifest: {
              description: "FlowField task",
            },
          },
        },
      ];

      // Since there's no direct category, should fall back to TASK_THEME_MAP
      const dataModeling = filterResultsByTheme(results, "data-modeling");
      assertEquals(dataModeling.length, 1);
    },
  );

  await t.step("returns empty for non-matching theme", () => {
    const results = [
      mockResult("CG-AL-E001", true, "data-modeling"),
    ];

    const errorHandling = filterResultsByTheme(results, "error-handling");
    assertEquals(errorHandling.length, 0);
  });
});

Deno.test("calculateThemeSummaries", async (t) => {
  await t.step("calculates correct task counts and pass rates", () => {
    const results = [
      mockResult("CG-AL-E001", true, "data-modeling"),
      mockResult("CG-AL-E003", true, "data-modeling"),
      mockResult("CG-AL-E003", false, "data-modeling"),
      mockResult("CG-AL-E005", true, "business-logic"),
    ];

    const summaries = calculateThemeSummaries(results);

    const dataModelingSummary = summaries.find(
      (s) => s.theme.slug === "data-modeling",
    );
    assert(dataModelingSummary);
    assertEquals(dataModelingSummary.taskCount, 2); // E001 and E003
    // 2 passed out of 3 results = 0.667
    assertEquals(
      Math.round(dataModelingSummary.avgPassRate * 1000),
      667,
    );

    const businessLogicSummary = summaries.find(
      (s) => s.theme.slug === "business-logic",
    );
    assert(businessLogicSummary);
    assertEquals(businessLogicSummary.taskCount, 1);
    assertEquals(businessLogicSummary.avgPassRate, 1.0);
  });

  await t.step("returns all 7 themes", () => {
    const summaries = calculateThemeSummaries([]);
    assertEquals(summaries.length, 7);
  });

  await t.step("handles empty results", () => {
    const summaries = calculateThemeSummaries([]);
    for (const s of summaries) {
      assertEquals(s.taskCount, 0);
      assertEquals(s.avgPassRate, 0);
    }
  });
});

Deno.test("TASK_THEME_MAP coverage", async (t) => {
  await t.step("every theme has at least 3 tasks", () => {
    for (const theme of THEMES) {
      const tasksForTheme = Object.entries(TASK_THEME_MAP).filter(
        ([, cat]) => cat === theme.category,
      );
      assert(
        tasksForTheme.length >= 3,
        `Theme "${theme.name}" has only ${tasksForTheme.length} tasks (need at least 3)`,
      );
    }
  });

  await t.step("all mapped task IDs follow CG-AL-XXXX format", () => {
    for (const taskId of Object.keys(TASK_THEME_MAP)) {
      assert(
        /^CG-AL-[EHM]\d+$/.test(taskId),
        `Invalid task ID format: ${taskId}`,
      );
    }
  });

  await t.step("all categories in map match a theme slug", () => {
    const validSlugs = new Set(THEMES.map((t) => t.slug));
    for (const [taskId, category] of Object.entries(TASK_THEME_MAP)) {
      assert(
        validSlugs.has(category),
        `Task ${taskId} has unknown category: ${category}`,
      );
    }
  });
});

Deno.test("generateThemeNavHtml", async (t) => {
  await t.step("generates grid with all themes", () => {
    const summaries = calculateThemeSummaries([]);

    const html = generateThemeNavHtml(summaries);
    assert(html.includes("themes-grid"));
    assert(html.includes("theme-card"));
    // Check all theme links are present (names may be HTML-escaped)
    for (const theme of THEMES) {
      assert(
        html.includes(`theme-${theme.slug}.html`),
        `Missing link for: ${theme.slug}`,
      );
    }
  });

  await t.step("shows task count and pass rate", () => {
    const summaries = [
      { theme: firstTheme, taskCount: 12, avgPassRate: 0.85 },
    ];

    const html = generateThemeNavHtml(summaries);
    assert(html.includes("12 tasks"));
    assert(html.includes("85% avg"));
  });
});

Deno.test("generateThemePage", async (t) => {
  await t.step("generates valid HTML with all sections", () => {
    const html = generateThemePage({
      theme: firstTheme,
      chartsHtml: "<div>charts</div>",
      modelCardsHtml: "<div>cards</div>",
      matrixHeaderHtml: "<th>Model</th>",
      matrixRowsHtml: "<tr><td>E001</td></tr>",
      summaryHtml: "<div>summary</div>",
      matrixLegendHtml: '<p class="matrix-legend">P/F</p>',
      footerHtml: "<p>footer</p>",
      generatedDate: "Jan 1, 2025",
      dataDateRange: "Jan 1, 2025",
      taskCount: 12,
      modelCount: 5,
    });

    // Check structure
    assert(html.includes("<!DOCTYPE html>"));
    assert(html.includes(firstTheme.name));
    assert(html.includes(firstTheme.description));
    assert(html.includes("Back to Benchmark Results"));
    assert(html.includes("theme-nav"));
    assert(html.includes("Model Rankings"));
    assert(html.includes("Task Results Matrix"));
    assert(html.includes("<div>charts</div>"));
    assert(html.includes("<div>cards</div>"));
  });

  await t.step("includes navigation links to all themes", () => {
    const html = generateThemePage({
      theme: firstTheme,
      chartsHtml: "",
      modelCardsHtml: "",
      matrixHeaderHtml: "",
      matrixRowsHtml: "",
      summaryHtml: "",
      matrixLegendHtml: "",
      footerHtml: "",
      generatedDate: "",
      dataDateRange: "",
      taskCount: 0,
      modelCount: 0,
    });

    for (const theme of THEMES) {
      assert(
        html.includes(`theme-${theme.slug}.html`),
        `Missing nav link for: ${theme.slug}`,
      );
    }

    // Active theme should have active class
    assert(html.includes(`class="active"`));
  });
});

Deno.test("generateThemeSummaryHtml", async (t) => {
  await t.step("generates summary with model count and pass rate", () => {
    const perModelMap = new Map([
      [
        "model-a",
        {
          model: "test",
          provider: "mock",
          variantId: "model-a",
          tasksPassed: 8,
          tasksFailed: 2,
          avgScore: 80,
          tokens: 1000,
          cost: 0.1,
          avgAttempts: 1.2,
          passedOnAttempt1: 6,
          passedOnAttempt2: 2,
          passedByAttempt: [6, 2],
          compileFailures: 1,
          testFailures: 1,
          malformedResponses: 0,
        },
      ],
    ]);

    const html = generateThemeSummaryHtml(perModelMap, 10);
    assert(html.includes("1")); // 1 model
    assert(html.includes("10")); // 10 tasks
    assert(html.includes("80.0%")); // 8/10 pass rate
  });
});
