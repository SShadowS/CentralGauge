/** In-memory HarnessBc for unit tests: no container, no pwsh. */

import { basename, join } from "@std/path";
import type {
  ALProject,
  CompilationResult,
  HarnessInstalledApp,
  HarnessSyncResult,
  TestResult,
} from "../../../src/container/types.ts";
import { ContainerError } from "../../../src/errors.ts";
import type { HarnessBc } from "../../../src/harness/bc-lane.ts";

export interface FakeApp {
  id: string;
  name: string;
  version: string;
  folder: string;
  source: string;
}

export type TestScript = (
  codeunit: number,
  deployed: Map<string, FakeApp>,
  container: string,
) => TestResult;

export function result(procs: Record<string, true | string>): TestResult {
  const results = Object.entries(procs).map(([name, v]) =>
    v === true
      ? { name, passed: true, duration: 1 }
      : { name, passed: false, duration: 1, error: v }
  );
  const passed = results.filter((r) => r.passed).length;
  return {
    success: passed === results.length && passed > 0,
    totalTests: results.length,
    passedTests: passed,
    failedTests: results.length - passed,
    duration: 5,
    results,
    output: "",
  };
}

async function sources(dir: string): Promise<string> {
  const parts: string[] = [];
  const walk = async (d: string) => {
    const names: string[] = [];
    for await (const e of Deno.readDir(d)) names.push(e.name);
    for (const n of names.sort()) {
      if (n === ".alpackages") continue;
      const p = join(d, n);
      if ((await Deno.stat(p)).isDirectory) await walk(p);
      else if (n.endsWith(".al")) parts.push(await Deno.readTextFile(p));
    }
  };
  await walk(dir);
  return parts.join("\n");
}

export class FakeBc implements HarnessBc {
  compiles: string[] = [];
  /** .alpackages file names seen at each compile, by folder. */
  compileSeen = new Map<string, string[]>();
  /** Test hook: runs inside compileProject (e.g. to plant an unlocked package). */
  onCompile: ((projectDir: string) => Promise<void>) | null = null;
  concurrentCompiles = 0;
  maxConcurrentCompiles = 0;
  syncs: { container: string; removeIds: string[]; publish: string[] }[] = [];
  tests: { container: string; codeunit: number }[] = [];
  broken = new Set<string>();
  publishFailure: (container: string, appName: string) => string | null = () =>
    null;
  private readonly deployed = new Map<string, Map<string, FakeApp>>();
  /**
   * Tenant data BC keeps after an app is gone (the bench prenuke keeps data):
   * container -> app name -> data version. Publishing a lower version of that
   * app is refused, as on Cronus281 (M1-27); a Sync -Mode Clean purges it.
   */
  keptData = new Map<string, Map<string, string>>();
  /** App names purged by plan.clean, per sync. */
  cleaned: string[][] = [];

  compilerId = "fake-artifact|bccontainerhelper 6.1.14";
  /** Containers whose cleanup (a sync with no publish) fails. */
  cleanupFails = new Set<string>();

  constructor(public script: TestScript = () => result({})) {}

  harnessCompilerIdentity(_container: string): Promise<string> {
    return Promise.resolve(this.compilerId);
  }

  state(container: string): Map<string, FakeApp> {
    let s = this.deployed.get(container);
    if (!s) this.deployed.set(container, s = new Map());
    return s;
  }

  private check(container: string, op: ContainerError["operation"]) {
    if (this.broken.has(container)) {
      throw new ContainerError(
        `fake infra fault on ${container}`,
        container,
        op,
      );
    }
  }

  async compileProject(
    container: string,
    project: ALProject,
  ): Promise<CompilationResult> {
    this.check(container, "compile");
    this.concurrentCompiles++;
    this.maxConcurrentCompiles = Math.max(
      this.maxConcurrentCompiles,
      this.concurrentCompiles,
    );
    try {
      await new Promise((r) => setTimeout(r, 5));
      const folder = basename(project.path);
      this.compiles.push(folder);
      const pk: string[] = [];
      for await (const e of Deno.readDir(join(project.path, ".alpackages"))) {
        pk.push(e.name);
      }
      this.compileSeen.set(folder, pk.sort());
      if (this.onCompile) await this.onCompile(project.path);
      const aj = project.appJson as {
        id: string;
        name: string;
        version: string;
      };
      const source = await sources(project.path);
      // alc: a symbol package the source needs must be in the package cache.
      const missing = [...source.matchAll(/\/\/ needs (.+?\.app)/g)]
        .map((m) => m[1]!).find((f) => !pk.includes(f));
      if (source.includes("COMPILE_ERROR") || missing) {
        return {
          success: false,
          errors: [{
            code: "AL0001",
            message: "fake compile error",
            file: "x.al",
            line: 1,
            column: 1,
            severity: "error",
          }],
          warnings: [],
          output: "",
          duration: 1,
        };
      }
      const out = join(
        project.path,
        "..",
        `.fake-out-${crypto.randomUUID().slice(0, 8)}`,
      );
      await Deno.mkdir(out, { recursive: true });
      const artifactPath = join(
        out,
        `CentralGauge_${aj.name}_${aj.version}.app`,
      );
      const app: FakeApp = {
        id: aj.id.toLowerCase(),
        name: aj.name,
        version: aj.version,
        folder,
        source,
      };
      await Deno.writeTextFile(artifactPath, JSON.stringify(app));
      return {
        success: true,
        errors: [],
        warnings: [],
        output: "",
        duration: 1,
        artifactPath,
      };
    } finally {
      this.concurrentCompiles--;
    }
  }

  listHarnessApps(container: string): Promise<HarnessInstalledApp[]> {
    this.check(container, "publish");
    return Promise.resolve([...this.state(container).values()].map((a) => ({
      id: a.id,
      name: a.name,
      publisher: "CentralGauge",
      version: a.version,
      installed: true,
    })));
  }

  async syncHarnessApps(
    container: string,
    plan: {
      removeIds: string[];
      publish: string[];
      allow: ReadonlyMap<string, string>;
      clean?: { id: string; name: string }[];
    },
  ): Promise<HarnessSyncResult> {
    // As the real provider: a removal id outside the trusted allowlist is refused before anything runs.
    for (const id of plan.removeIds) {
      if (!plan.allow.has(id.toLowerCase())) {
        throw new Error(`app id ${id} is not on the removal allowlist`);
      }
    }
    this.check(container, "publish");
    this.syncs.push({
      container,
      removeIds: [...plan.removeIds],
      publish: [...plan.publish],
    });
    if (plan.publish.length === 0 && this.cleanupFails.has(container)) {
      throw new ContainerError(
        `Harness app sync incomplete: ${plan.removeIds.join(", ")}`,
        container,
        "setup",
      );
    }
    const st = this.state(container);
    for (const id of plan.removeIds) st.delete(id);
    const kept = this.keptData.get(container) ?? new Map<string, string>();
    const cleaned: string[] = [];
    for (const c of plan.clean ?? []) {
      if (!plan.allow.has(c.id.toLowerCase())) {
        throw new Error(`app id ${c.id} is not on the removal allowlist`);
      }
      if (!st.has(c.id.toLowerCase()) && kept.delete(c.name)) {
        cleaned.push(c.name);
      }
    }
    this.cleaned.push(cleaned);
    const published: HarnessSyncResult["published"] = [];
    for (const [index, file] of plan.publish.entries()) {
      const app = JSON.parse(await Deno.readTextFile(file)) as FakeApp;
      published.push({ index, ms: 5 });
      const keptAt = kept.get(app.name);
      const newer = (a: string, b: string) => {
        const x = a.split(".").map(Number), y = b.split(".").map(Number);
        for (let k = 0; k < 4; k++) if (x[k] !== y[k]) return x[k]! > y[k]!;
        return false;
      };
      const fail = keptAt && newer(keptAt, app.version)
        ? `Cannot install the extension ${app.name} by CentralGauge ${app.version} because a newer version ${keptAt} was already installed.`
        : this.publishFailure(container, app.name);
      if (fail !== null) {
        return {
          removed: plan.removeIds,
          warnings: [],
          removeIncomplete: [],
          published,
          failed: { index, message: fail },
          done: false,
          output: fail,
        };
      }
      st.set(app.id, app);
    }
    return {
      removed: plan.removeIds,
      warnings: [],
      removeIncomplete: [],
      published,
      failed: null,
      done: true,
      output: "",
    };
  }

  runHarnessTests(container: string, codeunit: number): Promise<TestResult> {
    this.check(container, "test");
    this.tests.push({ container, codeunit });
    return Promise.resolve(
      this.script(codeunit, this.state(container), container),
    );
  }
}

export function deployedSource(
  deployed: Map<string, FakeApp>,
  name: string,
): string {
  return [...deployed.values()].find((a) => a.name === name)?.source ?? "";
}
