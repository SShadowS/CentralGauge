import { join } from "@std/path";
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

import type { ExtractionMethod } from "../../../src/llm/code-extractor.ts";
import {
  classifyExtractionFailure,
  resolveCandidate,
} from "../../../src/llm/candidate-resolution.ts";
import { CodeExtractor } from "../../../src/llm/code-extractor.ts";

const AL = 'codeunit 70001 "X"\n{\n    procedure P() begin end;\n}';

describe("llm/candidate-resolution", () => {
  it("resolves a well-formed BEGIN-CODE response as ready", () => {
    const r = resolveCandidate(`BEGIN-CODE\n${AL}\nEND-CODE`, "stop");
    assertEquals(r.method, "custom-delimiters");
    assertEquals(r.isReadyForCompile, true);
    assertEquals(r.failure, undefined);
    assertEquals(r.cleanedCode.includes("codeunit 70001"), true);
  });

  it("classifies an empty response, keeping the historical error string", () => {
    const r = resolveCandidate("", "stop");
    assertEquals(r.isReadyForCompile, false);
    assertEquals(r.failure?.error, "Model returned empty response");
    assertEquals(r.failure?.failureKind, "empty_response");
  });

  it("classifies a safety refusal ahead of emptiness", () => {
    const r = resolveCandidate("", "content_filter");
    assertEquals(r.failure?.error, "API safety refusal (stop_reason=refusal)");
    assertEquals(r.failure?.failureKind, "safety_refusal");
  });

  it("classifies low confidence with the percentage in the message", () => {
    const r = resolveCandidate("maybe some prose about tables", "stop");
    if (r.isReadyForCompile) throw new Error("fixture should not be ready");
    assertEquals(r.failure?.failureKind, "low_confidence");
    assertEquals(
      r.failure?.error.startsWith("Insufficient code quality"),
      true,
    );
  });

  it("gates readiness on confidence > 0.5 AND non-empty cleaned code", () => {
    const ready = resolveCandidate(`BEGIN-CODE\n${AL}\nEND-CODE`, "stop");
    assertEquals(ready.confidence > 0.5, true);
    assertEquals(ready.isReadyForCompile, true);

    const empty = resolveCandidate("BEGIN-CODE\n\nEND-CODE", "stop");
    assertEquals(empty.isReadyForCompile, false);
  });
});

/** The pipeline exactly as it was written inline in executeWork. */
function inlinePipelineReference(
  raw: string,
  finishReason: Parameters<typeof classifyExtractionFailure>[0],
) {
  const extracted = CodeExtractor.extract(raw);
  const cleanedCode = CodeExtractor.cleanCode(
    extracted.code,
    extracted.language === "diff" ? "diff" : "al",
  );
  const isReadyForCompile = extracted.confidence > 0.5 &&
    cleanedCode.trim().length > 0;
  return {
    cleanedCode,
    isReadyForCompile,
    failure: isReadyForCompile ? undefined : classifyExtractionFailure(
      finishReason,
      cleanedCode,
      extracted.confidence,
    ),
  };
}

interface RawResponse {
  content: string;
  finishReason: Parameters<typeof classifyExtractionFailure>[0];
}

/**
 * Curated fixture of real recorded LLM responses, harvested once from local
 * `results/benchmark-results-*.json` run history (gitignored, not committed
 * — see `scripts/harvest-candidate-corpus.ts`'s header) and committed here
 * so the preservation test is deterministic on every machine, not just one
 * with enough local bench history. Regenerate with:
 *
 *   deno run --allow-read --allow-write scripts/harvest-candidate-corpus.ts
 *
 * Selected to cover every `ExtractionMethod` plus the empty-response and
 * content_filter (safety refusal) edge cases — see the coverage test below.
 */
const FIXTURE_PATH = join(
  import.meta.dirname ?? ".",
  "..",
  "..",
  "fixtures",
  "llm",
  "candidate-corpus.json",
);

async function loadFixtureCorpus(): Promise<RawResponse[]> {
  const raw = JSON.parse(await Deno.readTextFile(FIXTURE_PATH));
  if (!Array.isArray(raw)) {
    throw new Error(`Fixture at ${FIXTURE_PATH} is not a JSON array`);
  }
  return raw.map((entry, i) => {
    if (
      typeof entry !== "object" || entry === null ||
      typeof (entry as Record<string, unknown>)["content"] !== "string" ||
      typeof (entry as Record<string, unknown>)["finishReason"] !== "string"
    ) {
      throw new Error(
        `Fixture entry ${i} is malformed: ${
          JSON.stringify(entry).slice(0, 200)
        }`,
      );
    }
    const e = entry as { content: string; finishReason: string };
    return {
      content: e.content,
      finishReason: e.finishReason as RawResponse["finishReason"],
    };
  });
}

describe("llm/candidate-resolution: behaviour preservation", () => {
  it("matches the inline pipeline on the committed response corpus", async () => {
    const raws = await loadFixtureCorpus();
    assertEquals(
      raws.length > 50,
      true,
      "fixture is truncated or corrupted — regenerate it, don't lower this guard",
    );

    for (const { content, finishReason } of raws) {
      const got = resolveCandidate(content, finishReason);
      const want = inlinePipelineReference(content, finishReason);
      assertEquals(got.cleanedCode, want.cleanedCode);
      assertEquals(got.isReadyForCompile, want.isReadyForCompile);
      assertEquals(got.failure?.error, want.failure?.error);
      assertEquals(got.failure?.failureKind, want.failure?.failureKind);
    }
  });
});

// Every ExtractionMethod the type allows. A `Record` (not a plain array)
// so TypeScript enforces exhaustiveness: adding a 7th ExtractionMethod
// without adding a key here is a compile error, not a silently-incomplete
// coverage check.
const ALL_EXTRACTION_METHODS: Record<ExtractionMethod, true> = {
  "custom-delimiters": true,
  "tagged-fence": true,
  "untagged-fence": true,
  "greedy-fence": true,
  "pattern": true,
  "whole-response": true,
};

describe("llm/candidate-resolution: fixture coverage", () => {
  it("covers every ExtractionMethod, by re-extraction, not a stored label", async () => {
    const raws = await loadFixtureCorpus();
    const seenMethods = new Set(
      raws.map((r) => CodeExtractor.extract(r.content).method),
    );
    for (
      const method of Object.keys(ALL_EXTRACTION_METHODS) as ExtractionMethod[]
    ) {
      assertEquals(
        seenMethods.has(method),
        true,
        `fixture has no example that extracts as "${method}" — regenerate via scripts/harvest-candidate-corpus.ts`,
      );
    }
  });
});
