// A-03b: al-sem 2.1.0-rc.4 (cross-app digest: dependency boundary groups, dependency unresolved calls on the Test app's entries).
// Fixture shapes follow real rc.4 output: all detail values are strings, a boundary group has no resourceDisplay.
import { assertEquals, assertThrows } from "@std/assert";
import {
  alsemEnvelope,
  DERIVATION,
  digestTouches,
  readDone,
  writeDone,
} from "../../../scripts/harness/analyze-campaign.ts";

const eff = (type: string, detail: Record<string, string>) => ({
  type,
  detail,
  evidence: [],
  viaPaths: [],
});
const boundary = (type: string) =>
  eff(type, {
    boundary: "Dep App.DoIt",
    resourceCount: "2",
    resources: "Dep A, Dep B",
  });
const entry = (
  file: string,
  stableId: string,
  effects: unknown[],
  extra: Record<string, unknown> = {},
) => ({
  routine: { stableId, anchor: { file } },
  effects,
  ...extra,
});
const digest = (entries: unknown[], totalUnresolved = 0) => ({
  entries,
  summary: { rootsRequested: 1, rootsResolved: 1, totalUnresolved },
  changedRootsDiagnostics: [],
});
const un = (n: number) => Array.from({ length: n }, (_, i) => ({ call: i }));

Deno.test("digestTouches: boundary groups on a production entry are counted in dependency_effect_groups, not in tables / events / commits", () => {
  const t = digestTouches(digest([
    entry("ws:Prod/src/A.al", "a", [
      boundary("DB_MODIFY"),
      boundary("COMMIT"),
      boundary("EVENT_PUBLISH"),
      boundary("DB_READ"),
      eff("DB_MODIFY", { resourceDisplay: "CGR Line" }),
      eff("COMMIT", {}),
    ]),
  ]));
  assertEquals(t.dependency_effect_groups, 4);
  assertEquals(t.tables_written, ["CGR Line"]);
  assertEquals(t.tables_read, []);
  assertEquals(t.events_published, []);
  assertEquals(t.commits, 1);
});

Deno.test("digestTouches: boundary groups on a Test entry are not counted", () => {
  const t = digestTouches(digest([
    entry("ws:Test/src/T.al", "t", [boundary("DB_MODIFY"), boundary("COMMIT")]),
    entry("ws:Prod/src/A.al", "a", []),
  ]));
  assertEquals(t.dependency_effect_groups, 0);
  assertEquals(t.commits, 0);
});

Deno.test("digestTouches: unresolved sums entries[].unresolved over production entries; unresolved_raw keeps summary.totalUnresolved", () => {
  const t = digestTouches(digest([
    entry("ws:Prod/src/A.al", "a", [], { unresolved: un(3) }),
    entry("ws:Prod/src/B.al", "b", []), // absent counts 0
    entry("ws:Test/src/T.al", "t", [], { unresolved: un(25) }),
  ], 28));
  assertEquals(t.unresolved, 3);
  assertEquals(t.unresolved_raw, 28);
});

const env = (payload: unknown) => ({
  alsemVersion: "2.1.0-rc.4",
  schemaVersion: "1.6.0",
  kind: "digest",
  diagnostics: [],
  payload,
});

Deno.test("alsemEnvelope: a digest entry with a non-array unresolved fails naming payload.entries[].unresolved; absent is accepted", () => {
  const bad = digest([
    entry("ws:Prod/src/A.al", "a", [], { unresolved: "x" }),
  ]);
  assertThrows(
    () => alsemEnvelope(env(bad), "digest"),
    Error,
    "payload.entries[].unresolved",
  );
  const ok = digest([entry("ws:Prod/src/A.al", "a", [])]);
  assertEquals(alsemEnvelope(env(ok), "digest").kind, "digest");
});

Deno.test("DERIVATION is 11: a done row written with derive 10 is not done", async () => {
  assertEquals(DERIVATION, 11);
  const dir = await Deno.makeTempDir();
  try {
    const stamp = { build: "b", rev: "r", hash: "h" };
    await writeDone(dir, "e1", { ...stamp, derive: 10 }, { id: "e1" });
    assertEquals(
      await readDone(dir, "e1", { ...stamp, derive: DERIVATION }),
      null,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
