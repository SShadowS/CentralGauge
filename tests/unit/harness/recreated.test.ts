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

// H-80: a shared-root recreate, proved by the rebuilt Extensions\<c> folder
const EXT = `${SHARED}\\Extensions\\Cronus281`;
const MY = `${EXT}\\my`;
const OTHER = `${SHARED}-Cronus282`;
const CACHE = "C:\\bcartifacts.cache";
const sharedOk: RecreatedInput = {
  ...ok,
  ownRoot: null,
  mounts: [SHARED, MY, CACHE],
  rawMounts: [SHARED, MY, CACHE],
  sharedRootRaw: SHARED,
  otherRoots: [OTHER],
  sharedExtensions: {
    path: EXT,
    real: EXT,
    birthtime: "2026-11-08T08:30:00.000Z",
  },
};
const folderAt = (birthtime: string | null): Partial<RecreatedInput> => ({
  sharedExtensions: { path: EXT, real: EXT, birthtime },
});
const mounted = (...extra: string[]): Partial<RecreatedInput> => ({
  mounts: [SHARED, MY, ...extra],
  rawMounts: [SHARED, MY, ...extra],
});
const NOT_ALLOWED = "not this container's own";

for (
  const [name, over] of [
    [
      "shared root, own my and a non-BCH mount, folder between record and Created",
      {},
    ],
    ["folder exactly at Created + 5 s", folderAt("2026-11-08T09:00:05.123Z")],
    [
      "a mount inside the own folder (Program Files)",
      mounted(CACHE, `${EXT}\\Program Files`),
    ],
    [
      "other spellings of the mounts and the folder",
      {
        mounts: [
          `\\\\?\\${SHARED}`,
          MY.replace(/\\/g, "/").toLowerCase() + "/",
        ],
        rawMounts: [`${SHARED}\\`, MY.toUpperCase()],
        sharedExtensions: {
          path: EXT,
          real: `${EXT.toUpperCase()}\\`,
          birthtime: "2026-11-08T08:30:00.000Z",
        },
      },
    ],
    [
      "shared root relocated (raw name, resolved target)",
      {
        sharedRoot: "D:\\BCH",
        mounts: ["D:\\BCH", "D:\\BCH\\Extensions\\Cronus281\\my", CACHE],
        rawMounts: [SHARED, MY, CACHE],
        sharedExtensions: {
          path: EXT,
          real: "D:\\BCH\\Extensions\\Cronus281",
          birthtime: "2026-11-08T08:30:00.000Z",
        },
      },
    ],
  ] as [string, Partial<RecreatedInput>][]
) {
  Deno.test(`H-80 recreatedProblems passes a shared-root recreate: ${name}`, () => {
    assertEquals(recreatedProblems({ ...sharedOk, ...over }), []);
  });
}

const attested = crypto.randomUUID();
const twoRecords: Partial<RecreatedInput> = {
  found: [
    rec(),
    rec({
      state: "in_use",
      token: attested,
      reason: undefined,
      at: "2026-11-08T08:45:00.000Z",
    }),
  ],
  abandon: attested,
};

Deno.test("H-80 recreatedProblems: a folder after every record, a newer attested in-use record among them, passes (the control for the all-record bound)", () => {
  assertEquals(
    recreatedProblems({
      ...sharedOk,
      ...twoRecords,
      ...folderAt("2026-11-08T08:50:00.000Z"),
    }),
    [],
  );
});

for (
  const [name, over, want] of [
    [
      "folder predates the newest record, an attested in-use one (after every quarantine record)",
      twoRecords,
      "outlived the old container",
    ],
    [
      "folder time equals the newest record",
      folderAt("2026-11-08T08:00:00.000Z"),
      "did not go through BCH",
    ],
    [
      "folder 1 ms past Created + 5 s",
      folderAt("2026-11-08T09:00:05.124Z"),
      "made after the container",
    ],
    ["folder time null", folderAt(null), "creation time"],
    ["folder time invalid", folderAt("yesterday"), "creation time"],
    [
      "folder a junction elsewhere",
      {
        sharedExtensions: {
          path: EXT,
          real: "D:\\elsewhere\\Cronus281",
          birthtime: "2026-11-08T08:30:00.000Z",
        },
      },
      "resolves to D:\\elsewhere\\Cronus281",
    ],
    [
      "folder resolves to another container's folder (Cronus28 is not Cronus281)",
      { container: "Cronus28" },
      "resolves to",
    ],
    [
      "my of a longer-named container (Cronus28 is not Cronus281)",
      { container: "Cronus28" },
      "is not mounted",
    ],
    [
      "Sol r1: my resolves outside every root (only the raw name matches)",
      { mounts: [SHARED, "D:\\stale-my", CACHE] },
      "\\my is not mounted",
    ],
    [
      "Sol r1: the resolved shared root is not mounted (only the raw name matches)",
      {
        sharedRoot: "D:\\BCH",
        mounts: ["E:\\stale-root", "D:\\BCH\\Extensions\\Cronus281\\my", CACHE],
        sharedExtensions: {
          path: EXT,
          real: "D:\\BCH\\Extensions\\Cronus281",
          birthtime: "2026-11-08T08:30:00.000Z",
        },
      },
      "the shared root D:\\BCH is not mounted",
    ],
    [
      "shared root not mounted",
      { mounts: [MY], rawMounts: [MY] },
      "not mounted",
    ],
    [
      "own my not mounted",
      { mounts: [SHARED], rawMounts: [SHARED] },
      "\\my is not mounted",
    ],
    [
      "Extensions of another container mounted",
      mounted(`${SHARED}\\Extensions\\Cronus282\\my`),
      NOT_ALLOWED,
    ],
    [
      "Extensions\\Original-<c> mounted",
      mounted(`${SHARED}\\Extensions\\Original-Cronus281`),
      NOT_ALLOWED,
    ],
    [
      "the whole Extensions folder mounted",
      mounted(`${SHARED}\\Extensions`),
      NOT_ALLOWED,
    ],
    [
      "the own folder itself mounted (only inside it is allowed)",
      mounted(EXT),
      NOT_ALLOWED,
    ],
    [
      "compiler under the shared root mounted",
      mounted(`${SHARED}\\compiler\\x`),
      NOT_ALLOWED,
    ],
    ["a sibling root mounted", mounted(`${SHARED}-Cronus283`), NOT_ALLOWED],
    [
      "an ancestor of the shared root mounted",
      mounted("C:\\ProgramData"),
      NOT_ALLOWED,
    ],
    [
      "a migrated root mounted, raw source only",
      {
        mounts: [SHARED, MY, "E:\\target"],
        rawMounts: [SHARED, MY, "D:\\BCH282"],
        otherRoots: ["D:\\BCH282"],
      },
      "D:\\BCH282",
    ],
    [
      "a migrated root mounted, resolved source only",
      {
        mounts: [SHARED, MY, "D:\\BCH282"],
        rawMounts: [SHARED, MY, "E:\\link"],
        otherRoots: ["D:\\BCH282"],
      },
      "D:\\BCH282",
    ],
    [
      "a migrated root resolving onto the shared root",
      { otherRoots: [OTHER, SHARED] },
      "overlaps the shared root",
    ],
    [
      "a migrated root inside the shared root",
      { otherRoots: [`${SHARED}\\nested`] },
      "overlaps the shared root",
    ],
    [
      "a relocated shared root with another container's folder mounted",
      {
        sharedRoot: "D:\\BCH",
        mounts: [
          "D:\\BCH",
          "D:\\BCH\\Extensions\\Cronus281\\my",
          "D:\\BCH\\Extensions\\Cronus282\\my",
        ],
        rawMounts: [SHARED, MY, `${SHARED}\\Extensions\\Cronus282\\my`],
        sharedExtensions: {
          path: EXT,
          real: "D:\\BCH\\Extensions\\Cronus281",
          birthtime: "2026-11-08T08:30:00.000Z",
        },
      },
      NOT_ALLOWED,
    ],
    // the three configurations the shared-root path does not support
    [
      "unsupported: legacy DVD image (<shared>\\<ver>-Files mounted)",
      mounted(`${SHARED}\\25.0.12345.0-Files`),
      NOT_ALLOWED,
    ],
    [
      "unsupported: UseVolumeForMyFolder (my from a docker volume, Extensions\\<c>\\my not mounted)",
      {
        mounts: [
          SHARED,
          "C:\\ProgramData\\docker\\volumes\\my-Cronus281\\_data",
        ],
        rawMounts: [
          SHARED,
          "C:\\ProgramData\\docker\\volumes\\my-Cronus281\\_data",
        ],
      },
      "\\my is not mounted",
    ],
    [
      "unsupported: an artifact cache under the shared root",
      mounted(`${SHARED}\\bcartifacts.cache`),
      NOT_ALLOWED,
    ],
    // every existing check still holds on this path
    ["no records", { found: [] }, "no record"],
    [
      "an unreadable record",
      { found: [{ file: "q\\x.json", record: null }] },
      "unreadable record",
    ],
    [
      "an invalid record time",
      { found: [rec({ at: "?" })] },
      "not created after",
    ],
    [
      "a record of the current container",
      { found: [rec({ id: NEW })] },
      "the current container",
    ],
    ["an invalid Created", { created: "?" }, "creation time ? unreadable"],
    ["a live old id", { liveOldIds: [OLD] }, "still exists"],
    [
      "an in-use record not attested",
      { found: [rec({ state: "in_use", reason: undefined })] },
      "pass --abandon",
    ],
    [
      "a record after Created",
      { found: [rec({ at: "2026-11-08T09:10:00.000Z" })] },
      "not created after",
    ],
    ["no baseline", { manifest: null }, "no baseline"],
    [
      "an old baseline",
      { manifest: { ...ok.manifest!, created_at: "2026-11-08T08:59:00Z" } },
      "before the recreate",
    ],
    [
      "a baseline of the wrong lineage",
      { manifest: { ...ok.manifest!, lineage_id: "old" } },
      "lineage old",
    ],
  ] as [string, Partial<RecreatedInput>, string][]
) {
  Deno.test(`H-80 recreatedProblems refuses a shared-root recreate: ${name}`, () => {
    const p = recreatedProblems({ ...sharedOk, ...over });
    assertEquals(p.length >= 1, true, name);
    assertStringIncludes(p.join("; "), want, name);
  });
}

Deno.test("H-80 recreatedProblems: a listed container with a shared mount refuses as today, whatever the folder shows", () => {
  const p = recreatedProblems({
    ...sharedOk,
    ownRoot: OWN,
    mounts: [OWN, SHARED],
    rawMounts: [OWN, SHARED],
  });
  assertEquals(p.length, 1, p.join("; "));
  assertStringIncludes(p[0]!, "mounts another BCH root than its own");
});

Deno.test("H-80 recreatedProblems: not listed and no folder evidence keeps today's refusal text exactly", () => {
  assertEquals(
    recreatedProblems({ ...ok, ownRoot: null }),
    ["Cronus281 is not listed in bch-roots.json (no own BCH root)"],
  );
});

for (
  const [name, mount] of [
    ["null", { Source: null }],
    ["missing", { Destination: "c:\\x" }],
    ["non-string", { Source: 7 }],
    ["empty", { Source: "" }],
    ["blank", { Source: "  " }],
  ] as [string, unknown][]
) {
  Deno.test(`H-80 Sol r1 #2 parseContainerFacts: a mount whose Source is ${name} makes the evidence malformed (null)`, () => {
    assertEquals(
      parseContainerFacts(JSON.stringify([{
        Id: NEW,
        Created: "2026-11-08T09:00:00.1Z",
        Mounts: [{ Source: OWN }, mount],
      }])),
      null,
    );
  });
}
