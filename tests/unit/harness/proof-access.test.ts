import { assert, assertEquals } from "@std/assert";
import { join, resolve } from "@std/path";
import { testTempDir } from "../../utils/temp-dir.ts";
import { privatePaths } from "../../../src/harness/execution.ts";
import { buildRunArgs } from "../../../src/harness/sandbox.ts";
import { adapterFor } from "../../../src/harness/adapters/mod.ts";
import {
  ACCESS_TABLE,
  type AccessRoots,
  canonicalDenied,
  canonicalPath,
  containerPaths,
  deniedRoots,
  mountProblems,
  serverMountProblems,
} from "../../../scripts/harness/proof/access.ts";

const R: AccessRoots = {
  resultsRoot: "D:\\cg\\results\\harness",
  privateRoot: "D:\\cg-private",
  symbolStore: "D:\\cg-symbols",
  keyCustody: "D:\\cg-custody",
  executionId: "0b7c4c1e-1111-4111-8111-111111111111",
  secretsDir: "D:\\cg-private\\secrets\\o-1a2b3c4d",
};

/** The sandbox spec as execution.ts lays it out for one execution. */
function args(extra: { src: string; dst: string; readWrite?: boolean }[] = []) {
  const p = privatePaths(
    { privateRoot: R.privateRoot } as never,
    R.executionId,
  );
  return buildRunArgs({
    name: "cg-sbx-x",
    owner: "o",
    executionId: R.executionId,
    imageId: `sha256:${"a".repeat(64)}`,
    workspace: join(p.work, "workspace"),
    taskDir: join(p.work, "task"),
    configDir: join(p.work, "config"),
    // createSecretsDir: <private>/secrets/<owner prefix><uuid>
    secretsDir: join(R.privateRoot, "secrets", "o-1a2b3c4d"),
    extraMounts: extra,
    env: {},
    timeoutMs: 1,
    killGraceMs: 1,
    opTimeoutMs: 1,
    maxCaptureBytes: 1,
    rawLog: "x",
    stderrLog: "y",
  } as never);
}

Deno.test("H-35c (design-r5 2.5): the access table has every row of the design for both identities", () => {
  assertEquals(ACCESS_TABLE.map((r) => r.target), [
    "results",
    "private_root",
    "logs",
    "symbols_and_compiler_caches",
    "appinfo",
    "judge_app_after_publish",
  ]);
  for (const r of ACCESS_TABLE) {
    assert(["denied", "not_present"].includes(r.sandbox), r.target);
    assert(["denied", "not_present"].includes(r.server), r.target);
  }
});

Deno.test("H-35c: the production sandbox layout (own work dir, own fresh secrets dir) mounts nothing on the denied list", () => {
  assertEquals(mountProblems(args(), R), []);
});

Deno.test("H-35c: every adapter's extra mounts pass the access check", async () => {
  for (const kind of ["claude-code", "pi", "mock"] as const) {
    const extra = await adapterFor(kind).extraMounts(
      {},
      "D:\\task",
      "D:\\repo",
    );
    assertEquals(mountProblems(args(extra), R), [], kind);
  }
});

Deno.test("H-35c: a mount of, inside, or above any denied root is refused; another execution's work dir and the secrets base are refused", () => {
  const bad = [
    R.resultsRoot,
    join(R.resultsRoot, "verdicts"),
    "D:\\cg\\results",
    R.privateRoot,
    join(R.privateRoot, "build-cache-judge"),
    join(R.privateRoot, "build-cache-agent", "k"),
    join(R.privateRoot, "custody"),
    join(R.privateRoot, "redaction"),
    join(R.privateRoot, "quarantine", R.executionId),
    join(R.privateRoot, "work", "another-id"),
    join(R.privateRoot, "secrets"),
    R.symbolStore,
    join(R.symbolStore, "appinfo"),
    R.keyCustody!,
    "C:\\ProgramData\\BcContainerHelper",
    "D:\\",
  ];
  for (const src of bad) {
    const p = mountProblems(args([{ src, dst: "C:\\x" }]), R);
    assertEquals(p.length, 1, `${src}: ${p}`);
  }
  // Case and separators do not hide a denied root.
  assertEquals(
    mountProblems(args([{ src: "d:/CG-PRIVATE/Custody", dst: "C:\\x" }]), R)
      .length,
    1,
  );
  // Sol r1 #2: another execution's secrets dir is not this one's.
  assertEquals(
    mountProblems(
      args([{ src: join(R.privateRoot, "secrets", "o-ffff"), dst: "C:\\x" }]),
      R,
    ).length,
    1,
  );
  // Sol r1 #3: a relative root names the same place as its absolute path.
  const rel = { ...R, resultsRoot: "results\\harness" };
  assertEquals(
    mountProblems(args([{ src: resolve("results"), dst: "C:\\x" }]), rel)
      .length,
    1,
  );
  assertEquals(
    serverMountProblems(
      [{
        Source: resolve("results\\harness"),
        Destination: "c:\\x",
        RW: false,
      }],
      rel,
      "Cronus285",
    ).length,
    1,
  );
});

Deno.test("H-35c (Sol r1 #3): canonicalPath resolves a junction to its target, so an innocent-looking link into a denied root is caught", async () => {
  const base = await Deno.realPath(await testTempDir());
  const custody = join(base, "private", "custody");
  await Deno.mkdir(custody, { recursive: true });
  const link = join(base, "innocent");
  try {
    await Deno.symlink(custody, link, { type: "junction" });
  } catch (err) {
    console.warn(`[SKIP] no junction here: ${err}`);
    return;
  }
  assertEquals(await canonicalPath(link), custody);
  assertEquals(await canonicalPath(join(base, "absent")), join(base, "absent"));
  const roots = { ...R, privateRoot: join(base, "private") };
  assertEquals(
    mountProblems(
      args([{ src: await canonicalPath(link), dst: "C:\\x" }]),
      roots,
    ).length,
    1,
  );
});

Deno.test("H-35c (Sol r2 #1): a denied folder that is itself a junction is caught at its target through canonicalDenied", async () => {
  const base = await Deno.realPath(await testTempDir());
  const vault = join(base, "vault");
  await Deno.mkdir(vault);
  await Deno.mkdir(join(base, "private"));
  try {
    await Deno.symlink(vault, join(base, "private", "custody"), {
      type: "junction",
    });
  } catch (err) {
    console.warn(`[SKIP] no junction here: ${err}`);
    return;
  }
  const roots = { ...R, privateRoot: join(base, "private") };
  const denied = await canonicalDenied(roots);
  assert(denied.some((d) => d.path === vault));
  assertEquals(
    mountProblems(args([{ src: vault, dst: "C:\\x" }]), roots, denied).length,
    1,
  );
  assertEquals(
    serverMountProblems(
      [{ Source: vault, Destination: "c:\\x", RW: false }],
      roots,
      "Cronus285",
      denied,
    ).length,
    1,
  );
});

Deno.test("H-35c (Sol r3 #2): BCH's per-container folder is exempt only from the BCH-root rule, never from another denied root that resolves into it", () => {
  const own = "C:\\ProgramData\\BcContainerHelper\\Extensions\\Cronus285";
  const denied = [
    ...deniedRoots(R),
    // custody, canonicalized, turned out to be a junction into BCH's folder
    { target: "private_root", path: `${own}\\my` },
  ];
  assertEquals(
    serverMountProblems(
      [{ Source: own, Destination: "c:\\run", RW: true }],
      R,
      "Cronus285",
      denied,
    ).length,
    1,
  );
  // Sol r4: even when that root resolves to BCH's root itself.
  assertEquals(
    serverMountProblems(
      [{ Source: own, Destination: "c:\\run", RW: true }],
      R,
      "Cronus285",
      [
        ...deniedRoots(R),
        { target: "private_root", path: "C:\\ProgramData\\BcContainerHelper" },
      ],
    ).length,
    1,
  );
  // Without such a root, the own folder is still accepted.
  assertEquals(
    serverMountProblems(
      [{ Source: own, Destination: "c:\\run", RW: true }],
      R,
      "Cronus285",
    ),
    [],
  );
});

Deno.test("H-35c (Sol r2 #2): containerPaths maps a host path through the mounts to every container path that shows it", () => {
  const a = args([{ src: "D:\\share", dst: "C:\\share" }]);
  assertEquals(containerPaths("D:\\share\\sub\\f.txt", a), [
    "C:\\share\\sub\\f.txt",
  ]);
  assertEquals(
    containerPaths(join(R.privateRoot, "work", R.executionId, "task", "f"), a),
    ["C:\\task\\f"],
  );
  assertEquals(containerPaths("D:\\nowhere\\f.txt", a), []);
});

Deno.test("H-35c: only the workspace is writable; any other read-write mount is refused", () => {
  const p = mountProblems(
    args([{ src: "D:\\elsewhere", dst: "C:\\x", readWrite: true }]),
    R,
  );
  assertEquals(p.length, 1);
  assert(p[0]!.includes("read-write"));
});

Deno.test("H-35c: the BC container's mounts (docker inspect) pass when they are BCH's per-container folder only; a results, private, symbol or compiler-folder mount fails", () => {
  const ok = [
    {
      Source: "C:\\ProgramData\\BcContainerHelper\\Extensions\\Cronus285",
      Destination: "c:\\run\\my",
      RW: true,
    },
    {
      Source: "C:\\ProgramData\\BcContainerHelper",
      Destination: "c:\\programdata\\bccontainerhelper",
      RW: true,
    },
  ];
  // BCH's own shared folder mount (the whole BCH root) carries the compiler
  // folders: refused unless lane-ops shows it is absent.
  assertEquals(serverMountProblems(ok.slice(0, 1), R, "Cronus285"), []);
  const bad = [
    R.resultsRoot,
    join(R.privateRoot, "work", "x"),
    R.symbolStore,
    "C:\\ProgramData\\BcContainerHelper\\compiler-cache-0123456789ab",
    "C:\\ProgramData\\BcContainerHelper\\Extensions\\Cronus284",
    "C:\\ProgramData\\BcContainerHelper",
  ];
  for (const Source of bad) {
    assertEquals(
      serverMountProblems(
        [{ Source, Destination: "c:\\x", RW: false }],
        R,
        "Cronus285",
      ).length,
      1,
      Source,
    );
  }
});

Deno.test("H-35c: the denied roots name the design-r5 2.5 targets", () => {
  const t = new Set(deniedRoots(R).map((d) => d.target));
  for (const r of ACCESS_TABLE) {
    if (r.target !== "judge_app_after_publish") {
      assert(t.has(r.target), r.target);
    }
  }
});
