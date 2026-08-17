import { join } from "@std/path";
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";

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
 * Recursively find every object carrying an `attempts` array (result files
 * nest these at varying depths across the corpus's history) and pull each
 * attempt's `llmResponse.content` / `llmResponse.finishReason` out of it,
 * skipping attempts that are missing either field.
 */
function harvestFromValue(
  value: unknown,
  out: RawResponse[],
  limit: number,
): void {
  if (out.length >= limit || value === null || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (out.length >= limit) return;
      harvestFromValue(item, out, limit);
    }
    return;
  }
  const obj = value as Record<string, unknown>;
  if (Array.isArray(obj["attempts"])) {
    for (const attempt of obj["attempts"]) {
      if (out.length >= limit) return;
      const llmResponse = attempt && typeof attempt === "object"
        ? (attempt as Record<string, unknown>)["llmResponse"]
        : undefined;
      if (llmResponse && typeof llmResponse === "object") {
        const content = (llmResponse as Record<string, unknown>)["content"];
        const finishReason =
          (llmResponse as Record<string, unknown>)["finishReason"];
        if (typeof content === "string" && typeof finishReason === "string") {
          out.push({
            content,
            finishReason: finishReason as RawResponse["finishReason"],
          });
        }
      }
    }
  }
  for (const nested of Object.values(obj)) {
    if (out.length >= limit) return;
    harvestFromValue(nested, out, limit);
  }
}

/** Recursively yield every `benchmark-results-*.json` path under `dir`. */
async function* walkBenchmarkResultFiles(
  dir: string,
): AsyncGenerator<string> {
  let entries: Deno.DirEntry[];
  try {
    entries = await Array.fromAsync(Deno.readDir(dir));
  } catch {
    return; // dir absent entirely — harvestRawResponses reports 0, not a crash
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) {
      yield* walkBenchmarkResultFiles(path);
    } else if (
      entry.isFile && /^benchmark-results-.*\.json$/.test(entry.name)
    ) {
      yield path;
    }
  }
}

/**
 * Read up to `limit` real `(content, finishReason)` pairs out of the
 * committed `results/benchmark-results-*.json` fixtures. Read-only: never
 * writes to `results/`.
 */
async function harvestRawResponses(limit: number): Promise<RawResponse[]> {
  const out: RawResponse[] = [];
  const resultsDir = join(Deno.cwd(), "results");
  for await (const path of walkBenchmarkResultFiles(resultsDir)) {
    if (out.length >= limit) break;
    let parsed: unknown;
    try {
      parsed = JSON.parse(await Deno.readTextFile(path));
    } catch {
      continue; // corrupt/partial file on disk — skip, don't fail the corpus
    }
    harvestFromValue(parsed, out, limit);
  }
  return out;
}

describe("llm/candidate-resolution: behaviour preservation", () => {
  it("matches the inline pipeline on a corpus of real responses", async () => {
    const raws = await harvestRawResponses(300);
    assertEquals(raws.length > 50, true, "need a real corpus, not a stub");

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
