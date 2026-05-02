import { describe, expect, it } from "vitest";
import { applyMarkHighlighting } from "./search-highlight";

describe("applyMarkHighlighting", () => {
  it("returns empty string for empty input", () => {
    expect(applyMarkHighlighting("", ["foo"])).toBe("");
  });

  it("returns escaped text unchanged when no tokens match", () => {
    expect(applyMarkHighlighting("hello world", ["xyz"])).toBe("hello world");
  });

  it("wraps a literal match with <mark>", () => {
    expect(applyMarkHighlighting("hello world", ["world"])).toBe(
      "hello <mark>world</mark>",
    );
  });

  it("wraps case-insensitively but preserves source case", () => {
    expect(applyMarkHighlighting("Hello World", ["world"])).toBe(
      "Hello <mark>World</mark>",
    );
  });

  it("HTML-escapes the text BEFORE wrapping", () => {
    // Adversarial: source text contains HTML tags. Escape them to prevent injection.
    const out = applyMarkHighlighting("<script>alert(1)</script>", ["script"]);
    expect(out).not.toContain("<script>"); // raw < > are escaped
    expect(out).toContain("&lt;");
    expect(out).toContain("<mark>script</mark>"); // mark wraps the literal token
  });

  it("treats regex-metachar tokens as literals (no regex injection)", () => {
    // ".*" must match the literal ".*" — not "any chars".
    const out = applyMarkHighlighting("foo.*bar", [".*"]);
    expect(out).toBe("foo<mark>.*</mark>bar");
  });

  it("handles parens and brackets in tokens", () => {
    const out = applyMarkHighlighting("AL0132 (E001)", ["(E001)"]);
    expect(out).toContain("<mark>(E001)</mark>");
  });

  it("handles unicode tokens (multibyte boundary)", () => {
    const out = applyMarkHighlighting("café résumé", ["résumé"]);
    expect(out).toContain("<mark>résumé</mark>");
  });

  it("truncates around the first match with ellipsis when text exceeds maxLen", () => {
    const long = "x".repeat(500) + " MATCHTOKEN " + "y".repeat(500);
    const out = applyMarkHighlighting(long, ["MATCHTOKEN"], 100);
    // Allow for ellipsis + <mark> wrapping overhead.
    expect(out.length).toBeLessThan(200);
    expect(out).toContain("<mark>MATCHTOKEN</mark>");
    expect(out).toMatch(/^…/); // leading ellipsis
    expect(out).toMatch(/…$/); // trailing ellipsis
  });

  it("starts from index 0 when no token matches and text is long", () => {
    const long = "x".repeat(500);
    const out = applyMarkHighlighting(long, ["nope"], 100);
    expect(out).not.toMatch(/^…/);
    expect(out).toMatch(/…$/);
    expect(out.startsWith("xxx")).toBe(true);
  });

  it("handles multiple tokens", () => {
    const out = applyMarkHighlighting("alpha bravo charlie", [
      "alpha",
      "charlie",
    ]);
    expect(out).toContain("<mark>alpha</mark>");
    expect(out).toContain("<mark>charlie</mark>");
    expect(out).not.toContain("<mark>bravo</mark>");
  });

  it("skips empty tokens without throwing", () => {
    expect(() => applyMarkHighlighting("hello", [""])).not.toThrow();
    expect(applyMarkHighlighting("hello", [""])).toBe("hello");
  });
});
