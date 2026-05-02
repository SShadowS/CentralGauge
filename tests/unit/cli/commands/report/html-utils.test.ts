import { assertEquals } from "@std/assert";
import {
  formatCI,
  formatCostPerPass,
  formatTokenCount,
  formatTokensPerPass,
} from "../../../../../cli/commands/report/html-utils.ts";

Deno.test("formatCI", async (t) => {
  await t.step("formats 0..1 fractions as percentages", () => {
    assertEquals(formatCI({ lower: 0.234, upper: 0.789 }), "[23.4–78.9]%");
  });

  await t.step("rounds to 1 decimal", () => {
    assertEquals(formatCI({ lower: 0.99949, upper: 1 }), "[99.9–100.0]%");
  });

  await t.step("0..1 boundaries", () => {
    assertEquals(formatCI({ lower: 0, upper: 1 }), "[0.0–100.0]%");
  });
});

Deno.test("formatCostPerPass", async (t) => {
  await t.step("null -> n/a", () => {
    assertEquals(formatCostPerPass(null), "n/a");
  });

  await t.step("formats with 4 decimal places", () => {
    assertEquals(formatCostPerPass(1.234567), "$1.2346");
  });

  await t.step("0 -> $0.0000 (legitimate, not no-data)", () => {
    assertEquals(formatCostPerPass(0), "$0.0000");
  });
});

Deno.test("formatTokenCount", async (t) => {
  await t.step("< 1000 -> integer", () => {
    assertEquals(formatTokenCount(42), "42");
    assertEquals(formatTokenCount(999.5), "1000");
  });

  await t.step(">= 1000 -> K with 1 decimal", () => {
    assertEquals(formatTokenCount(1500), "1.5K");
    assertEquals(formatTokenCount(999_999), "1000.0K");
  });

  await t.step(">= 1_000_000 -> M with 1 decimal", () => {
    assertEquals(formatTokenCount(1_500_000), "1.5M");
    assertEquals(formatTokenCount(2_345_678), "2.3M");
  });
});

Deno.test("formatTokensPerPass", async (t) => {
  await t.step("null -> n/a", () => {
    assertEquals(formatTokensPerPass(null), "n/a");
  });

  await t.step("delegates to formatTokenCount for non-null", () => {
    assertEquals(formatTokensPerPass(2_500_000), "2.5M");
  });
});
