// CLI and executors of the M4 authoring gate. Owner: lane-ops.
//   check <taskDir>...                        static rules, no container
//   compile <taskDir> <variant>               host al compile, no container
//   stage <taskId> <outDir> [--rev R]         baseline workspace for the pilot
//   gate <container> <taskId> [--rev R]       container job
//   judge <container> <taskId> <ws> [--rev R] pilot scoring, developmental
import { parseArgs } from "@std/cli/parse-args";
import * as colors from "@std/fmt/colors";
import { walk } from "@std/fs";
import { dirname, join, relative } from "@std/path";
import type { ALProject, TestResult } from "../../src/container/types.ts";
import type { HarnessTask, LoadedTask } from "../../src/harness/task.ts";
import type { GateRun, RunResult, TestRef, Variant } from "./gate-core.ts";
import type { Source } from "./gate-stage.ts";
import { BcContainerProvider } from "../../src/container/bc-container-provider.ts";
import {
  resolveSoapTimeoutMs,
  runTestsViaSoap,
} from "../../src/container/soap-test-client.ts";
import { readAppJsonRaw } from "../../src/harness/staging.ts";
import { loadTask } from "../../src/harness/task.ts";
import {
  allPass,
  assertionKill,
  BUILD_ORDER,
  classifyTestFailure,
  decideGate,
  gatePlan,
  layers,
  parseVariant,
  runKey,
  summarize,
  variantName,
} from "./gate-core.ts";
import {
  checkTask,
  exists,
  exportSource,
  git,
  stagedHash,
  stageWorkspace,
  testManifestIn,
} from "./gate-stage.ts";

const EVIDENCE_ROOT = "H:\\Temp3\\harness-spike\\M4";
const TMP_ROOT = Deno.env.get("CG_GATE_TMP") ?? join(EVIDENCE_ROOT, "tmp");
const SYMBOLS = Deno.env.get("CG_AL_SYMBOLS") ??
  "C:\\ProgramData\\BcContainerHelper\\compiler-cache-15ff3c5d109b\\symbols";

export interface CompileOut {
  ok: boolean;
  codes: string[];
  detail: string;
  artifact?: string;
}
export interface GateBc {
  prenuke(): Promise<void>;
  compile(project: ALProject): Promise<CompileOut>;
  publish(artifact: string): Promise<void>;
  runTests(codeunit: number, appId: string): Promise<TestResult>;
  dispose(): Promise<void>;
}

export async function containerBc(
  container: string,
  credentials: { username: string; password: string },
): Promise<GateBc | null> {
  const provider = new BcContainerProvider();
  provider.setCredentials(container, credentials);
  if (!(await provider.isHealthy(container))) return null;
  await provider.ensureTestHarness([container]);
  const soap = {
    host: container,
    port: 7047,
    company: "My Company",
    tenant: "default",
    credentials,
    timeoutMs: resolveSoapTimeoutMs(undefined),
  };
  return {
    prenuke: () => provider.prenukeCentralGaugeApps([container]),
    compile: async (project) => {
      const r = await provider.compileProject(container, project);
      return {
        ok: r.success && r.artifactPath !== undefined,
        codes: r.errors.map((e) => e.code),
        detail: r.errors.map((e) => `${e.code} ${e.message}`).join("; "),
        ...(r.artifactPath ? { artifact: r.artifactPath } : {}),
      };
    },
    // Never runTests()/prepareCandidateApp: its cleanup removes the refapp apps (findings section 2).
    publish: (artifact) => provider.publishApp(container, artifact),
    runTests: (codeunit, appId) => runTestsViaSoap(soap, codeunit, appId),
    dispose: () => provider.dispose(),
  };
}

async function loadProject(dir: string): Promise<ALProject> {
  const appJson = await readAppJsonRaw(join(dir, "app.json")) as Record<
    string,
    unknown
  >;
  const sourceFiles: string[] = [];
  for await (const e of walk(dir, { exts: [".al"], followSymlinks: false })) {
    if (e.isFile && !e.path.includes(".alpackages")) sourceFiles.push(e.path);
  }
  return { path: dir, appJson, sourceFiles, testFiles: [] };
}

async function stageVariant(
  task: HarnessTask,
  source: Source,
  v: Variant,
  ws: string,
): Promise<{ apps: string[]; usesOracle: boolean; own: TestRef[] }> {
  const testAuthoring = task.kind === "test-authoring";
  await stageWorkspace(
    source.refappDir,
    layers(source.taskDir, v, testAuthoring),
    ws,
  );
  const usesOracle = task.fail_to_pass !== null && v.kind !== "tests" &&
    !(v.kind === "candidate" && testAuthoring);
  if (usesOracle) {
    const oracleDir = join(source.taskDir, "oracle");
    for await (const e of walk(oracleDir, { followSymlinks: false })) {
      if (e.isSymlink) throw new Error(`link refused: ${e.path}`);
      if (!e.isFile) continue;
      const rel = relative(oracleDir, e.path);
      await Deno.mkdir(dirname(join(ws, "Oracle", rel)), { recursive: true });
      await Deno.copyFile(e.path, join(ws, "Oracle", rel));
    }
  }
  let own: TestRef[] = [];
  if (v.kind === "tests") {
    own = await testManifestIn(join(source.taskDir, v.suite));
  } else if (v.kind === "candidate" && testAuthoring) {
    // Only codeunits the agent added count as its tests (shipped ones are restored).
    const shipped = new Set([
      ...(await testManifestIn(join(source.refappDir, "Test"))).map((m) =>
        m.codeunit
      ),
      ...(await testManifestIn(join(source.taskDir, "overlay", "Test"))).map((
        m,
      ) => m.codeunit),
    ]);
    own = (await testManifestIn(join(ws, "Test"))).filter((m) =>
      !shipped.has(m.codeunit)
    );
  }
  return {
    apps: usesOracle ? [...BUILD_ORDER, "Oracle"] : BUILD_ORDER,
    usesOracle,
    own,
  };
}

export async function runVariant(
  bc: GateBc,
  task: HarnessTask,
  source: Source,
  v: Variant,
  repeat: number,
  tmpRoot: string,
): Promise<RunResult> {
  await Deno.mkdir(tmpRoot, { recursive: true });
  const ws = await Deno.makeTempDir({ dir: tmpRoot, prefix: `${task.id}-` });
  const t0 = performance.now();
  try {
    const { apps, usesOracle, own } = await stageVariant(task, source, v, ws);
    const result: RunResult = {
      variant: variantName(v),
      repeat,
      usesOracle,
      own,
      builds: [],
      tests: [],
      staged_hash: await stagedHash(ws),
      ms: 0,
    };
    try {
      await bc.prenuke();
      const built: string[] = [];
      const appIds: Record<string, string> = {};
      for (const app of apps) {
        const appDir = join(ws, app);
        await Deno.mkdir(join(appDir, ".alpackages"), { recursive: true });
        for (let i = 0; i < built.length; i++) {
          await Deno.copyFile(
            built[i]!,
            join(appDir, ".alpackages", `dep${i}.app`),
          );
        }
        const project = await loadProject(appDir);
        appIds[app] = (project.appJson as { id: string }).id;
        const c = await bc.compile(project);
        if (!c.ok || !c.artifact) {
          result.builds.push({
            app,
            stage: "compile",
            ok: false,
            codes: c.codes,
            detail: c.detail,
          });
          break;
        }
        try {
          await bc.publish(c.artifact);
        } catch (err) {
          result.builds.push({
            app,
            stage: "publish",
            ok: false,
            codes: [],
            detail: err instanceof Error ? err.message : String(err),
          });
          break;
        }
        result.builds.push({ app, stage: "publish", ok: true, codes: [] });
        built.push(c.artifact);
      }
      const ok = (app: string) =>
        result.builds.some((b) => b.app === app && b.ok);
      const suites: { app: string; codeunit: number }[] = [];
      if (ok("Test")) {
        for (const t of task.pass_to_pass) {
          suites.push({ app: "Test", codeunit: t.codeunit });
        }
        for (const t of own) suites.push({ app: "Test", codeunit: t.codeunit });
      }
      if (usesOracle && task.fail_to_pass && ok("Oracle")) {
        for (const t of task.fail_to_pass.tests) {
          suites.push({ app: "Oracle", codeunit: t.codeunit });
        }
      }
      const seen = new Set<number>();
      for (const s of suites) {
        if (seen.has(s.codeunit)) continue;
        seen.add(s.codeunit);
        const res = await bc.runTests(s.codeunit, appIds[s.app] ?? "");
        if (res.results.length === 0) {
          result.infra = `codeunit ${s.codeunit}: zero results after publish`;
          break;
        }
        for (const c of res.results) {
          result.tests.push({
            codeunit: s.codeunit,
            procedure: c.name,
            passed: c.passed,
            failure: c.passed ? null : classifyTestFailure(c.error ?? ""),
            ...(c.error ? { message: c.error } : {}),
          });
        }
      }
    } catch (err) {
      result.infra = err instanceof Error ? err.message : String(err);
    }
    result.ms = Math.round(performance.now() - t0);
    return result;
  } finally {
    try {
      await Deno.remove(ws, { recursive: true });
    } catch (err) {
      console.warn(
        `[gate] could not remove ${ws}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

export async function runGate(o: {
  bc: GateBc;
  loaded: LoadedTask;
  source: Source;
  container: string;
  outDir: string;
  tmpRoot: string;
  tagTree: string | null;
}): Promise<{ file: string; code: number }> {
  const { task } = o.loaded;
  const naive: string[] = [];
  if (await exists(join(o.source.taskDir, "naive"))) {
    for await (const e of Deno.readDir(join(o.source.taskDir, "naive"))) {
      if (e.isDirectory) naive.push(e.name);
    }
  }
  const plan = gatePlan(task, naive.sort());
  const runs: GateRun[] = [];
  const results: RunResult[] = [];
  let infra = false;
  let escaped: string | null = null;
  try {
    for (const step of plan) {
      const result = await runVariant(
        o.bc,
        task,
        o.source,
        step.variant,
        step.repeat,
        o.tmpRoot,
      );
      const summary = summarize(task, result);
      runs.push({ ...step, summary, staged_hash: result.staged_hash });
      results.push(result);
      console.log(
        `[gate] ${task.id} ${
          runKey(step.variant, step.repeat)
        } ${result.ms} ms ${JSON.stringify(summary)}`,
      );
      if (summary.infra) {
        infra = true;
        break; // an infra fault is never scored; the whole gate is rerun
      }
    }
  } catch (err) {
    // Staging or any other exception: still clean up and write the report.
    infra = true;
    escaped = err instanceof Error ? err.message : String(err);
  }
  let cleanupError: string | null = null;
  try {
    await o.bc.prenuke();
  } catch (err) {
    cleanupError = err instanceof Error ? err.message : String(err);
  }
  try {
    await o.bc.dispose();
  } catch (err) {
    cleanupError = `${cleanupError ?? ""} dispose: ${
      err instanceof Error ? err.message : String(err)
    }`.trim();
  }
  const decision = decideGate(task, plan, runs);
  if (escaped !== null) decision.reasons.push(`infra: ${escaped}`);
  const tagStatus = o.tagTree === null
    ? "pending"
    : o.tagTree === o.source.refappTree
    ? "match"
    : "mismatch";
  if (tagStatus === "mismatch") {
    decision.reasons.push(
      `${task.refapp_version} tree differs from the gated refapp tree`,
    );
  }
  const promoted = decision.reasons.length === 0;
  await Deno.mkdir(o.outDir, { recursive: true });
  const file = join(
    o.outDir,
    `gate-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  await Deno.writeTextFile(
    file,
    JSON.stringify(
      {
        task: task.id,
        source_commit: o.source.commit,
        refapp_tree: o.source.refappTree,
        task_tree: o.source.taskTree,
        refapp_version: task.refapp_version,
        tag_status: tagStatus,
        container: o.container,
        at: new Date().toISOString(),
        plan: plan.map((p) => runKey(p.variant, p.repeat)),
        matrix_complete: decision.matrix_complete,
        promoted,
        reasons: decision.reasons,
        cleanup_error: cleanupError,
        runs: runs.map((r, i) => ({
          key: runKey(r.variant, r.repeat),
          summary: r.summary,
          result: results[i],
        })),
      },
      null,
      2,
    ),
  );
  return { file, code: infra ? 3 : promoted ? 0 : 1 };
}

async function hostCompile(
  loaded: LoadedTask,
  refappDir: string,
  v: Variant,
): Promise<number> {
  await Deno.mkdir(TMP_ROOT, { recursive: true });
  const ws = await Deno.makeTempDir({
    dir: TMP_ROOT,
    prefix: `compile-${loaded.task.id}-`,
  });
  try {
    const src: Source = {
      commit: "worktree",
      root: "",
      refappDir,
      refappTree: "",
      taskDir: loaded.dir,
      taskTree: "",
    };
    const { apps } = await stageVariant(loaded.task, src, v, ws);
    const pkg = join(ws, ".alpackages");
    await Deno.mkdir(pkg);
    for await (const e of Deno.readDir(SYMBOLS)) {
      if (!e.isFile) continue;
      try {
        await Deno.link(join(SYMBOLS, e.name), join(pkg, e.name));
      } catch {
        await Deno.copyFile(join(SYMBOLS, e.name), join(pkg, e.name));
      }
    }
    for (const app of apps) {
      const r = await new Deno.Command("al", {
        args: [
          "compile",
          `/project:${join(ws, app)}`,
          `/out:${join(pkg, `${app}.app`)}`,
          `/packagecachepath:${pkg}`,
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      const text = new TextDecoder().decode(r.stdout) +
        new TextDecoder().decode(r.stderr);
      const errors = text.split(/\r?\n/).filter((l) => /error AL\d+/.test(l));
      if (!r.success || errors.length > 0) {
        console.log(`${colors.red("[FAIL]")} ${app}`);
        for (const l of errors.length > 0 ? errors : [text.trim()]) {
          console.log(`  ${l}`);
        }
        return 1;
      }
      console.log(`${colors.green("[OK]")} ${app}`);
    }
    return 0;
  } finally {
    await Deno.remove(ws, { recursive: true });
  }
}

async function main(): Promise<number> {
  const a = parseArgs(Deno.args, { string: ["rev"], default: { rev: "HEAD" } });
  const [cmd, ...rest] = a._.map(String);
  const repo = (await git(Deno.cwd(), ["rev-parse", "--show-toplevel"])).out
    .trim();
  const refapp = join(repo, "harness-tasks", "refapp");
  const credentials = {
    username: Deno.env.get("CG_GATE_BC_USER") ?? "sshadows",
    password: Deno.env.get("CG_GATE_BC_PASSWORD") ?? "1234",
  };
  const exported = async (taskId: string) => {
    await Deno.mkdir(TMP_ROOT, { recursive: true });
    const out = await Deno.makeTempDir({
      dir: TMP_ROOT,
      prefix: `src-${taskId}-`,
    });
    return await exportSource(repo, a.rev, taskId, out);
  };
  try {
    if (cmd === "check" && rest.length > 0) {
      let failed = 0;
      for (const d of rest) {
        const { problems, warnings } = await checkTask(
          await loadTask(d),
          refapp,
          repo,
        );
        for (const w of warnings) {
          console.log(`${colors.yellow("[WARN]")} ${d}: ${w}`);
        }
        for (const p of problems) {
          console.log(`${colors.red("[FAIL]")} ${d}: ${p}`);
        }
        if (problems.length === 0) console.log(`${colors.green("[OK]")} ${d}`);
        else failed++;
      }
      return failed === 0 ? 0 : 1;
    }
    if (cmd === "compile" && rest.length === 2) {
      return await hostCompile(
        await loadTask(rest[0]!),
        refapp,
        parseVariant(rest[1]!),
      );
    }
    if (cmd === "stage" && rest.length === 2) {
      const src = await exported(rest[0]!);
      const loaded = await loadTask(src.taskDir);
      await stageWorkspace(
        src.refappDir,
        layers(src.taskDir, { kind: "baseline" }, false),
        rest[1]!,
      );
      console.log(
        `${
          colors.green("[OK]")
        } ${loaded.task.id} baseline at ${src.commit} -> ${rest[1]}`,
      );
      return 0;
    }
    if (
      (cmd === "gate" && rest.length === 2) ||
      (cmd === "judge" && rest.length === 3)
    ) {
      const src = await exported(rest[1]!);
      const loaded = await loadTask(src.taskDir);
      const { problems } = await checkTask(loaded, src.refappDir, repo, {
        drift: false,
      });
      if (problems.length > 0) {
        for (const p of problems) console.log(`${colors.red("[FAIL]")} ${p}`);
        return 1;
      }
      const bc = await containerBc(rest[0]!, credentials);
      if (!bc) {
        console.error(
          `${colors.red("[INFRA]")} ${
            rest[0]
          } not healthy or not visible under DOCKER_CONTEXT=${
            Deno.env.get("DOCKER_CONTEXT") ?? "(inherited)"
          }`,
        );
        return 3;
      }
      const outDir = join(EVIDENCE_ROOT, loaded.task.id);
      if (cmd === "gate") {
        const tag = await git(repo, [
          "rev-parse",
          "--verify",
          "-q",
          `${loaded.task.refapp_version}:harness-tasks/refapp`,
        ]);
        const { file, code } = await runGate({
          bc,
          loaded,
          source: src,
          container: rest[0]!,
          outDir,
          tmpRoot: TMP_ROOT,
          tagTree: tag.ok ? tag.out.trim() : null,
        });
        console.log(
          `${
            code === 0 ? colors.green("[OK]") : colors.red("[FAIL]")
          } ${loaded.task.id} gate -> ${file}`,
        );
        return code;
      }
      return await judge(bc, loaded, src, rest[2]!, outDir);
    }
  } catch (err) {
    console.error(
      `${colors.red("[FAIL]")} ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return 1;
  }
  console.error(
    "usage: gate-task.ts check|compile|stage|gate|judge (see header)",
  );
  return 2;
}

/** Pilot scoring (developmental, never a verdict): same staging rules as the M1 verdict workspace, not its validation. */
async function judge(
  bc: GateBc,
  loaded: LoadedTask,
  src: Source,
  wsDir: string,
  outDir: string,
): Promise<number> {
  const { task } = loaded;
  const targets: (string | null)[] = task.kind === "test-authoring"
    ? [null, "m0", ...task.mutants]
    : [null];
  const runs: RunResult[] = [];
  try {
    for (const m of targets) {
      runs.push(
        await runVariant(
          bc,
          task,
          src,
          { kind: "candidate", dir: wsDir, mutant: m },
          1,
          TMP_ROOT,
        ),
      );
    }
  } finally {
    await bc.prenuke().catch(() => {});
    await bc.dispose().catch(() => {});
  }
  const s = runs.map((r) => summarize(task, r));
  const pass = task.kind === "test-authoring"
    ? s[0]!.refapp === "ok" && s[0]!.own !== null && allPass(s[0]!.own) &&
      s.slice(1).every((x) =>
        x.refapp === "ok" && x.own !== null && assertionKill(x.own)
      )
    : s[0]!.refapp === "ok" && allPass(s[0]!.p2p) && s[0]!.f2p !== null &&
      allPass(s[0]!.f2p);
  await Deno.mkdir(outDir, { recursive: true });
  const file = join(
    outDir,
    `pilot-judge-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  await Deno.writeTextFile(
    file,
    JSON.stringify(
      {
        task: task.id,
        source_commit: src.commit,
        workspace: wsDir,
        pass,
        summaries: s,
        runs,
      },
      null,
      2,
    ),
  );
  console.log(
    `${pass ? "[PASS]" : "[FAIL]"} ${task.id} pilot judge -> ${file}`,
  );
  return runs.some((r) => r.infra !== undefined) ? 3 : 0;
}

if (import.meta.main) Deno.exit(await main());
