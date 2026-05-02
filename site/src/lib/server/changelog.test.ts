import { describe, expect, it } from "vitest";
import { parseChangelog, slugifyTitle } from "./changelog";

describe("slugifyTitle", () => {
  it("lowercases and replaces non-alphanumeric runs with single dashes", () => {
    expect(slugifyTitle("P7 — Stat parity restored")).toBe(
      "p7-stat-parity-restored",
    );
  });

  it("strips leading and trailing dashes", () => {
    expect(slugifyTitle("  Hello, world!  ")).toBe("hello-world");
  });

  it("collapses multiple non-alphanumeric chars into one dash", () => {
    expect(slugifyTitle("A — B / C")).toBe("a-b-c");
  });

  it("returns empty string for empty input", () => {
    expect(slugifyTitle("")).toBe("");
  });
});

describe("parseChangelog", () => {
  it("returns empty array for empty input", () => {
    expect(parseChangelog("")).toEqual([]);
  });

  it("returns empty array for input with no entry headers", () => {
    expect(parseChangelog("# Site changelog\n\nIntro text only.")).toEqual([]);
  });

  it("parses a single entry with title, date, slug, and body", () => {
    const md = "## P7 shipped (2026-04-29)\n\nClosed parity gap.\n";
    const entries = parseChangelog(md);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("P7 shipped");
    expect(entries[0].date).toBe("2026-04-29");
    expect(entries[0].slug).toBe("p7-shipped");
    expect(entries[0].body).toBe("Closed parity gap.");
  });

  it("sorts entries newest-first regardless of file order", () => {
    const md = [
      "## Old (2026-01-01)",
      "",
      "old body",
      "",
      "## Newer (2026-04-01)",
      "",
      "newer body",
      "",
      "## Newest (2026-04-29)",
      "",
      "newest body",
      "",
    ].join("\n");
    const entries = parseChangelog(md);
    expect(entries.map((e) => e.date)).toEqual([
      "2026-04-29",
      "2026-04-01",
      "2026-01-01",
    ]);
  });

  it("discards preamble before the first entry header", () => {
    const md = [
      "# CentralGauge changelog",
      "",
      "This is intro text that should not appear in any entry body.",
      "",
      "## Real entry (2026-04-29)",
      "",
      "real body",
    ].join("\n");
    const entries = parseChangelog(md);
    expect(entries).toHaveLength(1);
    expect(entries[0].body).toBe("real body");
    expect(entries[0].body).not.toContain("intro text");
  });

  it("preserves blank lines between paragraphs in body", () => {
    const md = [
      "## Entry (2026-04-29)",
      "",
      "first paragraph",
      "",
      "second paragraph",
      "",
      "## Older (2026-04-28)",
      "",
      "older",
    ].join("\n");
    const entries = parseChangelog(md);
    expect(entries[0].body).toBe("first paragraph\n\nsecond paragraph");
  });

  it("ignores ## headers without a (YYYY-MM-DD) suffix", () => {
    const md = [
      "## Some non-entry section",
      "",
      "random body",
      "",
      "## Real entry (2026-04-29)",
      "",
      "real body",
    ].join("\n");
    const entries = parseChangelog(md);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("Real entry");
  });

  it("handles CRLF line endings", () => {
    const md = "## Entry (2026-04-29)\r\n\r\nbody\r\n";
    const entries = parseChangelog(md);
    expect(entries).toHaveLength(1);
    expect(entries[0].body).toBe("body");
  });

  it("returns empty array for non-string inputs (defensive)", () => {
    // @ts-expect-error - testing runtime defensiveness
    expect(parseChangelog(null)).toEqual([]);
    // @ts-expect-error - testing runtime defensiveness
    expect(parseChangelog(undefined)).toEqual([]);
  });
});
