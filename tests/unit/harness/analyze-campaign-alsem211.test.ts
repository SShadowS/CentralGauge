// Q-08: al-sem 2.1.1 (digest schemaVersion 1.7.0). 1.7.0 adds the changed-roots diagnostic
// diff-file-ambiguous (#77: a diff file that names two workspace files gives no roots), and
// 2.1.1 ships opt-in table reads (--include-reads, #246: DB_READ effects, payload.includeReads).
// The runner never passes --include-reads; every rc.4 digest of P-02 and M8-16a (451) holds only
// diff-file-deleted, diff-file-unmatched and hunk-outside-routines, and no DB_READ.
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
const entry = (file: string, stableId: string, effects: unknown[]) => ({
  routine: { stableId, anchor: { file } },
  effects,
});
const digest = (
  entries: unknown[],
  diags: unknown[] = [],
  extra: Record<string, unknown> = {},
) => ({
  entries,
  summary: { rootsRequested: 1, rootsResolved: 1, totalUnresolved: 0 },
  changedRootsDiagnostics: diags,
  ...extra,
});
const env = (payload: unknown, schemaVersion: string) => ({
  alsemVersion: "2.1.1",
  schemaVersion,
  kind: "digest",
  diagnostics: [],
  payload,
});
const prod = entry("ws:Prod/src/A.al", "a", [
  eff("DB_MODIFY", { resourceDisplay: "CGR Line" }),
]);

Deno.test("alsemEnvelope (Q-08): digest 1.7.0 and 1.6.0 are accepted, another version is not", () => {
  for (const v of ["1.6.0", "1.7.0"]) {
    assertEquals(
      alsemEnvelope(env(digest([prod]), v), "digest").kind,
      "digest",
    );
  }
  assertThrows(
    () => alsemEnvelope(env(digest([prod]), "1.8.0"), "digest"),
    Error,
    'unknown schemaVersion "1.8.0" (known: 1.6.0, 1.7.0)',
  );
});

Deno.test("alsemEnvelope (Q-08): the changed-roots kinds the step accounts for pass; diff-file-ambiguous and any other kind fail closed", () => {
  const ok = [
    { kind: "diff-file-unmatched", file: "x.al" },
    { kind: "hunk-outside-routines", file: "a.al", startLine: 1, endLine: 2 },
    { kind: "diff-file-deleted", file: "gone.al" },
  ];
  assertEquals(
    alsemEnvelope(env(digest([prod], ok), "1.7.0"), "digest").kind,
    "digest",
  );
  for (
    const kind of [
      "diff-file-ambiguous", // 1.7.0: its file gives no roots, changed_routines would under-report
      "diff-parse-error",
      "file-unmatched",
      "selector-unmatched",
      "selector-ambiguous",
      "some-future-kind",
    ]
  ) {
    assertThrows(
      () =>
        alsemEnvelope(
          env(
            digest([prod], [{ kind, file: "Cloud/src/posting.al" }]),
            "1.7.0",
          ),
          "digest",
        ),
      Error,
      `payload.changedRootsDiagnostics[].kind ${kind}`,
    );
  }
});

Deno.test("alsemEnvelope (Q-08): a digest with table reads (--include-reads) fails closed; tables_read keeps its rc.4 meaning", () => {
  assertThrows(
    () =>
      alsemEnvelope(
        env(digest([prod], [], { includeReads: true }), "1.7.0"),
        "digest",
      ),
    Error,
    "payload.includeReads",
  );
  // A DB_READ effect, direct or a dependency-boundary group, without the flag is a contract break.
  for (
    const read of [
      eff("DB_READ", { resourceDisplay: "Customer" }),
      eff("DB_READ", {
        boundary: "Dep App.DoIt",
        resourceCount: "1",
        resources: "Dep A",
      }),
    ]
  ) {
    assertThrows(
      () =>
        alsemEnvelope(
          env(digest([entry("ws:Prod/src/A.al", "a", [read])]), "1.7.0"),
          "digest",
        ),
      Error,
      "payload.entries[].effects[].type DB_READ",
    );
  }
  // includeReads false is the flag's absence: accepted, touches unchanged.
  const e = alsemEnvelope(
    env(digest([prod], [], { includeReads: false }), "1.7.0"),
    "digest",
  );
  const t = digestTouches(e.payload);
  assertEquals([t.tables_written, t.tables_read], [["CGR Line"], []]);
});

Deno.test("DERIVATION is 12: a done row written with derive 11 is not done", async () => {
  assertEquals(DERIVATION, 12);
  const dir = await Deno.makeTempDir();
  try {
    const stamp = { build: "b", rev: "r", hash: "h" };
    await writeDone(dir, "e1", { ...stamp, derive: 11 }, { id: "e1" });
    assertEquals(
      await readDone(dir, "e1", { ...stamp, derive: DERIVATION }),
      null,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
