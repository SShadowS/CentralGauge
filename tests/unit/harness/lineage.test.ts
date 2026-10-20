import { assert, assertEquals, assertRejects } from "@std/assert";
import { dirname, join } from "@std/path";
import { ConfigurationError } from "../../../src/errors.ts";
import {
  lineageCompat,
  loadLineage,
  overlapsHoldDir,
} from "../../../src/harness/lineage.ts";
import {
  fsDiff,
  goldenReset,
  RESET_PHASES,
} from "../../../src/harness/reset.ts";
import { sha256Hex } from "../../../src/harness/hash.ts";
import { testTempDir } from "../../utils/temp-dir.ts";

const REPO_LINEAGE = "infra/harness-reset/lineages/golden-o09-v1.json";

Deno.test("H-35 S3.2 loadLineage: the shipped golden-o09-v1 lineage loads, its stored inventory hash-verified", async () => {
  const l = await loadLineage(REPO_LINEAGE);
  assertEquals(l.id, "golden-o09-v1");
  assertEquals(l.reset_policy_version, 1);
  assertEquals(l.runner.package_id, "ede0ce05-9ed6-42f2-bbb4-bfee95bb033a");
});

Deno.test("H-35 S3: the shipped golden-o09-v2 lineage loads with every section admission needs (content root, fs v3, egress) and runner 1.0.2.0", async () => {
  const path = "infra/harness-reset/lineages/golden-o09-v2.json";
  const l = await loadLineage(path);
  assertEquals([l.id, l.reset_policy_version], ["golden-o09-v2", 2]);
  assertEquals(l.runner.version, "1.0.2.0");
  assert(l.content_root && l.content_root.exclude.length > 0);
  assertEquals(l.fs?.digest_version, 3);
  assert(l.egress);
  // run 004 #4: the canonical NST config digest, the hostname keys excluded
  assertEquals(l.nst_config?.digest_version, 1);
  assertEquals(
    [...l.nst_config!.exclude_keys].sort(),
    [
      "PublicODataBaseUrl",
      "PublicSOAPBaseUrl",
      "PublicWebBaseUrl",
      "PublicWinBaseUrl",
    ],
  );
  const m = goldenReset({
    repoRoot: ".",
    lineagePath: path,
    lineage: l,
    dockerEnv: {},
  });
  assert(m.contentRoot && m.fsDigest && m.bcEgress && m.fsRoots?.length);
  // addendum 6: + the metadata .app and .res (name_is_sha256) and C:\Run\my
  assertEquals(m.fsCaches?.length, 5);
  assertEquals(m.fsExclude, []);
  // its caches tolerate the real measured paths (Cronus283) and nothing planted
  const apps = m.fsCaches![0]!.base;
  const hex =
    "0A53123EBB10012CF7AB9309302824D90E158BB785A7763F235C616DD829ADF0";
  const f = (p: string, head = "4d5a") =>
    `F|${"a".repeat(64)}|4|32|1|${head}|${apps}\\${p}`;
  const before = [`D|16|1|${apps}`, "T|1"];
  const real = [
    `D|16|1|${apps}`,
    f(`assembly\\release\\28.0.53667.0_1\\0A\\${hex}.dll`),
    f(
      `metadata\\3\\00\\001123D29F565DFE84635228DD0770E1AFE17C986430431FA1FF06D65FE03C1B.xml`,
      "3c3f",
    ),
  ];
  assertEquals(
    fsDiff(before, [...real, `T|${real.length}`], [], [], m.fsCaches).diff,
    [],
  );
  for (
    const planted of [
      f("metadata\\3\\0A\\cg.txt", "6869"),
      f("assembly\\release\\28.0.53667.0_1\\0A\\evil.dll"),
    ]
  ) {
    const after = [`D|16|1|${apps}`, planted, "T|2"];
    assertEquals(fsDiff(before, after, [], [], m.fsCaches).diff.length, 1);
  }
  // addendum 6, the shipped entries: a publish's hash-named .app/.res and
  // C:\Run\my's time are tolerated; a misnamed .app and a new file in
  // C:\Run\my are not
  const pub = (ext: string, sha: string, head: string) =>
    `F|${sha}|4|32|1|${head}|${apps}\\metadata\\3\\0A\\${hex}.${ext}`;
  const lc = hex.toLowerCase();
  assertEquals(
    fsDiff(
      [`D|16|1|${apps}`, "D|16|1|C:\\Run\\my", "T|2"],
      [
        `D|16|1|${apps}`,
        pub("app", lc, "4e41"),
        pub("res", lc, "efbb"),
        "D|16|9|C:\\Run\\my",
        "T|4",
      ],
      [],
      [],
      m.fsCaches,
    ).diff,
    [],
  );
  for (
    const after of [
      [`D|16|1|${apps}`, pub("app", "b".repeat(64), "4e41"), "T|2"],
      [
        `D|16|1|${apps}`,
        "D|16|1|C:\\Run\\my",
        "F|" + "c".repeat(64) +
        "|4|32|1|4e41|C:\\Run\\my\\x.app",
        "T|3",
      ],
    ]
  ) {
    const b = after.some((l) => l.includes("C:\\Run\\my"))
      ? [`D|16|1|${apps}`, "D|16|1|C:\\Run\\my", "T|2"]
      : before;
    assertEquals(fsDiff(b, after, [], [], m.fsCaches).diff.length, 1);
  }
});

async function copyLineage(
  edit: (j: Record<string, unknown>) => void = () => {},
  inventory?: string,
) {
  const dir = await Deno.realPath(await testTempDir());
  const j = JSON.parse(await Deno.readTextFile(REPO_LINEAGE));
  edit(j);
  await Deno.writeTextFile(join(dir, "l.json"), JSON.stringify(j));
  await Deno.writeTextFile(
    join(dir, j.inventory.path),
    inventory ??
      await Deno.readTextFile(
        join("infra/harness-reset/lineages", j.inventory.path),
      ),
  );
  return join(dir, "l.json");
}

Deno.test("H-35 S3.2 loadLineage: a changed inventory, an unknown field or a missing one is refused (configuration, before any reset)", async () => {
  await assertRejects(
    async () => loadLineage(await copyLineage(() => {}, "tampered\n")),
    ConfigurationError,
    "inventory",
  );
  await assertRejects(
    async () => loadLineage(await copyLineage((j) => (j["extra"] = 1))),
    ConfigurationError,
  );
  await assertRejects(
    async () =>
      loadLineage(await copyLineage((j) => delete j["golden_sha256"])),
    ConfigurationError,
  );
});

Deno.test("H-35 run 005 (orch r004 barrier L1): a lineage whose fs roots overlap the NST hold dir is refused", async () => {
  assert(overlapsHoldDir("C:\\ProgramData"), "a parent");
  assert(overlapsHoldDir("c:/programdata/CG-HARNESS/"), "itself, any case");
  assert(overlapsHoldDir("C:\\ProgramData\\cg-harness\\tmp"), "a child");
  assert(!overlapsHoldDir("C:\\ProgramData\\cg-harness2"), "a prefix sibling");
  assert(!overlapsHoldDir("C:\\ProgramData\\Microsoft"), "the shipped roots");
  const v2 = JSON.parse(
    await Deno.readTextFile(
      "infra/harness-reset/lineages/golden-o09-v2.json",
    ),
  );
  await assertRejects(
    async () =>
      loadLineage(
        await copyLineage((j) => {
          j["fs"] = { ...v2.fs, roots: [...v2.fs.roots, "C:\\ProgramData"] };
        }),
      ),
    ConfigurationError,
    "overlaps",
  );
  // non-canonical spellings that could hide an overlap are refused outright
  for (
    const r of [
      "C:\\ProgramData\\.\\cg-harness",
      "C:\\ProgramData\\x\\..\\cg-harness",
      "\\\\?\\C:\\ProgramData",
      "C:/ProgramData/cg-harness",
      "ProgramData",
      // orch r005 LOW: Windows aliases (a trailing period or space is stripped)
      "C:\\ProgramData\\cg-harness.",
      "C:\\ProgramData\\cg-harness ",
      "C:\\ProgramData.\\cg-harness",
      "C:\\ProgramData \\cg-harness\\tmp",
    ]
  ) {
    await assertRejects(
      async () =>
        loadLineage(
          await copyLineage((j) => {
            j["fs"] = { ...v2.fs, roots: [...v2.fs.roots, r] };
          }),
        ),
      ConfigurationError,
      "plain absolute drive path",
      r,
    );
  }
});

Deno.test("H-35 S3.2 goldenReset: runs lane-ops' script per container with the lineage and a pinned docker context, and parses its markers", async () => {
  const lineagePath = await copyLineage();
  const lineage = await loadLineage(lineagePath);
  const calls: { cmd: string; args: string[]; env: Record<string, string> }[] =
    [];
  const m = goldenReset({
    repoRoot: "R",
    lineagePath,
    lineage,
    dockerEnv: { DOCKER_CONTEXT: "desktop-windows" },
    spawn: (cmd, args, env) => {
      calls.push({ cmd, args, env });
      return Promise.resolve({
        code: 0,
        stdout: [
          ...RESET_PHASES.map((p) => `RESET_STEP ${p} 5`),
          "RESET_OK",
        ].join("\r\n"),
      });
    },
  });
  assertEquals([m.id, m.policyVersion], ["golden-restore", 1]);
  const r = await m.reset("Cronus283");
  assert(r.ok);
  assertEquals(calls, [{
    cmd: "pwsh",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      join("R", "infra", "harness-reset", "reset-golden.ps1"),
      "-Container",
      "Cronus283",
      "-Lineage",
      lineagePath,
    ],
    env: { DOCKER_CONTEXT: "desktop-windows" },
  }]);
  // The script's own failure marker comes through.
  const failing = goldenReset({
    repoRoot: "R",
    lineagePath,
    lineage,
    dockerEnv: {},
    spawn: () =>
      Promise.resolve({
        code: 1,
        stdout: "RESET_FAILED snapshot_guard snapshot of CRONUS exists (1)",
      }),
  });
  assertEquals((await failing.reset("C1")).failed_step, "snapshot_guard");
});

Deno.test("H-35 S3.2 loadLineage: the stored inventory hash is sha256 of its bytes", async () => {
  const j = JSON.parse(await Deno.readTextFile(REPO_LINEAGE));
  const bytes = await Deno.readFile(
    join("infra/harness-reset/lineages", j.inventory.path),
  );
  assertEquals(await sha256Hex(bytes), j.inventory.sha256);
});

Deno.test("H-35 S3.3 lineageCompat: identity fields only (no credentials, no host path); goldenReset carries it as its compat", async () => {
  const lineagePath = await copyLineage();
  const lineage = await loadLineage(lineagePath);
  const compat = lineageCompat(lineage);
  assert(!("soap_password" in compat) && !("soap_user" in compat));
  assert(!("golden_path_template" in compat));
  assertEquals(compat["golden_sha256"], lineage.golden_sha256);
  assertEquals(compat["inventory"], lineage.inventory);
  const m = goldenReset({
    repoRoot: "R",
    lineagePath,
    lineage,
    dockerEnv: {},
    spawn: () => Promise.resolve({ code: 0, stdout: "" }),
  });
  assertEquals(m.compat, { lineage: compat });
});

// ---- H-35 S3 L4: the lineage's fs section (decisions/2026-10-20-h-35-l4-scope.md) ----

const FS_SECTION = {
  digest_version: 1,
  roots: ["C:\\Windows\\Temp", "C:\\Run\\my"],
  identity: ["service_account|LocalSystem"],
  exclude: [{
    pattern:
      "C:\\ProgramData\\Microsoft\\Microsoft Dynamics NAV\\*\\Server\\*\\log\\*",
    disposition: "out_of_scope",
    reason: "NST rolling logs: no file API reaches them under L1/L3",
  }],
  survey: { path: "golden-o09-v1.survey.json", sha256: "b".repeat(64) },
};

Deno.test("H-35 S3 L4 lineage fs: an fs section loads and enters the compat identity; a disposition outside the two, an empty reason or an empty root list is refused", async () => {
  const l = await loadLineage(
    await copyLineage((j) => (j["fs"] = FS_SECTION)),
  );
  assertEquals(l.fs?.roots, FS_SECTION.roots);
  assertEquals(lineageCompat(l)["fs"], FS_SECTION);
  for (
    const bad of [
      {
        ...FS_SECTION,
        exclude: [{ ...FS_SECTION.exclude[0], disposition: "volatile" }],
      },
      { ...FS_SECTION, exclude: [{ ...FS_SECTION.exclude[0], reason: "" }] },
      { ...FS_SECTION, roots: [] },
    ]
  ) {
    await assertRejects(
      async () => loadLineage(await copyLineage((j) => (j["fs"] = bad))),
      ConfigurationError,
    );
  }
});

Deno.test("H-35 S3 L4 goldenReset.fsDigest: runs fs-capture.ps1 with the lineage and returns its lines; a failing exit adds an error line (fail closed); no fs section, no fsDigest", async () => {
  const lineagePath = await copyLineage((j) => (j["fs"] = FS_SECTION));
  const lineage = await loadLineage(lineagePath);
  const calls: string[][] = [];
  const m = goldenReset({
    repoRoot: "R",
    lineagePath,
    lineage,
    dockerEnv: {},
    spawn: (_c, args) => {
      calls.push(args);
      return Promise.resolve(
        args.includes("C2")
          ? { code: 1, stdout: "D|16|1|C:\\Run\\my\r\n" }
          : { code: 0, stdout: "D|16|1|C:\\Run\\my\r\nF|x\r\n" },
      );
    },
  });
  assertEquals(await m.fsDigest!("C1"), ["D|16|1|C:\\Run\\my", "F|x"]);
  assert(calls[0]!.some((a) => a.endsWith("fs-capture.ps1")));
  assertEquals(calls[0]!.slice(-4), [
    "-Container",
    "C1",
    "-Lineage",
    lineagePath,
  ]);
  assertEquals(await m.fsDigest!("C2"), [
    "D|16|1|C:\\Run\\my",
    "E|(fs-capture)|exit 1",
  ]);
  assertEquals(m.fsExclude, [FS_SECTION.exclude[0]!.pattern]);
  const none = goldenReset({
    repoRoot: "R",
    lineagePath: await copyLineage(),
    lineage: await loadLineage(await copyLineage()),
    dockerEnv: {},
  });
  assertEquals(none.fsDigest, undefined);
});

Deno.test("H-35 S3 L2b lineage egress: enforced carries the rule digest, unenforced a reason; goldenReset exposes the mode (absent when the lineage has none); anything else is refused", async () => {
  const enforced = { mode: "enforced", rule_sha256: "c".repeat(64) };
  const unenforced = {
    mode: "unenforced",
    reason: "no Windows Firewall in the image",
  };
  for (
    const [egress, mode] of [[enforced, "enforced"], [
      unenforced,
      "unenforced",
    ]] as const
  ) {
    const lineagePath = await copyLineage((j) => (j["egress"] = egress));
    const l = await loadLineage(lineagePath);
    assertEquals(lineageCompat(l)["egress"], egress);
    const m = goldenReset({
      repoRoot: "R",
      lineagePath,
      lineage: l,
      dockerEnv: {},
    });
    assertEquals(m.bcEgress, mode);
  }
  const plain = await copyLineage();
  assertEquals(
    goldenReset({
      repoRoot: "R",
      lineagePath: plain,
      lineage: await loadLineage(plain),
      dockerEnv: {},
    }).bcEgress,
    undefined,
  );
  for (
    const bad of [
      { mode: "enforced" },
      { mode: "unenforced", reason: "" },
      { mode: "off" },
    ]
  ) {
    await assertRejects(
      async () => loadLineage(await copyLineage((j) => (j["egress"] = bad))),
      ConfigurationError,
    );
  }
});

// ---- H-35 S3 content root (design-r5 Sol HIGH; owner: on every restore) ----

Deno.test("H-35 S3 lineage content_root: its per-table file must hash to the recorded sha256; exclusions need a reason; goldenReset exposes the root", async () => {
  const tables = "CRONUS$Customer|AB\nCRONUS$Item|CD\n";
  const sha = await sha256Hex(new TextEncoder().encode(tables));
  const section = (over: Record<string, unknown> = {}) => ({
    path: "golden.content.txt",
    sha256: sha,
    root: "e".repeat(64),
    exclude: [{ pattern: "Session Event", reason: "NST session log" }],
    ...over,
  });
  const withRoot = async (s: unknown, body = tables) => {
    const p = await copyLineage((j) => (j["content_root"] = s));
    await Deno.writeTextFile(join(dirname(p), "golden.content.txt"), body);
    return p;
  };
  const p = await withRoot(section());
  const l = await loadLineage(p);
  assertEquals(l.content_root?.root, "e".repeat(64));
  assertEquals(lineageCompat(l)["content_root"], section());
  assertEquals(
    goldenReset({ repoRoot: "R", lineagePath: p, lineage: l, dockerEnv: {} })
      .contentRoot,
    "e".repeat(64),
  );
  await assertRejects(
    async () => loadLineage(await withRoot(section(), "tampered\n")),
    ConfigurationError,
    "golden.content.txt",
  );
  await assertRejects(
    async () =>
      loadLineage(
        await withRoot(section({ exclude: [{ pattern: "x", reason: "" }] })),
      ),
    ConfigurationError,
  );
});

Deno.test("H-35 S3 L4 lineage platform_cache (addendum 3): an entry needs a base and anchored, compilable file and dir shapes; goldenReset hands them to fsDiff apart from the wildcard exclusions", async () => {
  const cache = {
    disposition: "platform_cache",
    base: "C:\\NAV\\apps",
    files: String.raw`^metadata\\3\\([0-9A-F]{2})\\\1[0-9A-F]{62}\.(cs|xml)$`,
    dirs: String.raw`^metadata(\\3(\\[0-9A-F]{2})?)?$`,
    reason: "NST metadata cache",
  };
  const path = await copyLineage((j) =>
    j["fs"] = { ...FS_SECTION, exclude: [...FS_SECTION.exclude, cache] }
  );
  const l = await loadLineage(path);
  const m = goldenReset({
    repoRoot: "R",
    lineagePath: path,
    lineage: l,
    dockerEnv: {},
  });
  assertEquals(m.fsExclude, [FS_SECTION.exclude[0]!.pattern]);
  assertEquals(m.fsCaches, [{
    base: cache.base,
    files: cache.files,
    dirs: cache.dirs,
  }]);
  for (
    const bad of [
      { ...cache, files: "metadata.*" }, // not anchored
      { ...cache, dirs: "^(unclosed$" }, // does not compile
      { ...cache, base: "" },
      { ...cache, magic: "MZ" }, // magic is hex
    ]
  ) {
    await assertRejects(
      async () =>
        loadLineage(
          await copyLineage((j) => j["fs"] = { ...FS_SECTION, exclude: [bad] }),
        ),
      ConfigurationError,
    );
  }
});

Deno.test("H-35 run 004 #4 lineage nst_config: the canonical digest section loads and enters env_fp; goldenReset reads the live digest through nst-config.ps1 (NST_CONFIG marker) and never throws", async () => {
  const section = {
    digest_version: 1,
    path:
      "C:\\Program Files\\Microsoft Dynamics NAV\\280\\Service\\CustomSettings.config",
    exclude_keys: ["PublicWebBaseUrl"],
    sha256: "e".repeat(64),
    keys: 251,
  };
  const lineagePath = await copyLineage((j) => (j["nst_config"] = section));
  const l = await loadLineage(lineagePath);
  assertEquals(lineageCompat(l)["nst_config"], section);
  const calls: string[][] = [];
  const m = goldenReset({
    repoRoot: "R",
    lineagePath,
    lineage: l,
    dockerEnv: {},
    spawn: (_c, args) => {
      calls.push(args);
      return Promise.resolve(
        args.includes("C1")
          ? { code: 0, stdout: `noise\r\nNST_CONFIG ${"e".repeat(64)}\r\n` }
          : args.includes("C2")
          ? { code: 1, stdout: "NST_CONFIG_FAILED docker exec failed" }
          : { code: 0, stdout: "nothing" },
      );
    },
  });
  assertEquals(m.nstConfigSha, "e".repeat(64));
  assertEquals(await m.nstConfigDigest!("C1"), {
    sha: "e".repeat(64),
    error: null,
  });
  assert(calls[0]!.some((a) => a.endsWith("nst-config.ps1")));
  assertEquals(calls[0]!.slice(-4), [
    "-Container",
    "C1",
    "-Lineage",
    lineagePath,
  ]);
  assertEquals(await m.nstConfigDigest!("C2"), {
    sha: null,
    error: "docker exec failed",
  });
  assertEquals((await m.nstConfigDigest!("C3")).sha, null);
  for (
    const bad of [
      { ...section, digest_version: 2 },
      { ...section, sha256: "x" },
      { ...section, path: "" },
    ]
  ) {
    await assertRejects(
      async () =>
        loadLineage(await copyLineage((j) => (j["nst_config"] = bad))),
      ConfigurationError,
    );
  }
});
