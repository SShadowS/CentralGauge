import { assert, assertEquals, assertRejects } from "@std/assert";
import { ConfigurationError, ContainerError } from "../../../src/errors.ts";
import { LineageSchema, loadLineage } from "../../../src/harness/lineage.ts";
import {
  commandReset,
  fsDiff,
  goldenReset,
  parseResetOutput,
  parseVerifyOutput,
  RESET_PHASES,
  ResetFailedError,
} from "../../../src/harness/reset.ts";

const MECH = { id: "golden-restore", policyVersion: 1 };

Deno.test("H-35 S3 parseResetOutput: RESET_OK with exit 0 is a reset, phases timed", () => {
  const r = parseResetOutput("C1", MECH, {
    code: 0,
    // Sol r2 #1: every agreed phase, in order; other lines are noise.
    stdout: ["noise", ...FULL, "RESET_OK"].join("\r\n"),
  });
  assertEquals(r, {
    container: "C1",
    mechanism: "golden-restore",
    policy_version: 1,
    ok: true,
    failed_step: null,
    error: null,
    phases_ms: Object.fromEntries(RESET_PHASES.map((p, i) => [p, i + 1])),
  });
});

Deno.test("H-35 S3 parseResetOutput: the snapshot guard's refusal, a missing marker, RESET_OK with a failing exit and both markers are failures", () => {
  const guard = parseResetOutput("C1", MECH, {
    code: 2,
    stdout:
      "RESET_STEP snapshot_guard 9\nRESET_FAILED snapshot_guard snapshot CRONUS_snap of CRONUS exists",
  });
  assertEquals(
    [guard.ok, guard.failed_step, guard.error],
    [false, "snapshot_guard", "snapshot CRONUS_snap of CRONUS exists"],
  );
  const none = parseResetOutput("C1", MECH, { code: 0, stdout: "x" });
  assertEquals([none.ok, none.failed_step], [false, "protocol"]);
  const exit = parseResetOutput("C1", MECH, { code: 1, stdout: "RESET_OK" });
  assertEquals([exit.ok, exit.failed_step], [false, "protocol"]);
  const both = parseResetOutput("C1", MECH, {
    code: 0,
    stdout: "RESET_FAILED runner_verify no answer\nRESET_OK",
  });
  assertEquals([both.ok, both.failed_step], [false, "runner_verify"]);
});

Deno.test("H-35 S3 commandReset: a failed reset is a ResetFailedError (a ContainerError, so infra), carrying its record", async () => {
  const m = commandReset({
    ...MECH,
    run: () =>
      Promise.resolve({
        code: 2,
        stdout: "RESET_FAILED snapshot_guard snapshot exists",
      }),
  });
  const ok = commandReset({
    ...MECH,
    run: () =>
      Promise.resolve({ code: 0, stdout: [...FULL, "RESET_OK"].join("\n") }),
  });
  assertEquals((await ok.reset("C2")).ok, true);
  const r = await m.reset("C1");
  assertEquals(r.failed_step, "snapshot_guard");
  const err = new ResetFailedError(r);
  assertEquals(err instanceof ContainerError, true);
  assertEquals(err.record, r);
  await assertRejects(
    () => Promise.reject(err),
    ContainerError,
    "reset of C1 failed at snapshot_guard: snapshot exists",
  );
});

// ---- H-35 run 002 Sol r2 ----

const FULL = RESET_PHASES.map((p, i) => `RESET_STEP ${p} ${i + 1}`);

Deno.test("H-35 Sol r2 #1: success needs every agreed phase once, in order, and exactly one bare RESET_OK", () => {
  const ok = parseResetOutput("C1", MECH, {
    code: 0,
    stdout: [...FULL, "RESET_OK"].join("\n"),
  });
  assertEquals(ok.ok, true);
  assertEquals(Object.keys(ok.phases_ms), [...RESET_PHASES]);
  const bad = (lines: string[]) =>
    parseResetOutput("C1", MECH, { code: 0, stdout: lines.join("\n") });
  for (
    const lines of [
      ["RESET_STEP restore 1", "RESET_OK"], // phases missing
      [...FULL, "RESET_OK", "RESET_OK"], // duplicated marker
      [...FULL, "RESET_OK C1"], // trailing text
      [...FULL.slice(1), FULL[0]!, "RESET_OK"], // out of order
      [...FULL, FULL.at(-1)!, "RESET_OK"], // a phase twice
      [...FULL, "RESET_STEP extra 1", "RESET_OK"], // an unknown phase
    ]
  ) {
    const r = bad(lines);
    assertEquals([r.ok, r.failed_step], [false, "protocol"], lines.join("|"));
  }
  // A failure needs its one marker too.
  const twice = bad([
    "RESET_FAILED restore a",
    "RESET_FAILED start b",
  ]);
  assertEquals([twice.ok, twice.failed_step], [false, "protocol"]);
});

Deno.test("H-35 Sol r2 #3: a reset command that throws is a recorded reset failure (command), never an unrecorded error; a ConfigurationError still refuses", async () => {
  const m = commandReset({
    ...MECH,
    run: (c) =>
      Promise.reject(new ContainerError("pwsh session died", c, "setup")),
  });
  const r = await m.reset("C1");
  assertEquals([r.ok, r.failed_step], [false, "command"]);
  assertEquals(r.error, "pwsh session died");
  const refusing = commandReset({
    ...MECH,
    run: () => Promise.reject(new ConfigurationError("no lineage")),
  });
  await assertRejects(() => refusing.reset("C1"), ConfigurationError);
});

Deno.test("H-35 Sol r3 #1: a combined phase name or RESET_OK before the phases is a protocol failure", () => {
  for (
    const lines of [
      [`RESET_STEP ${RESET_PHASES.join(",")} 1`, "RESET_OK"],
      ["RESET_OK", ...FULL],
    ]
  ) {
    const r = parseResetOutput("C1", MECH, {
      code: 0,
      stdout: lines.join("\n"),
    });
    assertEquals([r.ok, r.failed_step], [false, "protocol"], lines.join("|"));
  }
});

// ---- H-35 run 002 orchestrator Sol r1 ----

Deno.test("H-35 orch Sol r1 #1: any malformed reserved-marker line is a protocol failure, whatever follows", () => {
  for (
    const bad of [
      "RESET_FAILED",
      "RESET_FAILED snapshot_guard",
      "RESET_FAILEDx y z",
      "RESET_STEP restore",
      "RESET_STEP restore 1.5",
      "RESET_STEPrestore 1",
      "RESET_OKAY",
    ]
  ) {
    const r = parseResetOutput("C1", MECH, {
      code: 0,
      stdout: [...FULL, bad, "RESET_OK"].join("\n"),
    });
    assertEquals([r.ok, r.failed_step], [false, "protocol"], bad);
  }
});

// ---- H-35 S3: the post-cleanup inventory check protocol ----

Deno.test("H-35 S3 parseVerifyOutput: VERIFY_OK with exit 0 is clean; VERIFY_DIRTY carries its diff lines; anything else is a failed check", () => {
  assertEquals(
    parseVerifyOutput("C1", { code: 0, stdout: "noise\r\nVERIFY_OK" }),
    { container: "C1", ok: true, diff: [], error: null },
  );
  const dirty = parseVerifyOutput("C1", {
    code: 1,
    stdout: "VERIFY_DIFF + P|abc\nVERIFY_DIFF - I|def\nVERIFY_DIRTY 2",
  });
  assertEquals(dirty.ok, false);
  assertEquals(dirty.diff, ["+ P|abc", "- I|def"]);
  assertEquals(dirty.error, "inventory differs from the baseline (2 lines)");
  for (
    const [stdout, code, why] of [
      ["VERIFY_FAILED sqlcmd timed out", 1, "sqlcmd timed out"],
      ["", 0, "protocol"],
      ["VERIFY_OK", 1, "protocol"],
      ["VERIFY_OK\nVERIFY_OK", 0, "protocol"],
      ["VERIFY_DIFF + x\nVERIFY_OK", 0, "protocol"], // a diff with OK
      ["VERIFY_DIFF + x\nVERIFY_DIRTY 2", 1, "protocol"], // count mismatch
      ["VERIFY_DIRTY", 1, "protocol"], // malformed marker
      ["VERIFY_OK\nVERIFY_FAILED x", 1, "protocol"],
    ] as const
  ) {
    const r = parseVerifyOutput("C1", { code, stdout });
    assertEquals(r.ok, false, stdout);
    assert(r.error!.includes(why), `${stdout}: ${r.error}`);
  }
});

Deno.test("H-35 S3 goldenReset.verifyClean runs verify-clean.ps1 with the lineage; a spawn that throws is a failed check, not a throw", async () => {
  const calls: string[][] = [];
  const m = goldenReset({
    repoRoot: "R",
    lineagePath: "L.json",
    lineage: await loadLineage(
      "infra/harness-reset/lineages/golden-o09-v1.json",
    ),
    dockerEnv: { DOCKER_CONTEXT: "desktop-windows" },
    spawn: (_cmd, args) => {
      calls.push(args);
      return args.includes("C2")
        ? Promise.reject(new Error("spawn died"))
        : Promise.resolve({ code: 0, stdout: "VERIFY_OK" });
    },
  });
  assertEquals((await m.verifyClean!("C1")).ok, true);
  assert(calls[0]!.some((a) => a.endsWith("verify-clean.ps1")));
  assertEquals(calls[0]!.slice(-4), ["-Container", "C1", "-Lineage", "L.json"]);
  const bad = await m.verifyClean!("C2");
  assertEquals([bad.ok, bad.error], [false, "spawn died"]);
});

// ---- H-35 S3 L4: fsDigest diff (decisions/2026-10-20-h-35-l4-scope.md) ----

/** Windows paths written with "/" for readability. */
const w = (s: string) => s.replaceAll("/", "\\");
const F = (p: string, h = "a".repeat(64), t = 1, head = "6161") =>
  `F|${h}|4|32|${t}|${head}|${w(p)}`;
/** A complete capture: its lines, then the `T|<n>` marker fs-capture.ps1 ends with. */
const cap = (...lines: string[]) => [...lines, `T|${lines.length}`];

Deno.test("H-35 S3 L4 fsDiff: new, changed (content or metadata only) and removed entries, keyed by path and stream; identical digests are clean", () => {
  const before = cap(
    w("D|16|5|C:/W"),
    F("C:/W/a.txt"),
    F("C:/W/b.txt"),
    w("S|" + "c".repeat(64) + "|3|C:/W:hid"),
  );
  assertEquals(fsDiff(before, before, [], [w("C:/W")]), {
    diff: [],
    errors: [],
  });
  const after = cap(
    w("D|16|5|C:/W"),
    F("C:/W/a.txt", "a".repeat(64), 2), // mtime only
    F("C:/W/new.txt"),
    w("S|" + "d".repeat(64) + "|3|C:/W:hid"), // directory ADS content
  );
  const r = fsDiff(before, after, [], [w("C:/W")]);
  assertEquals(r.errors, []);
  assertEquals(
    r.diff.map((d) => [d.path, d.before !== null, d.after !== null]),
    [
      [w("C:/W:hid"), true, true],
      [w("C:/W/a.txt"), true, true],
      [w("C:/W/b.txt"), true, false],
      [w("C:/W/new.txt"), false, true],
    ],
  );
});

Deno.test("H-35 S3 L4 fsDiff: exclusions match case-insensitively with * as any run (subtree); E lines on either side and unparsable lines are errors (fail closed)", () => {
  const before = cap(F("C:/W/Logs/x.log"));
  const after = cap(
    F("C:/W/logs/x.log", "b".repeat(64)),
    F("C:/W/logs/y/z.log"),
  );
  assertEquals(fsDiff(before, after, [w("c:/w/LOGS/*")]).diff, []);
  assertEquals(fsDiff(before, after, [w("C:/W/logs/*.txt")]).diff.length, 2);
  const e = fsDiff(
    cap(w("E|C:/W/a|access denied")),
    cap(
      "garbage",
      "E|(nst)|not quiescent: 1",
    ),
    [],
  );
  assertEquals(e.errors, [
    w("before: C:/W/a: access denied"),
    "after: unparsable line garbage",
    "after: (nst): not quiescent: 1",
  ]);
});

Deno.test("H-35 Sol S3 r1 #5: a capture without its T| marker, with a wrong count, malformed fields, a duplicate key, or a declared root it does not cover is an error (fail closed); empty captures never compare clean", () => {
  const ok = cap(w("D|16|5|C:/W"), F("C:/W/a.txt"));
  const errs = (after: string[], roots = [w("C:/W")]) =>
    fsDiff(ok, after, [], roots).errors;
  assertEquals(errs(ok), []);
  assert(errs([])[0]!.includes("no T| marker"), "empty capture");
  assert(errs(ok.slice(0, -1))[0]!.includes("no T| marker"), "missing marker");
  assert(
    errs([w("D|16|5|C:/W"), F("C:/W/a.txt"), "T|5"])[0]!.includes("count"),
  );
  assert(
    errs([...ok.slice(0, -1), "T|2", "T|2"])[0]!.includes("T| marker"),
    "two markers",
  );
  for (
    const bad of [
      w("F|||||C:/W/f"),
      w("F|xyz|4|32|1|C:/W/f"),
      w("S|" + "a".repeat(64) + "|-1|C:/W:s"),
      w("D|x|5|C:/W/d"),
    ]
  ) {
    assert(
      errs(cap(w("D|16|5|C:/W"), F("C:/W/a.txt"), bad))[0]!.includes(
        "unparsable",
      ),
      bad,
    );
  }
  // a changed record followed by the original for the same path
  assert(
    errs(
      cap(w("D|16|5|C:/W"), F("C:/W/a.txt", "b".repeat(64)), F("C:/W/a.txt")),
    )
      .some((e) => e.includes("twice")),
  );
  // a declared root with no entry (neither D nor L nor E)
  assert(
    errs(ok, [w("C:/W"), w("C:/X")]).some((e) => e.includes("C:\\X")),
  );
  assertEquals(fsDiff([], [], []).errors.length > 0, true);
  // Sol S3 r2: an F or S record for the root path does not cover it
  for (
    const only of [
      w(`S|${"a".repeat(64)}|1|C:/W`),
      F("C:/W"),
    ]
  ) {
    const x = cap(only);
    assert(
      fsDiff(x, x, [], [w("C:/W")]).errors.some((e) =>
        e.includes("declared root")
      ),
      only,
    );
  }
});

// ---- H-35 S3 L4 platform_cache (decision addendum 3): only NEW files of the measured NST cache shapes ----

const APPS = w("C:/NAV/Server/MicrosoftDynamicsNavServer$BC/apps");
const CACHES = [
  {
    base: APPS,
    files: String
      .raw`^assembly\\release\\[0-9.]+_\d+\\([0-9A-F]{2})\\\1[0-9A-F]{62}\.dll$`,
    dirs: String.raw`^assembly(\\release(\\[0-9.]+_\d+(\\[0-9A-F]{2})?)?)?$`,
    magic: "4d5a",
  },
  {
    base: APPS,
    files: String.raw`^metadata\\3\\([0-9A-F]{2})\\\1[0-9A-F]{62}\.(cs|xml)$`,
    dirs: String.raw`^metadata(\\3(\\[0-9A-F]{2})?)?$`,
  },
];
const HEX = "0A53123EBB10012CF7AB9309302824D90E158BB785A7763F235C616DD829ADF0";
const D = (p: string, t = 5) => `D|16|${t}|${w(p)}`;

Deno.test("H-35 S3 L4 platform_cache: new files of the measured shapes (and new or touched directories of their shape) are tolerated; nothing else under apps is", () => {
  const base = [
    D("C:/NAV/Server/MicrosoftDynamicsNavServer$BC/apps"),
    D(`${APPS}/assembly`),
    D(`${APPS}/assembly/release`),
    D(`${APPS}/assembly/release/28.0.53667.0_1`),
    D(`${APPS}/metadata`),
    D(`${APPS}/metadata/3`),
    D(`${APPS}/metadata/3/0A`),
    F(`${APPS}/metadata/3/0A/${HEX.replace("0A5", "0A6")}.xml`),
  ];
  const before = cap(...base);
  const tolerated = cap(
    ...base.map((l) =>
      l.endsWith("metadata\\3") || l.endsWith("release\\28.0.53667.0_1")
        ? l.replace("|5|", "|9|") // its last-write moved: a child was added
        : l
    ),
    D(`${APPS}/assembly/release/28.0.53667.0_1/0A`, 9), // a new <xx> directory
    F(
      `${APPS}/assembly/release/28.0.53667.0_1/0A/${HEX}.dll`,
      "b".repeat(64),
      1,
      "4d5a",
    ),
    F(`${APPS}/metadata/3/0A/${HEX}.cs`),
    F(`${APPS}/metadata/3/0A/${HEX}.xml`),
  );
  assertEquals(fsDiff(before, tolerated, [], [], CACHES), {
    diff: [],
    errors: [],
  });
  // each of these stays a difference
  const cases: [string, string[]][] = [
    ["non-hex name", [F(`${APPS}/metadata/3/0A/cg.txt`)]],
    ["dll with a non-hex name", [
      F(
        `${APPS}/assembly/release/28.0.53667.0_1/0A/evil.dll`,
        "c".repeat(64),
        1,
        "4d5a",
      ),
    ]],
    ["xx not the hash prefix", [
      F(`${APPS}/metadata/3/0A/${HEX.replace("0A5", "FF5")}.cs`),
    ]],
    ["dll without an MZ header", [
      F(
        `${APPS}/assembly/release/28.0.53667.0_1/0A/${HEX}.dll`,
        "c".repeat(64),
        1,
        "6161",
      ),
    ]],
    ["an ADS on a cache file", [
      F(`${APPS}/metadata/3/0A/${HEX}.cs`),
      w(`S|${"d".repeat(64)}|3|${APPS}/metadata/3/0A/${HEX}.cs:hid`),
    ]],
    ["another apps subfolder", [F(`${APPS}/resources/3/0A/${HEX}.xml`)]],
    ["a new directory outside the shape", [D(`${APPS}/metadata/3/0A/sub`)]],
  ];
  for (const [what, extra] of cases) {
    const d = fsDiff(before, cap(...base, ...extra), [], [], CACHES).diff;
    assert(d.length > 0, what);
  }
  // a changed or removed cache file is a difference
  const changed = base.map((l) =>
    l.startsWith("F|") ? l.replace("|1|", "|2|") : l
  );
  assertEquals(fsDiff(before, cap(...changed), [], [], CACHES).diff.length, 1);
  assertEquals(
    fsDiff(
      before,
      cap(...base.filter((l) => !l.startsWith("F|"))),
      [],
      [],
      CACHES,
    )
      .diff.length,
    1,
  );
  // a directory whose attributes (not only its time) changed is a difference
  const attrs = base.map((l) =>
    l.endsWith("metadata\\3") ? l.replace("D|16|", "D|18|") : l
  );
  assertEquals(fsDiff(before, cap(...attrs), [], [], CACHES).diff.length, 1);
});

Deno.test("H-35 run 004 #6: a cache magic is a prefix of the file's head bytes (a one-byte magic matches a two-byte head); a different first byte is a difference", () => {
  const before = cap(D(APPS), D(`${APPS}/metadata/3/0A`));
  const one = [{ ...CACHES[1]!, magic: "3c" }]; // '<' of an .xml
  const xml = (head: string) =>
    cap(
      D(APPS),
      D(`${APPS}/metadata/3/0A`),
      F(`${APPS}/metadata/3/0A/${HEX}.xml`, "a".repeat(64), 1, head),
    );
  assertEquals(fsDiff(before, xml("3c3f"), [], [], one).diff, []);
  assertEquals(fsDiff(before, xml("3c"), [], [], one).diff, []);
  assertEquals(fsDiff(before, xml("4d5a"), [], [], one).diff.length, 1);
  assertEquals(fsDiff(before, xml(""), [], [], one).diff.length, 1);
});

Deno.test("H-35 addendum 6: a name_is_sha256 cache tolerates a new file only when its name is its own content sha256 (any case); a right-shaped file named otherwise is a difference", () => {
  const app = [{
    base: APPS,
    files: String.raw`^metadata\\3\\([0-9A-F]{2})\\\1[0-9A-F]{62}\.app$`,
    dirs: String.raw`^metadata(\\3(\\[0-9A-F]{2})?)?$`,
    magic: "4e41",
    nameIsSha256: true,
  }];
  const before = cap(D(APPS), D(`${APPS}/metadata/3/0A`));
  const file = (sha: string, head = "4e41") =>
    cap(
      D(APPS),
      D(`${APPS}/metadata/3/0A`),
      F(`${APPS}/metadata/3/0A/${HEX}.app`, sha, 1, head),
    );
  assertEquals(fsDiff(before, file(HEX.toLowerCase()), [], [], app).diff, []);
  assertEquals(
    fsDiff(before, file("a".repeat(64)), [], [], app).diff.length,
    1,
  );
  // the hash still needs the magic
  assertEquals(
    fsDiff(before, file(HEX.toLowerCase(), "4d5a"), [], [], app).diff.length,
    1,
  );
});

Deno.test("H-35 addendum 6: a folder-only cache (files match nothing) tolerates only that folder's last-write time; a file inside or an attribute change is a difference", () => {
  const run = [{
    base: w("C:/Run"),
    files: String.raw`^(?!)$`,
    dirs: String.raw`^my$`,
    dirTimeOnly: true,
  }];
  // self-check: creating the folder is a difference, not a tolerated change
  assertEquals(
    fsDiff(cap(D("C:/Run")), cap(D("C:/Run"), D("C:/Run/my", 9)), [], [], run)
      .diff.length,
    1,
  );
  // and so is a case-only rename with its time moved (here and in any cache)
  assertEquals(
    fsDiff(cap(D("C:/Run/my")), cap(D("C:/Run/MY", 9)), [], [], run).diff
      .length,
    1,
  );
  assertEquals(
    fsDiff(
      cap(D(`${APPS}/metadata`)),
      cap(D(`${APPS}/METADATA`, 9)),
      [],
      [],
      CACHES,
    ).diff.length,
    1,
  );
  const before = cap(D("C:/Run/my"), F("C:/Run/my/keep.txt"));
  assertEquals(
    fsDiff(
      before,
      cap(D("C:/Run/my", 9), F("C:/Run/my/keep.txt")),
      [],
      [],
      run,
    ).diff,
    [],
  );
  assertEquals(
    fsDiff(
      before,
      cap(D("C:/Run/my", 9), F("C:/Run/my/keep.txt"), F("C:/Run/my/x.app")),
      [],
      [],
      run,
    ).diff.length,
    1,
  );
  assertEquals(
    fsDiff(
      before,
      cap(`D|18|9|${w("C:/Run/my")}`, F("C:/Run/my/keep.txt")),
      [],
      [],
      run,
    ).diff.length,
    1,
  );
});

Deno.test("H-35 addendum 7: an in_place cache tolerates an existing file changed in place (content, time) and nothing else: new, removed, resized, re-attributed, respelled files and streams stay differences", () => {
  const CNC = w("C:/sys/CryptnetUrlCache");
  const ip = [{
    base: CNC,
    files: String.raw`^MetaData\\[0-9A-F]{32}$`,
    dirs: String.raw`^(?!)$`,
    inPlace: true,
  }];
  const N = "57C8EDB95DF3F0AD4EE2DC2B8CFD4157";
  const meta = (name: string, sha: string, size = 342, attrs = 36, t = 1) =>
    w(`F|${sha}|${size}|${attrs}|${t}|7000|${CNC}/MetaData/${name}`);
  const dirs = [D(CNC), D(`${CNC}/MetaData`)];
  const before = cap(...dirs, meta(N, "a".repeat(64)));
  // changed in place: tolerated
  assertEquals(
    fsDiff(
      before,
      cap(...dirs, meta(N, "b".repeat(64), 342, 36, 9)),
      [],
      [],
      ip,
    ),
    { diff: [], errors: [] },
  );
  const differs = (what: string, after: string[], b = before) =>
    assertEquals(fsDiff(b, cap(...after), [], [], ip).diff.length, 1, what);
  differs("new file", [
    ...dirs,
    meta(N, "a".repeat(64)),
    meta("77EC63BD" + N.slice(8), "c".repeat(64)),
  ]);
  differs("size change", [...dirs, meta(N, "b".repeat(64), 343)]);
  differs("attribute change", [...dirs, meta(N, "b".repeat(64), 342, 38)]);
  differs("removal", [...dirs]);
  differs("respelled", [
    ...dirs,
    meta(N.toLowerCase(), "b".repeat(64)),
  ]);
  assertEquals(
    fsDiff(
      before,
      cap(
        ...dirs,
        meta(N, "a".repeat(64)),
        w(`S|${"d".repeat(64)}|3|${CNC}/MetaData/${N}:hid`),
      ),
      [],
      [],
      ip,
    ).diff.length,
    1,
    "a stream",
  );
});

Deno.test("H-35 Sol S3 r4: a cache shape matches the whole relative path even when its alternation is unanchored inside, and a base with a trailing separator works as without", () => {
  const before = cap(D(APPS));
  const junk = F(`${APPS}/metadata/3/0A/junk${HEX}.xml`);
  // `^a|b$`: the second arm alone would match a hash-shaped suffix
  const loose = [{
    base: APPS,
    files: String.raw`^metadata\\3\\[0-9A-F]{2}\\x$|[0-9A-F]{64}\.xml$`,
    dirs: String.raw`^metadata$`,
  }];
  assertEquals(
    fsDiff(before, cap(D(APPS), junk), [], [], loose).diff.length,
    1,
  );
  const trailing = CACHES.map((c) => ({ ...c, base: c.base + "\\" }));
  const added = F(`${APPS}/metadata/3/0A/${HEX}.cs`);
  assertEquals(
    fsDiff(
      before,
      cap(D(APPS), D(`${APPS}/metadata/3/0A`), added),
      [],
      [],
      trailing,
    )
      .diff.map((d) => d.path),
    [],
  );
});

Deno.test("H-35 S3 L4 (orchestrator, addendum 3): the comparison is within one deployment only; a lineage carries no stored fs digest to compare against", () => {
  const fs = LineageSchema.shape.fs.unwrap().shape;
  assertEquals(
    Object.keys(fs).sort(),
    ["digest_version", "exclude", "identity", "roots", "survey"],
  );
  // and a stored post-reset digest is refused by the strict schema
  assert(
    !LineageSchema.shape.fs.unwrap().safeParse({
      digest_version: 3,
      roots: ["C:\\W"],
      identity: [],
      exclude: [],
      survey: { path: "s.json", sha256: "a".repeat(64) },
      baseline_digest: "a".repeat(64),
    }).success,
  );
});
