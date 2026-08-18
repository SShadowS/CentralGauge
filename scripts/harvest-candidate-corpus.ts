// harvest-candidate-corpus.ts — regenerate the committed fixture used by the
// resolveCandidate/classifyExtractionFailure behaviour-preservation test.
//
// Why this exists: tests/unit/llm/candidate-resolution.test.ts asserts that
// `resolveCandidate` (src/llm/candidate-resolution.ts) reproduces the exact
// extract -> cleanCode -> readiness-gate -> classify pipeline the bench used
// to run inline in LLMWorkPool.executeWork. That assertion is only as good
// as its corpus: a synthetic corpus proves nothing, and a live harvest of
// the operator's local `results/` (gitignored, not committed) means the
// test silently finds zero fixtures and hard-fails on a fresh clone or
// worktree. So the corpus is curated once here and committed as
// tests/fixtures/llm/candidate-corpus.json; this script is how you refresh
// it, not something the test suite runs itself.
//
// What it does: walks the operator's local `results/benchmark-results-*.json`
// run history (this machine only — those files are gitignored), extracts
// every recorded `(llmResponse.content, llmResponse.finishReason)` pair,
// buckets each by which `ExtractionMethod` `CodeExtractor.extract` assigns
// it, and selects a small, deterministic, size-bounded sample that covers
// every method plus the empty-response and safety-refusal edge cases.
// Selection order within a bucket is by a stable content hash, not harvest
// order, so re-running against a growing `results/` history doesn't just
// keep re-picking whatever happened to be encountered first.
//
// Usage: deno run --allow-read --allow-write scripts/harvest-candidate-corpus.ts
//   [--results-dir <dir>] [--out <file>]
//
// Regenerate whenever the bench's response corpus should be refreshed (e.g.
// a new model family/extraction shape is now common locally and should be
// represented). Re-running overwrites tests/fixtures/llm/candidate-corpus.json
// deterministically for a given `results/` snapshot; review the diff before
// committing, same as any other fixture change.

import { join } from "@std/path";
import { walk } from "@std/fs/walk";

import {
  CodeExtractor,
  type ExtractionMethod,
} from "../src/llm/code-extractor.ts";

interface RawResponse {
  content: string;
  finishReason: string;
}

interface FixtureEntry {
  content: string;
  finishReason: string;
}

/** Recursively find any object carrying an `attempts` array and pull each
 * attempt's `llmResponse.content` / `llmResponse.finishReason` out of it. */
function harvestFromValue(value: unknown, out: RawResponse[]): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) harvestFromValue(item, out);
    return;
  }
  const obj = value as Record<string, unknown>;
  if (Array.isArray(obj["attempts"])) {
    for (const attempt of obj["attempts"]) {
      const llmResponse = attempt && typeof attempt === "object"
        ? (attempt as Record<string, unknown>)["llmResponse"]
        : undefined;
      if (llmResponse && typeof llmResponse === "object") {
        const content = (llmResponse as Record<string, unknown>)["content"];
        const finishReason =
          (llmResponse as Record<string, unknown>)["finishReason"];
        if (typeof content === "string" && typeof finishReason === "string") {
          out.push({ content, finishReason });
        }
      }
    }
  }
  for (const nested of Object.values(obj)) harvestFromValue(nested, out);
}

/** Small stable hash for deterministic, harvest-order-independent sampling
 * (FNV-1a, 32-bit). Not cryptographic — just needs to spread evenly. */
function stableHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

interface BucketSpec {
  method: ExtractionMethod;
  target: number;
  maxLen: number;
}

// Per-bucket target count + length cap. Caps keep the fixture near the
// ~100KB budget despite some methods (greedy-fence, whole-response) skewing
// much larger in the real corpus (medians of 15KB+); targets are weighted
// toward the methods that dominate real bench traffic (custom-delimiters,
// tagged-fence) while still guaranteeing every method appears.
const BUCKET_SPECS: BucketSpec[] = [
  { method: "custom-delimiters", target: 25, maxLen: 2000 },
  { method: "tagged-fence", target: 25, maxLen: 2000 },
  { method: "pattern", target: 16, maxLen: 2000 },
  { method: "untagged-fence", target: 11, maxLen: 2500 },
  { method: "greedy-fence", target: 10, maxLen: 4000 },
  { method: "whole-response", target: 13, maxLen: 6000 },
];

function parseArgs(args: string[]): { resultsDir: string; out: string } {
  let resultsDir = join(Deno.cwd(), "results");
  let out = join(
    Deno.cwd(),
    "tests",
    "fixtures",
    "llm",
    "candidate-corpus.json",
  );
  for (let i = 0; i < args.length; i++) {
    const next = args[i + 1];
    if (args[i] === "--results-dir" && next) {
      resultsDir = next;
      i++;
    } else if (args[i] === "--out" && next) {
      out = next;
      i++;
    }
  }
  return { resultsDir, out };
}

async function main() {
  const { resultsDir, out } = parseArgs(Deno.args);

  const all: RawResponse[] = [];
  let fileCount = 0;
  for await (
    const entry of walk(resultsDir, {
      match: [/benchmark-results-.*\.json$/],
    })
  ) {
    if (!entry.isFile) continue;
    fileCount++;
    try {
      const parsed = JSON.parse(await Deno.readTextFile(entry.path));
      harvestFromValue(parsed, all);
    } catch {
      // Corrupt/partial file on disk — skip rather than abort the harvest.
    }
  }

  // Dedup on (content, finishReason) together, NOT content alone: an empty
  // response recorded once with finishReason="stop" and once with
  // finishReason="content_filter" are different, load-bearing fixtures —
  // deduping on content alone silently discards the content_filter case
  // whenever an identical-content "stop" entry was seen first.
  const seen = new Set<string>();
  const unique: RawResponse[] = [];
  for (const r of all) {
    const key = r.content + "" + r.finishReason;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(r);
    }
  }

  const byMethod = new Map<ExtractionMethod, RawResponse[]>();
  for (const r of unique) {
    const method = CodeExtractor.extract(r.content).method;
    const bucket = byMethod.get(method) ?? [];
    bucket.push(r);
    byMethod.set(method, bucket);
  }

  const selected: FixtureEntry[] = [];
  const selectedKeys = new Set<string>();
  const add = (r: RawResponse) => {
    const key = r.content + "" + r.finishReason;
    if (selectedKeys.has(key)) return;
    selectedKeys.add(key);
    selected.push({ content: r.content, finishReason: r.finishReason });
  };

  for (const spec of BUCKET_SPECS) {
    const pool = (byMethod.get(spec.method) ?? [])
      .filter((r) => r.content.length <= spec.maxLen);

    let required: RawResponse[] = [];
    if (spec.method === "whole-response") {
      // Guarantee the two edge cases that drive classifyExtractionFailure's
      // non-low_confidence branches: a genuinely empty response, and a
      // content_filter (safety refusal) response. Both extract as
      // "whole-response" (CodeExtractor.extract("") never matches any
      // delimiter/fence/pattern), so this bucket is where they live.
      const emptyStop = pool.find(
        (r) => r.content.trim().length === 0 && r.finishReason === "stop",
      );
      const contentFilter = pool.find(
        (r) => r.finishReason === "content_filter",
      );
      required = [emptyStop, contentFilter].filter((r): r is RawResponse =>
        r !== undefined
      );
    }

    const requiredKeys = new Set(
      required.map((r) => r.content + "" + r.finishReason),
    );
    const rest = pool
      .filter((r) => !requiredKeys.has(r.content + "" + r.finishReason))
      .sort((a, b) => stableHash(a.content) - stableHash(b.content));

    for (const r of required) add(r);
    for (const r of rest) {
      if (
        selected.filter((e) =>
          CodeExtractor.extract(e.content).method === spec.method
        ).length >= spec.target
      ) break;
      add(r);
    }
  }

  // Report per-method coverage before writing, so a bucket that came up
  // empty (a method absent from local `results/` entirely) is visible
  // immediately rather than discovered later by the coverage test.
  const coverage = new Map<ExtractionMethod, number>();
  for (const e of selected) {
    const m = CodeExtractor.extract(e.content).method;
    coverage.set(m, (coverage.get(m) ?? 0) + 1);
  }
  console.log(
    `Scanned ${fileCount} result files, ${unique.length} unique (content, finishReason) pairs.`,
  );
  console.log("Selected", selected.length, "entries:");
  for (const spec of BUCKET_SPECS) {
    console.log(`  ${spec.method}: ${coverage.get(spec.method) ?? 0}`);
  }
  const hasEmpty = selected.some((e) =>
    e.content.trim().length === 0 && e.finishReason === "stop"
  );
  const hasContentFilter = selected.some((e) =>
    e.finishReason === "content_filter"
  );
  console.log(
    `  (empty-content stop example: ${hasEmpty ? "yes" : "NONE FOUND"})`,
  );
  console.log(
    `  (content_filter example: ${hasContentFilter ? "yes" : "NONE FOUND"})`,
  );

  const missing = BUCKET_SPECS.filter((s) =>
    (coverage.get(s.method) ?? 0) === 0
  );
  if (missing.length > 0) {
    console.error(
      "ERROR: no local examples found for method(s):",
      missing.map((s) => s.method).join(", "),
      "- widen --results-dir history or the bucket's maxLen before committing a fixture with a coverage gap.",
    );
    Deno.exit(1);
  }

  await Deno.mkdir(join(out, ".."), { recursive: true });
  await Deno.writeTextFile(out, JSON.stringify(selected, null, 2) + "\n");
  console.log("Wrote", out);
}

if (import.meta.main) {
  await main();
}
