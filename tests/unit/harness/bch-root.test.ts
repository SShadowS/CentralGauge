// H-58: a per-container BcContainerHelper root. A container listed as
// migrated in <coord>\bch-roots.json uses C:\ProgramData\BcContainerHelper-<c>
// in every BCH call; every other container keeps the shared root, byte for byte.
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { BcContainerProvider } from "../../../src/container/bc-container-provider.ts";
import {
  buildCompileScript,
  buildListHarnessAppsScript,
  buildPrereqCleanupScript,
} from "../../../src/container/bc-script-builders.ts";
import { PwshContainerSession } from "../../../src/container/pwsh-session.ts";
import { createMockPwshProcess } from "../../utils/mock-pwsh-process.ts";
import { loadLineage } from "../../../src/harness/lineage.ts";
import { goldenReset } from "../../../src/harness/reset.ts";
import { join } from "@std/path";
import {
  _resetBchRootsForTest,
  allBchRoots,
  BCH_ROOT_ENV,
  bchPath,
  bchRootEnv,
  bchRootFor,
  bchRootLines,
  SHARED_BCH_ROOT,
} from "../../../src/container/bch-root.ts";
import { bcchImport } from "../../../src/container/bcch-config.ts";
import { ConfigurationError } from "../../../src/errors.ts";
import { MockEnv } from "../../utils/test-helpers.ts";

const OWN = "C:\\ProgramData\\BcContainerHelper-Cronus285";

/** Points CG_COORD_ROOT at a temp coord root holding `body` (or nothing). */
async function withRoots(
  body: string | null,
  fn: () => void | Promise<void>,
) {
  const dir = await Deno.makeTempDir({ prefix: "cg-bch-root-" });
  const env = new MockEnv();
  try {
    if (body !== null) {
      await Deno.writeTextFile(join(dir, "bch-roots.json"), body);
    }
    env.set("CG_COORD_ROOT", dir);
    _resetBchRootsForTest();
    await fn();
  } finally {
    env.restore();
    _resetBchRootsForTest();
    await Deno.remove(dir, { recursive: true });
  }
}

const MIGRATED = JSON.stringify({ migrated: ["Cronus285"] });

Deno.test("bch-root: no bch-roots.json means every container keeps the shared root and the import is unchanged", async () => {
  const before = bcchImport(null);
  await withRoots(null, () => {
    for (const c of ["Cronus281", "Cronus285"]) {
      assertEquals(bchRootFor(c), SHARED_BCH_ROOT);
      assertEquals(bchRootLines(c), "");
      assertEquals(bcchImport(c), before, "byte for byte as today");
    }
    assertEquals(allBchRoots(), [SHARED_BCH_ROOT]);
  });
});

Deno.test("bch-root: a migrated container (any case) maps to its own root; others stay shared and byte-identical", async () => {
  await withRoots(MIGRATED, () => {
    assertEquals(bchRootFor("Cronus285"), OWN);
    assertEquals(bchRootFor("cronus285"), OWN, "the listed spelling wins");
    assertEquals(bchRootFor("Cronus281"), SHARED_BCH_ROOT);
    assertEquals(bcchImport("Cronus281"), bcchImport(null));
    assertEquals(allBchRoots(), [SHARED_BCH_ROOT, OWN]);
  });
});

Deno.test("bch-root: the migrated import sets hostHelperFolder and fails closed unless the root is mounted in that container", async () => {
  await withRoots(MIGRATED, () => {
    const s = bcchImport("Cronus285");
    assert(s.startsWith(bcchImport(null)), "the pinned import comes first");
    assertStringIncludes(
      s,
      `$bcContainerHelperConfig.hostHelperFolder = '${OWN}'`,
    );
    assertStringIncludes(
      s,
      `Get-BcContainerPath -containerName 'Cronus285' -path '${OWN}'`,
    );
    assertStringIncludes(s, 'throw "[CG-BCH-ROOT]');
  });
});

Deno.test("bch-root: bchPath rebases a shared-root path onto the container's root, and refuses a path outside it", async () => {
  await withRoots(MIGRATED, () => {
    const my = `${SHARED_BCH_ROOT}\\Extensions\\Cronus285\\my`;
    assertEquals(bchPath("Cronus285", my), `${OWN}\\Extensions\\Cronus285\\my`);
    assertEquals(
      bchPath("Cronus285", "c:\\programdata\\bccontainerhelper\\compiler"),
      `${OWN}\\compiler`,
    );
    assertEquals(
      bchPath("Cronus281", my.replace("285", "281")),
      my.replace("285", "281"),
    );
    assertEquals(bchPath("Cronus285", SHARED_BCH_ROOT), OWN);
    assertThrows(
      () => bchPath("Cronus285", "C:\\ProgramData\\BcContainerHelperX\\a"),
      ConfigurationError,
      "not under",
    );
  });
});

Deno.test("bch-root: the root is read once per process, so a later edit cannot give one container two roots", async () => {
  await withRoots(MIGRATED, async () => {
    assertEquals(bchRootFor("Cronus285"), OWN);
    await Deno.writeTextFile(
      join(Deno.env.get("CG_COORD_ROOT")!, "bch-roots.json"),
      JSON.stringify({ migrated: [] }),
    );
    assertEquals(bchRootFor("Cronus285"), OWN);
  });
});

Deno.test("bch-root: a malformed, unknown-key or unsafe-name file fails closed", async () => {
  for (
    const body of [
      "{not json",
      JSON.stringify({ migrated: "Cronus285" }),
      JSON.stringify({ migrated: ["Cronus285"], extra: 1 }),
      JSON.stringify({ migrated: ["Cronus285'; rm"] }),
      JSON.stringify({ migrated: ["Cronus285", "cronus285"] }),
      JSON.stringify([{ migrated: ["Cronus285"] }]),
    ]
  ) {
    await withRoots(body, () => {
      assertThrows(() => bchRootFor("Cronus281"), ConfigurationError);
      assertThrows(() => bcchImport("Cronus281"), ConfigurationError);
    });
  }
});

Deno.test("bch-root: bchRootEnv hands a spawned script the root this process resolved", async () => {
  await withRoots(MIGRATED, () => {
    assertEquals(bchRootEnv("Cronus285"), { [BCH_ROOT_ENV]: OWN });
    assertEquals(bchRootEnv("Cronus281"), {
      [BCH_ROOT_ENV]: SHARED_BCH_ROOT,
    });
  });
});

// ---- the call sites (H-58) ----

Deno.test("bch-root: a container's warm pwsh session bootstraps with that container's root; others are unchanged", async () => {
  await withRoots(MIGRATED, () => {
    const boot = (c: string) =>
      (new PwshContainerSession(c) as unknown as { _bootstrapScript: string })
        ._bootstrapScript;
    assertStringIncludes(boot("Cronus285"), bchRootLines("Cronus285"));
    assert(!boot("Cronus281").includes("hostHelperFolder"));
    assertStringIncludes(boot("Cronus281"), bcchImport(null));
  });
});

/** Drives init() against a mock pwsh: answers the bootstrap marker with `exit`; returns what was sent. */
async function initWith(c: string, exit: number) {
  const mock = createMockPwshProcess();
  const sess = new PwshContainerSession(c, {
    spawnFactory: () => mock.process,
    bootstrapTimeoutMs: 5_000,
  });
  const init = sess.init();
  await new Promise((r) => setTimeout(r, 10));
  const sent = mock.getStdinWrites().join("");
  const token = /CG-DONE-([a-f0-9-]+)-EXIT-/.exec(sent)![1];
  mock.emitStdout(
    `${
      exit ? "CG_BOOTSTRAP_THREW: [CG-BCH-ROOT] x\n" : ""
    }@@CG-DONE-${token}-EXIT-${exit}@@\n`,
  );
  return { init, sent, sess };
}

/** The guarded line a migrated container's session sends for `bootstrap`, run in a real pwsh. */
async function runGuarded(bootstrap: string): Promise<string> {
  const mock = createMockPwshProcess();
  const sess = new PwshContainerSession("Cronus285", {
    spawnFactory: () => mock.process,
    bootstrapTimeoutMs: 5_000,
    bootstrapScript: bootstrap,
  });
  const init = sess.init().catch(() => {});
  await new Promise((r) => setTimeout(r, 10));
  const sent = mock.getStdinWrites().join("");
  const token = /CG-DONE-([a-f0-9-]+)-EXIT-/.exec(sent)![1];
  mock.emitStdout(`@@CG-DONE-${token}-EXIT-0@@\n`);
  await init;
  await sess.dispose();
  const r = await new Deno.Command("pwsh", {
    args: ["-NoProfile", "-NonInteractive", "-Command", sent],
    stdout: "piped",
    stderr: "piped",
  }).output();
  return new TextDecoder().decode(r.stdout);
}

Deno.test({
  name:
    "bch-root: the guarded bootstrap keeps the script's meaning (comments, here-strings, continuations) and a throw reports a non-zero exit (real pwsh)",
  ignore: Deno.build.os !== "windows",
  fn: async () => {
    await withRoots(MIGRATED, async () => {
      const script = [
        "# a comment line",
        "$x = @'",
        "here; # not a comment",
        "'@",
        "$y = 'a' + `",
        "  'b'",
        'Write-Output "V=$x|$y"',
      ].join("\n");
      const ok = await runGuarded(script);
      assertStringIncludes(ok, "V=here; # not a comment|ab");
      assert(/-EXIT-0@@/.test(ok), ok);
      const bad = await runGuarded(
        `${script}\nthrow "[CG-BCH-ROOT] not mounted"\nWrite-Output AFTER`,
      );
      assertStringIncludes(
        bad,
        "CG_BOOTSTRAP_THREW: [CG-BCH-ROOT] not mounted",
      );
      assert(!bad.includes("AFTER"), bad);
      assert(/-EXIT-1@@/.test(bad), bad);
    });
  },
});

Deno.test("bch-root: a migrated container's session bootstrap runs guarded and a failed root check fails init; others are sent as before", async () => {
  await withRoots(MIGRATED, async () => {
    const bad = await initWith("Cronus285", 1);
    assertStringIncludes(bad.sent, "try { ");
    assertStringIncludes(bad.sent, "-EXIT-$cgBootExit@@");
    await assertRejects(() => bad.init, Error, "[CG-BCH-ROOT]");
    const good = await initWith("Cronus285", 0);
    await good.init;
    assertEquals(good.sess.state, "idle");
    await good.sess.dispose();
    const plain = await initWith("Cronus281", 0);
    await plain.init;
    assert(!plain.sent.includes("try {"), "unmigrated bootstrap is unchanged");
    assert(
      /\nWrite-Output "@@CG-DONE-[a-f0-9-]+-EXIT-0@@"\n$/.test(plain.sent),
    );
    await plain.sess.dispose();
  });
});

Deno.test("bch-root: container scripts carry the root; the host-side compile script never does", async () => {
  await withRoots(MIGRATED, () => {
    const line = bchRootLines("Cronus285");
    assertStringIncludes(
      buildPrereqCleanupScript("Cronus285", [], "CG Test Harness"),
      line,
    );
    assertStringIncludes(buildListHarnessAppsScript("Cronus285"), line);
    assert(
      !buildPrereqCleanupScript("Cronus281", [], "CG Test Harness").includes(
        "hostHelperFolder",
      ),
    );
    assert(!buildCompileScript("F", "P", "O").includes("hostHelperFolder"));
  });
});

class PathProbe extends BcContainerProvider {
  my(c: string) {
    return this.harnessSharedFolder(c);
  }
  /** Where adoption looks: BCH builds `hostHelperFolder\compiler\CentralGauge-<c>` (New-BcCompilerFolder.ps1:64). */
  adoptable(c: string) {
    return (this as unknown as {
      adoptableFolderPath(c: string): string | undefined;
    }).adoptableFolderPath(c);
  }
}

Deno.test("bch-root: the provider stages under the container's own root and refuses to create a migrated container", async () => {
  await withRoots(MIGRATED, async () => {
    const p = new PathProbe();
    assertEquals(p.my("Cronus285"), `${OWN}\\Extensions\\Cronus285\\my`);
    assertEquals(
      p.my("Cronus281"),
      `${SHARED_BCH_ROOT}\\Extensions\\Cronus281\\my`,
    );
    assertEquals(
      p.adoptable("Cronus285"),
      `${OWN}\\compiler\\CentralGauge-Cronus285`,
    );
    assertEquals(
      p.adoptable("Cronus281"),
      `${SHARED_BCH_ROOT}\\compiler\\CentralGauge-Cronus281`,
    );
    await assertRejects(
      () => p.setup({ name: "Cronus285" } as Parameters<PathProbe["setup"]>[0]),
      ConfigurationError,
      "H-57",
    );
  });
});

Deno.test("bch-root: every reset script gets the root this process resolved", async () => {
  await withRoots(MIGRATED, async () => {
    const envs: Record<string, string>[] = [];
    const m = goldenReset({
      repoRoot: "R",
      lineagePath: "L.json",
      lineage: await loadLineage(
        "infra/harness-reset/lineages/golden-o09-v1.json",
      ),
      dockerEnv: { DOCKER_CONTEXT: "desktop-windows" },
      spawn: (_cmd, _args, env) => {
        envs.push(env);
        return Promise.resolve({ code: 0, stdout: "VERIFY_OK" });
      },
    });
    await m.verifyClean!("Cronus285");
    await m.verifyClean!("Cronus281");
    assertEquals(envs, [
      { DOCKER_CONTEXT: "desktop-windows", [BCH_ROOT_ENV]: OWN },
      { DOCKER_CONTEXT: "desktop-windows", [BCH_ROOT_ENV]: SHARED_BCH_ROOT },
    ]);
  });
});

/** reset-lib.ps1's root functions, run in a real pwsh with no BCH and no container. */
async function resetLib(
  coord: string,
  expr: string,
  env: Record<string, string> = {},
): Promise<{ code: number; out: string }> {
  const lib = join(Deno.cwd(), "infra", "harness-reset", "reset-lib.ps1");
  const r = await new Deno.Command("pwsh", {
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `$ErrorActionPreference = 'Stop'; . '${lib}'; ${expr}`,
    ],
    env: { CG_COORD_ROOT: coord, ...env },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const d = new TextDecoder();
  return {
    code: r.code,
    out: (d.decode(r.stdout) + d.decode(r.stderr)).trim(),
  };
}

Deno.test({
  name:
    "bch-root: reset-lib.ps1 resolves the same root from the same file, rebases the golden path, and fails closed",
  ignore: Deno.build.os !== "windows",
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "cg-bch-ps-" });
    try {
      const none = await resetLib(dir, "Get-CgBchRoot 'Cronus285'");
      assertEquals(none, { code: 0, out: SHARED_BCH_ROOT });
      await Deno.writeTextFile(join(dir, "bch-roots.json"), MIGRATED);
      assertEquals(
        (await resetLib(dir, "Get-CgBchRoot 'cronus285'")).out,
        OWN,
      );
      assertEquals(
        (await resetLib(dir, "Get-CgBchRoot 'Cronus281'")).out,
        SHARED_BCH_ROOT,
      );
      assertEquals(
        (await resetLib(
          dir,
          `Convert-CgBchPath 'Cronus285' '${SHARED_BCH_ROOT}\\Extensions\\Cronus285\\cg-official\\g.bak'`,
        )).out,
        `${OWN}\\Extensions\\Cronus285\\cg-official\\g.bak`,
      );
      // read once per process: an edit mid-script changes nothing (Sol r1 HIGH)
      const file = join(dir, "bch-roots.json");
      assertEquals(
        (await resetLib(
          dir,
          `Get-CgBchRoot 'Cronus285'; Set-Content -LiteralPath '${file}' '{"migrated":[]}'; Get-CgBchRoot 'Cronus285'`,
        )).out.split(/\r?\n/),
        [OWN, OWN],
      );
      await Deno.writeTextFile(file, MIGRATED);
      // the calling process resolved another root: refused
      const mismatch = await resetLib(dir, "Get-CgBchRoot 'Cronus285'", {
        [BCH_ROOT_ENV]: SHARED_BCH_ROOT,
      });
      assert(mismatch.code !== 0, mismatch.out);
      assertStringIncludes(mismatch.out, "[CG-BCH-ROOT]");
      // an unmigrated container dot-sources the lib with no BCH loaded and no change
      assertEquals(
        await resetLib(
          dir,
          "$Container = 'Cronus281'; . '" +
            join(Deno.cwd(), "infra", "harness-reset", "reset-lib.ps1") +
            "'; 'ok'",
        ),
        { code: 0, out: "ok" },
      );
      for (
        const body of [
          JSON.stringify({ migrated: "Cronus285" }),
          JSON.stringify({ migrated: ["Cronus285"], extra: 1 }),
          JSON.stringify({ migrated: ["Cronus285'"] }),
          JSON.stringify([{ migrated: ["Cronus285"] }]),
          JSON.stringify({ migrated: ["Cronus285", "cronus285"] }),
        ]
      ) {
        await Deno.writeTextFile(join(dir, "bch-roots.json"), body);
        const bad = await resetLib(dir, "Get-CgBchRoot 'Cronus281'");
        assert(bad.code !== 0, `${body}: ${bad.out}`);
      }
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
