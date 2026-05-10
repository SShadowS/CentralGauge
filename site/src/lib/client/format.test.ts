import { describe, expect, it } from "vitest";
import {
  formatCost,
  formatDuration,
  formatMetric,
  formatRelativeTime,
  formatScore,
  formatTaskRatio,
  formatTokens,
} from "./format";

describe("format", () => {
  describe("formatScore", () => {
    it("renders a 0-100 score as 'X.X / 100'", () => {
      // Live score values are 0-100 (e.g. 70.95 = "71.0 / 100").
      expect(formatScore(70.95)).toBe("71.0 / 100");
      expect(formatScore(100)).toBe("100.0 / 100");
      expect(formatScore(0)).toBe("0.0 / 100");
      // Lower-magnitude inputs (legacy 0-1 fixtures) still format consistently
      // — the suffix prevents confusion with a percent.
      expect(formatScore(0.84)).toBe("0.8 / 100");
    });

    it("returns an em dash for null/undefined/non-finite", () => {
      expect(formatScore(null)).toBe("—");
      expect(formatScore(undefined)).toBe("—");
      expect(formatScore(NaN)).toBe("—");
    });
  });

  describe("formatCost", () => {
    it("formats USD with $ prefix", () => {
      expect(formatCost(0.12)).toBe("$0.12");
      expect(formatCost(0.001)).toBe("$0.001");
      expect(formatCost(1.23456)).toBe("$1.23");
    });
    it("shows < $0.001 for tiny values", () => {
      expect(formatCost(0.0001)).toBe("<$0.001");
    });
    it("locks the strict-less-than boundary at 0.001", () => {
      expect(formatCost(0.0009)).toBe("<$0.001");
      expect(formatCost(0.001)).toBe("$0.001");
      expect(formatCost(0.0011)).toBe("$0.001");
    });
  });

  describe("formatDuration", () => {
    it("milliseconds < 1000", () => {
      expect(formatDuration(500)).toBe("500ms");
    });
    it("seconds < 60", () => {
      expect(formatDuration(2400)).toBe("2.4s");
      expect(formatDuration(12400)).toBe("12.4s");
    });
    it("minutes", () => {
      expect(formatDuration(125000)).toBe("2m 5s");
    });
    it("hours", () => {
      expect(formatDuration(3725000)).toBe("1h 2m");
    });
  });

  describe("formatTokens", () => {
    it("plain integer < 1000", () => {
      expect(formatTokens(480)).toBe("480");
    });
    it("thousands with k", () => {
      expect(formatTokens(2400)).toBe("2.4k");
      expect(formatTokens(12000)).toBe("12k");
    });
    it("millions with M", () => {
      expect(formatTokens(1_500_000)).toBe("1.5M");
    });
  });

  describe("formatRelativeTime", () => {
    it("seconds", () => {
      const now = new Date("2026-04-27T12:00:00Z");
      const ts = "2026-04-27T11:59:30Z";
      expect(formatRelativeTime(ts, now)).toBe("30s ago");
    });
    it("minutes", () => {
      const now = new Date("2026-04-27T12:00:00Z");
      const ts = "2026-04-27T11:55:00Z";
      expect(formatRelativeTime(ts, now)).toBe("5m ago");
    });
    it("hours", () => {
      const now = new Date("2026-04-27T12:00:00Z");
      const ts = "2026-04-27T08:00:00Z";
      expect(formatRelativeTime(ts, now)).toBe("4h ago");
    });
    it("days", () => {
      const now = new Date("2026-04-27T12:00:00Z");
      const ts = "2026-04-25T12:00:00Z";
      expect(formatRelativeTime(ts, now)).toBe("2d ago");
    });
  });

  describe("formatTaskRatio", () => {
    it("formats N/M", () => {
      expect(formatTaskRatio(24, 24)).toBe("24/24");
      expect(formatTaskRatio(0, 24)).toBe("0/24");
    });
  });

  describe("formatMetric", () => {
    it("renders a 0-1 rate as a percent", () => {
      expect(formatMetric(0.781, "rate")).toBe("78.1%");
      expect(formatMetric(1, "rate")).toBe("100.0%");
      expect(formatMetric(0, "rate")).toBe("0.0%");
    });

    it("renders a 0-100 percent without further scaling", () => {
      expect(formatMetric(73.4, "pct")).toBe("73.4%");
      expect(formatMetric(0, "pct")).toBe("0.0%");
    });

    it("renders a score on the X.X / 100 form so it cannot be confused with a percent", () => {
      expect(formatMetric(70.95, "score")).toBe("71.0 / 100");
      expect(formatMetric(0, "score")).toBe("0.0 / 100");
    });

    it("renders usd via formatCost", () => {
      expect(formatMetric(0.12, "usd")).toBe("$0.12");
    });

    it("renders count with locale grouping", () => {
      expect(formatMetric(12345, "count")).toBe("12,345");
    });

    it("renders duration_ms via formatDuration", () => {
      expect(formatMetric(1500, "duration_ms")).toBe("1.5s");
    });

    it("renders an em dash for null/undefined/non-finite", () => {
      expect(formatMetric(null, "rate")).toBe("—");
      expect(formatMetric(undefined, "score")).toBe("—");
      expect(formatMetric(NaN, "usd")).toBe("—");
      expect(formatMetric(Infinity, "rate")).toBe("—");
    });
  });

});
