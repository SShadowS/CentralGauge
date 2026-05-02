import { describe, expect, it } from "vitest";
import { formatSettingsSuffix } from "./settings-suffix";

describe("formatSettingsSuffix", () => {
  it("returns empty string for null profile", () => {
    expect(formatSettingsSuffix(null)).toBe("");
  });

  it("returns empty string when both fields are null", () => {
    expect(formatSettingsSuffix({ temperature: null, max_tokens: null })).toBe(
      "",
    );
  });

  it("renders temperature only", () => {
    expect(formatSettingsSuffix({ temperature: 0.1, max_tokens: null })).toBe(
      " (t0.1)",
    );
  });

  it("renders max_tokens only", () => {
    expect(formatSettingsSuffix({ temperature: null, max_tokens: 50000 })).toBe(
      " (50K)",
    );
  });

  it("renders both when present (max_tokens first)", () => {
    expect(formatSettingsSuffix({ temperature: 0.1, max_tokens: 50000 })).toBe(
      " (50K, t0.1)",
    );
  });

  it("renders temperature 0 as t0 (no decimal)", () => {
    expect(formatSettingsSuffix({ temperature: 0, max_tokens: null })).toBe(
      " (t0)",
    );
  });

  it("rounds max_tokens to nearest integer K", () => {
    expect(formatSettingsSuffix({ temperature: null, max_tokens: 1234 })).toBe(
      " (1K)",
    );
  });

  it("rounds temperature to one decimal", () => {
    expect(formatSettingsSuffix({ temperature: 0.123456, max_tokens: null }))
      .toBe(" (t0.1)");
  });

  it("treats max_tokens 0 as absent", () => {
    expect(formatSettingsSuffix({ temperature: 0.5, max_tokens: 0 })).toBe(
      " (t0.5)",
    );
  });
});
