import { describe, it, expect } from "vitest";
import { marked } from "marked";
import { reflowDescription } from "./reflow-description";

const html = (s: string) =>
  marked.parse(reflowDescription(s), { async: false }) as string;

describe("reflowDescription", () => {
  it("turns indented bullets after prose into a list", () => {
    const out = reflowDescription(
      "Create two tables:\n   - Code (Code[10])\n   - Name (Text[50])",
    );
    expect(out).toBe(
      "Create two tables:\n\n- Code (Code[10])\n- Name (Text[50])",
    );
  });

  it("keeps an ordered list with nested bullets as one numbered list", () => {
    // M010 shape: numbering used to restart at every item.
    const stored =
      'Scenario:\n1. Project table with fields:\n   - "Project Code" (Code[20])\n   - Name (Text[100])\n\n' +
      '   Primary key is "Project Code"\n\n2. Project card page\n3. Codeunit';
    const h = html(stored);
    expect(h.match(/<ol/g)?.length).toBe(1);
    expect(h).toMatch(
      /<li>[\s\S]*<ul>[\s\S]*Project Code[\s\S]*<\/ul>[\s\S]*Primary key[\s\S]*<\/li>/,
    );
    expect(h).toContain("Codeunit");
  });

  it("keeps a 4-space indented signature as a code block", () => {
    const stored =
      'Create codeunit "X" with:\n\n    procedure PostBatch(BatchId: Integer): Boolean\n\nGiven a batch id...';
    expect(html(stored)).toContain(
      "<pre><code>procedure PostBatch(BatchId: Integer): Boolean",
    );
  });

  it("turns one-sentence-per-line prose into paragraphs", () => {
    const h = html("First requirement.\nSecond requirement.");
    expect(h.match(/<p>/g)?.length).toBe(2);
  });

  it('splits a folded "intro: - A - B" list but keeps lowercase prose dashes', () => {
    const stored =
      "public procedures: - CapitalizeFirstLetter(InputText: Text): Text - capitalizes the first letter - CountWords(InputText: Text): Integer - counts words";
    expect(reflowDescription(stored)).toBe(
      "public procedures:\n\n- CapitalizeFirstLetter(InputText: Text): Text - capitalizes the first letter\n" +
        "- CountWords(InputText: Text): Integer - counts words",
    );
  });

  it("splits a folded list whose items repeat a lowercase leading token", () => {
    const out = reflowDescription(
      "with values: - value(0; None) - value(1; EmptyField)",
    );
    expect(out).toBe(
      "with values:\n\n- value(0; None)\n- value(1; EmptyField)",
    );
  });

  it('does not split a single " - " after a colon', () => {
    const stored = "Note: - this is one aside";
    expect(reflowDescription(stored)).toBe(stored);
  });

  it("keeps multi-line samples under a list item on their own lines", () => {
    const h = html("1. Returns a query:\n   SELECT A\n   FROM T");
    expect(h).toMatch(/SELECT A<br>\s*FROM T/);
  });

  it("returns empty input unchanged and leaves a plain paragraph alone", () => {
    expect(reflowDescription("")).toBe("");
    const p = "Create a codeunit that validates input and returns a boolean.";
    expect(reflowDescription(p)).toBe(p);
  });
});
