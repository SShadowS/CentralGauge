import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  dockerTime,
  normWinPath,
  parseContainerFacts,
  type RecreatedInput,
  recreatedProblems,
} from "../../../src/harness/recreated.ts";

const OLD = "a".repeat(64), NEW = "b".repeat(64);
const SHARED = "C:\\ProgramData\\BcContainerHelper";
const OWN = `${SHARED}-Cronus281`;
const rec = (over: Record<string, unknown> = {}) => ({
  file: `q\\${OLD}.json`,
  record: {
    v: 3 as const,
    state: "quarantined" as const,
    container: "Cronus281",
    id: OLD,
    token: crypto.randomUUID(),
    by: "HOST1 harness run",
    pid: 7,
    host: "HOST1",
    at: "2026-11-08T08:00:00.000Z",
    reason: "L4 on Cronus281: x",
    ...over,
  },
});
const ok: RecreatedInput = {
  container: "Cronus281",
  currentId: NEW,
  found: [rec()],
  created: "2026-11-08T09:00:00.123456789Z",
  mounts: [OWN, "C:\\bcartifacts.cache", `${OWN}\\Extensions`],
  ownRoot: OWN,
  sharedRoot: SHARED,
  manifest: {
    lineage_id: "golden-o09-v2",
    created_at: "2026-11-08T09:30:00.000Z",
  },
  lineageId: "golden-o09-v2",
};

Deno.test("H-77 dockerTime: Docker's nanosecond RFC 3339 times parse to ms; garbage is NaN", () => {
  assertEquals(
    dockerTime("2026-11-08T09:00:00.123456789Z"),
    Date.parse("2026-11-08T09:00:00.123Z"),
  );
  assertEquals(
    dockerTime("2026-11-08T09:00:00Z"),
    Date.parse("2026-11-08T09:00:00Z"),
  );
  assertEquals(Number.isNaN(dockerTime("yesterday")), true);
});

Deno.test("H-77 parseContainerFacts: the id, creation time and mount sources from docker inspect", () => {
  const raw = JSON.stringify([{
    Id: NEW,
    Created: "2026-11-08T09:00:00.1Z",
    Mounts: [{ Source: OWN, Destination: "c:\\x" }, {
      Source: "C:\\bcartifacts.cache",
    }],
  }]);
  assertEquals(parseContainerFacts(raw), {
    id: NEW,
    created: "2026-11-08T09:00:00.1Z",
    mounts: [OWN, "C:\\bcartifacts.cache"],
  });
  assertEquals(parseContainerFacts("[]"), null);
  assertEquals(parseContainerFacts("{bad"), null);
  assertEquals(parseContainerFacts(JSON.stringify([{ Id: NEW }])), null);
});

Deno.test("H-77 recreatedProblems: a recreate after every record, own-root mounts only and a baseline of the lineage made after the recreate pass", () => {
  assertEquals(recreatedProblems(ok), []);
});

Deno.test("H-77 recreatedProblems: each missing proof refuses with its reason", () => {
  const cases: [string, Partial<RecreatedInput>, string][] = [
    ["no record", { found: [] }, "no record"],
    [
      "unreadable record",
      { found: [{ file: "q\\x.json", record: null }] },
      "unreadable",
    ],
    [
      "a record of this very container",
      { found: [rec({ id: NEW })] },
      "the current container",
    ],
    [
      "created before the record",
      { created: "2026-11-08T07:59:59Z" },
      "not created after",
    ],
    ["bad creation time", { created: "?" }, "creation time"],
    ["not migrated", { ownRoot: null }, "bch-roots.json"],
    ["shared root mounted", { mounts: [OWN, SHARED] }, SHARED],
    [
      "another container's root mounted",
      { mounts: [OWN, `${SHARED}-Cronus282`] },
      `${SHARED}-Cronus282`,
    ],
    [
      "under the shared root",
      { mounts: [OWN, `${SHARED}\\Extensions`] },
      `${SHARED}\\Extensions`,
    ],
    [
      "own root not mounted",
      { mounts: ["C:\\bcartifacts.cache"] },
      "not mounted",
    ],
    ["no baseline", { manifest: null }, "no baseline"],
    [
      "baseline of another lineage",
      { manifest: { ...ok.manifest!, lineage_id: "old" } },
      "lineage old",
    ],
    [
      "baseline before the recreate",
      { manifest: { ...ok.manifest!, created_at: "2026-11-08T08:59:00Z" } },
      "before the recreate",
    ],
  ];
  for (const [what, over, want] of cases) {
    const p = recreatedProblems({ ...ok, ...over });
    assertEquals(p.length >= 1, true, what);
    assertStringIncludes(p.join("; "), want, what);
  }
  // mount paths compare case-insensitively, a trailing slash aside
  assertEquals(
    recreatedProblems({ ...ok, mounts: [`${OWN.toLowerCase()}\\`] }),
    [],
  );
});

Deno.test("H-77 Sol r1 recreatedProblems: an ancestor of the BCH roots refuses (C:\\ProgramData, C:\\, any spelling); \\\\?\\ and forward-slash spellings of the own root pass", () => {
  for (
    const leak of [
      "C:\\ProgramData",
      "C:\\",
      "c:/programdata/",
      "\\\\?\\C:\\ProgramData",
    ]
  ) {
    const p = recreatedProblems({ ...ok, mounts: [OWN, leak] });
    assertEquals(p.length, 1, leak);
    assertStringIncludes(p[0]!, "mounts another BCH root", leak);
  }
  assertEquals(
    recreatedProblems({
      ...ok,
      mounts: [`\\\\?\\${OWN}`, OWN.replace(/\\/g, "/") + "/Extensions"],
    }),
    [],
  );
});

Deno.test("H-77 Sol r1 recreatedProblems: an in-use record of the old container (a run or a recover claim) refuses unless --abandon names its token", () => {
  const t = crypto.randomUUID();
  const live = rec({ state: "in_use", token: t, reason: undefined });
  const p = recreatedProblems({ ...ok, found: [live] });
  assertEquals(p.length, 1);
  assertStringIncludes(p[0]!, `pass --abandon ${t}`);
  assertEquals(
    recreatedProblems({ ...ok, found: [live], abandon: crypto.randomUUID() })
      .length,
    1,
  );
  assertEquals(recreatedProblems({ ...ok, found: [live], abandon: t }), []);
});

Deno.test("H-77 Sol r3 normWinPath: trailing dots and spaces per component, . and .., \\\\?\\, slashes and case all collapse to one spelling", () => {
  const want = "c:\\programdata\\bccontainerhelper";
  for (
    const p of [
      "C:\\ProgramData\\BcContainerHelper.",
      "C:\\ProgramData\\BcContainerHelper. . ",
      "C:\\ProgramData.\\BcContainerHelper",
      "C:\\ProgramData\\x\\..\\BcContainerHelper",
      "C:\\ProgramData\\.\\BcContainerHelper\\",
      "\\\\?\\C:\\ProgramData\\BcContainerHelper",
      "c:/programdata/bccontainerhelper/",
    ]
  ) assertEquals(normWinPath(p), want, p);
  assertEquals(normWinPath("C:\\"), "c:");
  assertEquals(normWinPath("C:\\.."), "c:", "never above the drive");
  for (
    const leak of [
      "C:\\ProgramData\\BcContainerHelper.",
      "C:\\ProgramData\\x\\..\\BcContainerHelper-Cronus282",
    ]
  ) {
    const p = recreatedProblems({ ...ok, mounts: [OWN, leak] });
    assertEquals(p.length, 1, leak);
  }
});

Deno.test("H-77 Sol r4 recreatedProblems: a mount resolving onto any other known BCH root (a relocated foreign root behind a junction) refuses; an own root that resolves onto another root refuses", () => {
  const other282 = `${SHARED}-Cronus282`;
  // Cronus282's root is a junction to D:\BCH282; a mount E:\link resolves there
  const p = recreatedProblems({
    ...ok,
    mounts: [OWN, "D:\\BCH282"],
    rawMounts: [OWN, "E:\\link"],
    otherRoots: [other282, "D:\\BCH282"],
  });
  assertEquals(p.length, 1, p.join("; "));
  assertStringIncludes(p[0]!, "D:\\BCH282");
  // a mount containing a relocated root counts too
  assertEquals(
    recreatedProblems({
      ...ok,
      mounts: [OWN, "D:\\"],
      otherRoots: ["D:\\BCH282"],
    })
      .length,
    1,
  );
  // the own root resolving onto the shared root (a junction)
  const q = recreatedProblems({ ...ok, ownRoot: SHARED, mounts: [SHARED] });
  assertEquals(
    q.some((x) => x.includes("overlaps another BCH root")),
    true,
    q.join("; "),
  );
  // Sol r5: another root that is a junction onto the own root (shared storage)
  assertEquals(
    recreatedProblems({ ...ok, otherRoots: [other282, OWN] }).some((x) =>
      x.includes("overlaps another BCH root")
    ),
    true,
  );
  // Sol r5: an own root relocated by a junction (D:\BCH281), mounted as named
  assertEquals(
    recreatedProblems({
      ...ok,
      ownRoot: "D:\\BCH281",
      ownRootRaw: OWN,
      mounts: ["D:\\BCH281"],
      rawMounts: [OWN],
      otherRoots: [other282],
    }),
    [],
  );
  // the proper layout with all roots known still passes
  assertEquals(
    recreatedProblems({ ...ok, rawMounts: ok.mounts, otherRoots: [other282] }),
    [],
  );
});

Deno.test("H-77 Sol r2 recreatedProblems: an old container that still exists (renamed) refuses", () => {
  const p = recreatedProblems({ ...ok, liveOldIds: [OLD.toUpperCase()] });
  assertEquals(p.length, 1);
  assertStringIncludes(p[0]!, "still exists");
  assertEquals(recreatedProblems({ ...ok, liveOldIds: [NEW] }), []);
});
