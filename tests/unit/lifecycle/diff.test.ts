import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertExists, assertRejects } from "@std/assert";
import {
  computeGenerationDiff,
  type DiffDb,
  parseAnalyzerModel,
} from "../../../src/lifecycle/diff.ts";

type Row = Record<string, unknown>;

interface ShortcomingCountRow extends Row {
  analysis_event_id: number;
  concept_id: number;
  slug: string;
  display_name: string;
  description: string;
  al_concept: string;
  first_seen: number;
  count: number;
}

interface LifecycleEventRow extends Row {
  id: number;
  model_slug: string;
  payload_json: string;
}

/**
 * In-memory `DiffDb` shim. Routes SQL by string-match (the diff function
 * only emits two distinct queries: lifecycle_events lookup by id, and
 * shortcomings JOIN concepts grouped by analysis_event_id), so a regex
 * dispatcher is enough — the production path goes against real D1.
 */
function makeDb(table: {
  lifecycle_events?: LifecycleEventRow[];
  shortcoming_counts?: ShortcomingCountRow[];
}): DiffDb {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            // deno-lint-ignore require-await
            async first<T>(): Promise<T | null> {
              const rows = matchRows(sql, params, table);
              return (rows[0] ?? null) as T | null;
            },
            // deno-lint-ignore require-await
            async all<T>(): Promise<{ results: T[] }> {
              return { results: matchRows(sql, params, table) as T[] };
            },
          };
        },
      };
    },
  };
}

function matchRows(
  sql: string,
  params: unknown[],
  table: {
    lifecycle_events?: LifecycleEventRow[];
    shortcoming_counts?: ShortcomingCountRow[];
  },
): Row[] {
  if (sql.includes("FROM lifecycle_events")) {
    return (table.lifecycle_events ?? []).filter((r) => r.id === params[0]);
  }
  if (sql.includes("FROM shortcomings s")) {
    return (table.shortcoming_counts ?? []).filter(
      (r) => r.analysis_event_id === params[0],
    );
  }
  return [];
}

const ANALYZER_OPUS = "anthropic/claude-opus-4-6";
const ANALYZER_GPT = "openai/gpt-5.5";

describe("computeGenerationDiff", () => {
  it("returns analyzer_mismatch when analyzers differ — no buckets", async () => {
    const db = makeDb({
      lifecycle_events: [
        {
          id: 100,
          model_slug: "anthropic/claude-x-4-6",
          payload_json: JSON.stringify({ analyzer_model: ANALYZER_OPUS }),
        },
        {
          id: 200,
          model_slug: "anthropic/claude-x-4-7",
          payload_json: JSON.stringify({ analyzer_model: ANALYZER_GPT }),
        },
      ],
    });
    const r = await computeGenerationDiff(db, {
      family_slug: "anthropic/claude-x",
      task_set_hash: "h",
      from_gen_event_id: 100,
      to_gen_event_id: 200,
    });
    assertEquals(r.status, "analyzer_mismatch");
    assertEquals(r.resolved, undefined);
    assertEquals(r.persisting, undefined);
    assertEquals(r.regressed, undefined);
    assertEquals(r.new, undefined);
    assertEquals(r.analyzer_model_a, ANALYZER_OPUS);
    assertEquals(r.analyzer_model_b, ANALYZER_GPT);
    assertEquals(r.from_model_slug, "anthropic/claude-x-4-6");
    assertEquals(r.to_model_slug, "anthropic/claude-x-4-7");
  });

  it("returns baseline_missing when from_gen_event_id is null", async () => {
    const db = makeDb({
      lifecycle_events: [
        {
          id: 200,
          model_slug: "anthropic/claude-x-4-7",
          payload_json: JSON.stringify({ analyzer_model: ANALYZER_OPUS }),
        },
      ],
    });
    const r = await computeGenerationDiff(db, {
      family_slug: "anthropic/claude-x",
      task_set_hash: "h",
      from_gen_event_id: null,
      to_gen_event_id: 200,
    });
    assertEquals(r.status, "baseline_missing");
    assertEquals(r.from_gen_event_id, null);
    assertEquals(r.from_model_slug, null);
    assertEquals(r.analyzer_model_a, null);
    assertEquals(r.analyzer_model_b, ANALYZER_OPUS);
    assertEquals(r.resolved, undefined);
    assertEquals(r.persisting, undefined);
    assertEquals(r.regressed, undefined);
    assertEquals(r.new, undefined);
  });

  it("comparable: 4 buckets correct on synthetic 2-gen fixture", async () => {
    // gen_a (event 100) hit concepts {1: 5, 2: 3}
    // gen_b (event 200) hit concepts {1: 1, 3: 4}
    // resolved = {2}, persisting = {1: delta -4}, new = {3} (first_seen=150 > 100), regressed = {}
    const db = makeDb({
      lifecycle_events: [
        {
          id: 100,
          model_slug: "anthropic/claude-x-4-6",
          payload_json: JSON.stringify({ analyzer_model: ANALYZER_OPUS }),
        },
        {
          id: 200,
          model_slug: "anthropic/claude-x-4-7",
          payload_json: JSON.stringify({ analyzer_model: ANALYZER_OPUS }),
        },
      ],
      shortcoming_counts: [
        {
          analysis_event_id: 100,
          concept_id: 1,
          slug: "c1",
          display_name: "C1",
          description: "first",
          al_concept: "al1",
          first_seen: 50,
          count: 5,
        },
        {
          analysis_event_id: 100,
          concept_id: 2,
          slug: "c2",
          display_name: "C2",
          description: "second",
          al_concept: "al2",
          first_seen: 60,
          count: 3,
        },
        {
          analysis_event_id: 200,
          concept_id: 1,
          slug: "c1",
          display_name: "C1",
          description: "first",
          al_concept: "al1",
          first_seen: 50,
          count: 1,
        },
        {
          analysis_event_id: 200,
          concept_id: 3,
          slug: "c3",
          display_name: "C3",
          description: "third",
          al_concept: "al3",
          first_seen: 150,
          count: 4,
        },
      ],
    });
    const r = await computeGenerationDiff(db, {
      family_slug: "anthropic/claude-x",
      task_set_hash: "h",
      from_gen_event_id: 100,
      to_gen_event_id: 200,
    });
    assertEquals(r.status, "comparable");
    assertExists(r.resolved);
    assertExists(r.persisting);
    assertExists(r.regressed);
    assertExists(r.new);
    assertEquals(r.resolved!.map((c) => c.slug), ["c2"]);
    assertEquals(r.resolved![0]!.delta, 3); // gen_a count 3 dropped to 0
    assertEquals(r.persisting!.map((c) => c.slug), ["c1"]);
    assertEquals(r.persisting![0]!.delta, -4); // 1 - 5
    assertEquals(r.new!.map((c) => c.slug), ["c3"]); // first_seen 150 > from_event_id 100
    assertEquals(r.new![0]!.delta, 4);
    assertEquals(r.regressed!.length, 0);
  });

  it("comparable: regressed bucket fires when concept pre-existed but absent in gen_a", async () => {
    // gen_a (event 100) hit {} — no shortcomings.
    // gen_b (event 200) hit {1: 2}.
    // Concept 1's first_seen = 5 (long before event 100) ⇒ it existed at
    // gen_a's time but didn't appear in gen_a's analysis. Bucket = regressed,
    // NOT 'new' (which is reserved for analyzer-discovered post-gen_a concepts).
    const db = makeDb({
      lifecycle_events: [
        {
          id: 100,
          model_slug: "anthropic/claude-x-4-6",
          payload_json: JSON.stringify({ analyzer_model: ANALYZER_OPUS }),
        },
        {
          id: 200,
          model_slug: "anthropic/claude-x-4-7",
          payload_json: JSON.stringify({ analyzer_model: ANALYZER_OPUS }),
        },
      ],
      shortcoming_counts: [
        {
          analysis_event_id: 200,
          concept_id: 1,
          slug: "c1",
          display_name: "C1",
          description: "first",
          al_concept: "al1",
          first_seen: 5,
          count: 2,
        },
      ],
    });
    const r = await computeGenerationDiff(db, {
      family_slug: "anthropic/claude-x",
      task_set_hash: "h",
      from_gen_event_id: 100,
      to_gen_event_id: 200,
    });
    assertEquals(r.status, "comparable");
    assertEquals(r.regressed!.map((c) => c.slug), ["c1"]);
    assertEquals(r.regressed![0]!.delta, 2);
    assertEquals(r.new!.length, 0);
  });

  it("3-gen transitive: concept C in gen_1, absent gen_2, present gen_3 → regressed in (2→3)", async () => {
    // events: 100, 200, 300 — same analyzer.
    // shortcomings:
    //   gen_1 (100): C
    //   gen_2 (200): (none)
    //   gen_3 (300): C
    // diff(2→3) buckets C as regressed (existed at gen_2's time, absent then,
    // appeared again now). The strategic plan calls this transitive resolution
    // detection — the concept persists across the family even when an
    // intermediate gen happened to skip it.
    const db = makeDb({
      lifecycle_events: [
        {
          id: 100,
          model_slug: "anthropic/claude-x-4-5",
          payload_json: JSON.stringify({ analyzer_model: ANALYZER_OPUS }),
        },
        {
          id: 200,
          model_slug: "anthropic/claude-x-4-6",
          payload_json: JSON.stringify({ analyzer_model: ANALYZER_OPUS }),
        },
        {
          id: 300,
          model_slug: "anthropic/claude-x-4-7",
          payload_json: JSON.stringify({ analyzer_model: ANALYZER_OPUS }),
        },
      ],
      shortcoming_counts: [
        {
          analysis_event_id: 100,
          concept_id: 1,
          slug: "c1",
          display_name: "C1",
          description: "",
          al_concept: "al",
          first_seen: 50,
          count: 1,
        },
        // gen_2 (200) is absent.
        {
          analysis_event_id: 300,
          concept_id: 1,
          slug: "c1",
          display_name: "C1",
          description: "",
          al_concept: "al",
          first_seen: 50,
          count: 1,
        },
      ],
    });
    const r2to3 = await computeGenerationDiff(db, {
      family_slug: "anthropic/claude-x",
      task_set_hash: "h",
      from_gen_event_id: 200,
      to_gen_event_id: 300,
    });
    assertEquals(r2to3.status, "comparable");
    assertEquals(r2to3.regressed!.map((c) => c.slug), ["c1"]);

    // diff(1→3) shows C as persisting (present in both, delta 0).
    const r1to3 = await computeGenerationDiff(db, {
      family_slug: "anthropic/claude-x",
      task_set_hash: "h",
      from_gen_event_id: 100,
      to_gen_event_id: 300,
    });
    assertEquals(r1to3.status, "comparable");
    assertEquals(r1to3.persisting!.map((c) => c.slug), ["c1"]);
    assertEquals(r1to3.persisting![0]!.delta, 0);
  });

  it("throws on missing analyzer_model in to-event payload_json", async () => {
    const db = makeDb({
      lifecycle_events: [
        {
          id: 100,
          model_slug: "a/x-4-6",
          payload_json: JSON.stringify({}),
        },
      ],
    });
    await assertRejects(
      () =>
        computeGenerationDiff(db, {
          family_slug: "a/x",
          task_set_hash: "h",
          from_gen_event_id: null,
          to_gen_event_id: 100,
        }),
      Error,
      "analyzer_model",
    );
  });

  it("throws on missing analyzer_model in from-event payload_json", async () => {
    const db = makeDb({
      lifecycle_events: [
        {
          id: 100,
          model_slug: "a/x-4-6",
          // analyzer_model present at to-event but missing at from-event
          payload_json: JSON.stringify({}),
        },
        {
          id: 200,
          model_slug: "a/x-4-7",
          payload_json: JSON.stringify({ analyzer_model: ANALYZER_OPUS }),
        },
      ],
    });
    await assertRejects(
      () =>
        computeGenerationDiff(db, {
          family_slug: "a/x",
          task_set_hash: "h",
          from_gen_event_id: 100,
          to_gen_event_id: 200,
        }),
      Error,
      "analyzer_model",
    );
  });

  it("throws when to_gen_event is not analysis.completed (or missing)", async () => {
    const db = makeDb({ lifecycle_events: [] });
    await assertRejects(
      () =>
        computeGenerationDiff(db, {
          family_slug: "a/x",
          task_set_hash: "h",
          from_gen_event_id: null,
          to_gen_event_id: 999,
        }),
      Error,
      "not found",
    );
  });

  it("throws when from_gen_event is not analysis.completed (or missing)", async () => {
    const db = makeDb({
      lifecycle_events: [
        {
          id: 200,
          model_slug: "a/x-4-7",
          payload_json: JSON.stringify({ analyzer_model: ANALYZER_OPUS }),
        },
      ],
    });
    await assertRejects(
      () =>
        computeGenerationDiff(db, {
          family_slug: "a/x",
          task_set_hash: "h",
          from_gen_event_id: 999,
          to_gen_event_id: 200,
        }),
      Error,
      "not found",
    );
  });
});

describe("parseAnalyzerModel", () => {
  it("extracts analyzer_model from canonical payload", () => {
    assertEquals(
      parseAnalyzerModel(JSON.stringify({ analyzer_model: ANALYZER_OPUS })),
      ANALYZER_OPUS,
    );
  });

  it("throws on missing field", () => {
    let threw = false;
    try {
      parseAnalyzerModel(JSON.stringify({ other: "x" }));
    } catch (e) {
      threw = true;
      assert(e instanceof Error);
      assert(e.message.includes("analyzer_model"));
    }
    assert(threw, "expected throw");
  });

  it("throws on empty string", () => {
    let threw = false;
    try {
      parseAnalyzerModel(JSON.stringify({ analyzer_model: "" }));
    } catch (e) {
      threw = true;
      assert(e instanceof Error);
    }
    assert(threw, "expected throw on empty analyzer_model");
  });

  it("throws on non-string analyzer_model", () => {
    let threw = false;
    try {
      parseAnalyzerModel(JSON.stringify({ analyzer_model: 42 }));
    } catch (e) {
      threw = true;
      assert(e instanceof Error);
    }
    assert(threw, "expected throw on numeric analyzer_model");
  });

  it("throws on malformed JSON", () => {
    let threw = false;
    try {
      parseAnalyzerModel("{not-json");
    } catch (e) {
      threw = true;
      assert(e instanceof Error);
    }
    assert(threw, "expected throw on bad JSON");
  });
});
