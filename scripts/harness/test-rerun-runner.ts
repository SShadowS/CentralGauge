/**
 * Q-04 phase B: the production TestRerunRunner. No container path of its own:
 * the workspace is `buildVerdictWorkspace`, the build is `prepareApps`, and
 * publish + test is `lane.exclusive(deployAndTest)` on the harness lane.
 * `productionRunner` opens the harness environment (`openHarnessEnv`: bench
 * lock, private-root lock, coord lease check, lane with `blocked`) and closes
 * it at the end of the step.
 */
import { dirname, join } from "@std/path";
import {
  CLOUD_POLICY,
  deployAndTest,
  isCascadeDiagnostic,
  prepareApps,
  type Prepared,
  type TestSpec,
} from "../../src/harness/bc-lane.ts";
import type { HarnessEnv } from "../../src/harness/execution.ts";
import { safeCopyTree } from "../../src/harness/fsutil.ts";
import {
  hashFile,
  hashTree,
  isTaskBuildArtifact,
} from "../../src/harness/hash.ts";
import { sha256Hex } from "./analyze-campaign.ts";
import { readAppGraph, type StagedApp } from "../../src/harness/staging.ts";
import { currentScorerFingerprint } from "../../src/harness/verdict.ts";
import {
  buildVerdictWorkspace,
  isSourceFile,
  TEST_APP,
} from "../../src/harness/verdict-workspace.ts";
import type {
  RunnerIdentity,
  RunnerResult,
  RunnerRow,
  TestRerunRequest,
  TestRerunRunner,
} from "./test-rerun.ts";

/** What the runner reads of the opened harness environment. */
export type RerunEnv = Pick<
  HarnessEnv,
  | "lane"
  | "symbols"
  | "symbolStore"
  | "onPrem"
  | "deploy"
  | "buildCache"
  | "harnessCommit"
>;

/**
 * The start tree with the Test app emptied to its app.json: the final Test
 * app is then all "new files" to the verdict workspace, so its test codeunits
 * are published as written (shipped procedures the agent edited included),
 * under the same Test policy and credit rules as a judged workspace.
 */
async function withoutShippedTests(start: string, dst: string) {
  const { dst: out } = await safeCopyTree(start, dst);
  for await (const e of Deno.readDir(join(out, TEST_APP))) {
    if (e.name.toLowerCase() === "app.json") continue;
    await Deno.remove(join(out, TEST_APP, e.name), { recursive: true });
  }
  return out;
}

/**
 * Replace the built workspace's Test sources with a verbatim copy of the agent's
 * (the same source filter as buildVerdictWorkspace); the workspace's merged
 * app.json stays.
 */
async function restoreAgentTest(agent: string, built: string, scratch: string) {
  const copy = await safeCopyTree(join(agent, TEST_APP), scratch, {
    skip: (rel, isDir) =>
      isTaskBuildArtifact(rel) ||
      (!isDir && !isSourceFile(rel.split("/").pop()!)) ||
      rel.split("/").some((s) => s.startsWith(".")),
  });
  const test = join(built, TEST_APP);
  for await (const e of Deno.readDir(test)) {
    if (e.name.toLowerCase() === "app.json") continue;
    await Deno.remove(join(test, e.name), { recursive: true });
  }
  for await (const e of Deno.readDir(copy.dst)) {
    if (e.name.toLowerCase() === "app.json") continue;
    await Deno.rename(join(copy.dst, e.name), join(test, e.name));
  }
}

/** App name -> sha256 of the published package (or `src:` + source tree hash when none was built), and the Test app's. */
async function identityOf(
  prep: Prepared,
  apps: StagedApp[],
  dir: string,
  container: string,
  bcVersion: string,
): Promise<RunnerIdentity> {
  const production_apps: Record<string, string> = {};
  let test_app: string | null = null;
  for (const a of apps) {
    const w = prep.wanted.find((x) =>
      x.id.toLowerCase() === a.id.toLowerCase()
    );
    const file = w?.file ?? prep.built.find((b) => b.id === a.id && b.ok)?.file;
    const h = w?.sha256 ??
      (file
        ? await hashFile(dirname(file), file)
        : `src:${await hashTree(join(dir, a.folder), "task")}`);
    if (a.folder === TEST_APP) test_app = h;
    else production_apps[a.name] = h;
  }
  if (test_app === null) throw new Error("no Test app in the prepared build");
  return { production_apps, test_app, container, bc_version: bcVersion };
}

export async function envRunner(
  env: RerunEnv,
  workRoot: string,
): Promise<TestRerunRunner> {
  await Deno.mkdir(workRoot, { recursive: true });
  const symbolIds = new Set(env.symbols.map((s) => s.app_id.toLowerCase()));
  const lock = { store: env.symbolStore, packages: env.symbols };
  /** Artifact URL plus the BCH pin; the URL's query (a SAS token) is dropped. */
  const bcVersion = async (container: string) =>
    (await env.lane.bc.harnessCompilerIdentity(container)).replace(
      /\?[^|]*/,
      "",
    );

  async function run(req: TestRerunRequest): Promise<RunnerResult> {
    const work = join(workRoot, crypto.randomUUID().slice(0, 8));
    await Deno.mkdir(work, { recursive: true });
    try {
      // Shipped run: the Test app is the pristine start one, byte for byte.
      const shipped = req.test === req.start;
      const pristine = shipped
        ? req.start
        : await withoutShippedTests(req.start, join(work, "pristine"));
      const vw = await buildVerdictWorkspace({
        pristine,
        artifact: shipped ? req.production : req.test,
        out: join(work, "verdict"),
        productionFrom: req.production,
        symbolIds,
        onPrem: env.onPrem,
        ...(shipped ? { rawTest: true } : {}),
      });
      if (vw.violations.length > 0) {
        throw new Error(`workspace violations: ${vw.violations.join("; ")}`);
      }
      // The policy checks above ran; the credit rules may still have rewritten or
      // dropped agent procedures (a Variant user). The agent's Test sources are
      // published as written; the shipped run (rawTest) is never rewritten.
      if (!shipped) {
        await restoreAgentTest(req.test, vw.dir, join(work, "asis"));
      }
      // A crashed build throws inside prepareApps (throwIfCrashed): infra, never a result.
      const prep = await prepareApps(env.lane, {
        pristine,
        pristineApps: await readAppGraph(pristine),
        candidateDir: vw.dir,
        candidateApps: vw.apps,
        // the verbatim Test folder may differ from what the workspace hashed
        changed: !shipped && !vw.changed.includes(TEST_APP)
          ? [...vw.changed, TEST_APP]
          : vw.changed,
        workDir: join(work, "apps"),
        lock,
        versionPlan: "judge",
        policy: CLOUD_POLICY,
        label: "test-rerun",
        ...(env.buildCache ? { cache: env.buildCache } : {}),
      });
      if (!prep.buildOk) {
        return {
          compile: {
            ok: false,
            diagnostics: prep.built.filter((b) => !b.ok).flatMap((b) =>
              b.diagnostics.filter((d) => !isCascadeDiagnostic(d)).map((d) =>
                `${b.folder} ${d.code}: ${d.message}`
              )
            ),
          },
          identity: await identityOf(
            prep,
            vw.apps,
            vw.dir,
            prep.container,
            await bcVersion(prep.container),
          ),
          rows: [],
        };
      }
      const tests: TestSpec[] = req.specs.map((s) => ({
        codeunit: s.codeunit,
        procedures: s.procedures,
        target: "candidate",
      }));
      const held = await env.lane.exclusive(
        {
          taskId: "test-rerun",
          variantId: req.executionId,
          attemptNumber: 1,
        },
        (c) =>
          deployAndTest(env.lane.bc, c, {
            wanted: prep.wanted,
            tests,
            cleanupIds: [...prep.candidateIds].reverse(),
            ctx: {
              ledgerRoot: env.deploy.ledgerRoot,
              trustedRoots: [req.start],
              reset: env.deploy.reset,
            },
          }),
      );
      if (held.result.cleanupError) {
        console.error(
          `[WARN] test-rerun ${req.executionId}: quarantined ${held.container}: ${held.result.cleanupError}`,
        );
      }
      const key = (codeunit: number, procedure: string) =>
        `${codeunit}|${procedure.toLowerCase()}`;
      const messages = new Map<string, string[]>();
      for (const m of held.result.messages) {
        const k = key(m.codeunit, m.procedure);
        messages.set(k, [...messages.get(k) ?? [], m.message]);
      }
      const rows = held.result.rows.map((r): RunnerRow => ({
        codeunit: r.codeunit,
        procedure: r.procedure,
        // The lane's "error" outcome is a run that did not complete: not_run.
        outcome: r.outcome === "error" ? "not_run" : r.outcome,
        failure: r.failure,
        message: messages.get(key(r.codeunit, r.procedure))?.join("\n") ?? null,
      }));
      return {
        compile: { ok: true, diagnostics: [] },
        identity: await identityOf(
          prep,
          vw.apps,
          vw.dir,
          held.container,
          await bcVersion(held.container),
        ),
        rows,
      };
    } finally {
      await Deno.remove(work, { recursive: true }).catch(() => {});
    }
  }

  return {
    // No commit (or `<HEAD>+dirty`), no sharing: an uncommitted harness never reuses a cache.
    id: `${
      env.harnessCommit && !env.harnessCommit.endsWith("+dirty")
        ? env.harnessCommit
        : `uncommitted-${crypto.randomUUID()}`
    }-${(await currentScorerFingerprint()).slice(0, 16)}`,
    // bc_version: the lane's compiler identity per container (the same value a run
    // records in its identity); symbols: sha256 of the locked package list.
    env: async () => ({
      containers: await Promise.all(
        env.lane.containers.map(async (name) => ({
          name,
          bc_version: await bcVersion(name),
        })),
      ),
      symbols: await sha256Hex(
        JSON.stringify(
          [...env.symbols].sort((a, b) => a.app_id.localeCompare(b.app_id)),
        ),
      ),
    }),
    run,
  };
}

export interface ProductionOptions {
  repoRoot: string;
  /** Records root of the opened environment: kept out of the campaign results. */
  resultsDir: string;
  containers: string[];
  /** `--coord-lease <container>=<token>` values. */
  coordLeases: string[];
  symbolStore: string;
  privateRoot: string;
  lineage: string | null;
}

/** Opens the harness environment for this step; `close()` releases it. */
export async function productionRunner(
  o: ProductionOptions,
): Promise<TestRerunRunner> {
  const [{ openHarnessEnv }, { parseCoordLease }] = await Promise.all([
    import("../../cli/commands/harness-env.ts"),
    import("../../cli/commands/harness-command.ts"),
  ]);
  const leases = new Map(o.coordLeases.map(parseCoordLease));
  const h = await openHarnessEnv({
    repoRoot: o.repoRoot,
    resultsDir: o.resultsDir,
    containers: o.containers,
    backendPort: 3210,
    // The backend is never asked for a grant here; no provider credential is read.
    secretsSource: join(o.privateRoot, "no-secrets"),
    symbolStore: o.symbolStore,
    privateRoot: o.privateRoot,
    credentialLedger: null,
    command: "analyze-campaign --test-rerun",
    supervised: false,
    ...(o.lineage ? { lineage: o.lineage } : {}),
    ...(leases.size > 0 ? { coordLeases: leases } : {}),
  });
  const work = join(o.privateRoot, "work", `test-rerun-${crypto.randomUUID()}`);
  try {
    const runner = await envRunner(h.env, work);
    return {
      ...runner,
      close: async () => {
        await Deno.remove(work, { recursive: true }).catch(() => {});
        await h.close();
      },
    };
  } catch (err) {
    await h.close();
    throw err;
  }
}
