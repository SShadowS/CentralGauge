// SPIKE (throwaway): harness bench M0
// Usage: deno run --allow-all scripts/spikes/harness/multiapp-timing.ts <container> [runs]
import { join } from "@std/path";
import type { ALProject } from "../../../src/container/types.ts";
import { BcContainerProvider } from "../../../src/container/bc-container-provider.ts";
import {
  resolveSoapTimeoutMs,
  runTestsViaSoap,
} from "../../../src/container/soap-test-client.ts";

const ORDER = [
  "Core",
  "Fleet",
  "Rental",
  "Leasing",
  "Integration",
  "Reporting",
  "Test",
];
const SETS: Record<string, string[]> = {
  "3-app": ["Core", "Fleet", "Rental"],
  "7-app": ORDER,
};
const REFAPP = join(Deno.cwd(), "harness-tasks", "refapp");
const OUT_DIR = "H:\\Temp3\\harness-spike";

async function stageCopy(apps: string[], runDir: string): Promise<void> {
  for (const app of apps) {
    const src = join(REFAPP, app);
    const dst = join(runDir, app);
    await Deno.mkdir(join(dst, "src"), { recursive: true });
    await Deno.copyFile(join(src, "app.json"), join(dst, "app.json"));
    for await (const e of Deno.readDir(join(src, "src"))) {
      await Deno.copyFile(join(src, "src", e.name), join(dst, "src", e.name));
    }
  }
}

async function loadProject(dir: string): Promise<ALProject> {
  const appJson = JSON.parse(await Deno.readTextFile(join(dir, "app.json")));
  const files: string[] = [];
  for await (const e of Deno.readDir(join(dir, "src"))) {
    files.push(join(dir, "src", e.name));
  }
  return { path: dir, appJson, sourceFiles: files, testFiles: [] };
}

async function main() {
  const container = Deno.args[0];
  const runs = Number(Deno.args[1] ?? "3");
  if (!container) {
    throw new Error("usage: multiapp-timing.ts <container> [runs]");
  }
  console.log(
    `[spike] DOCKER_CONTEXT=${Deno.env.get("DOCKER_CONTEXT") ?? "(inherited)"}`,
  );

  const provider = new BcContainerProvider();
  // Bench sets these from config; the spike must too (default is admin/admin).
  const credentials = {
    username: Deno.env.get("CG_SPIKE_BC_USER") ?? "sshadows",
    password: Deno.env.get("CG_SPIKE_BC_PASSWORD") ?? "1234",
  };
  provider.setCredentials(container, credentials);
  if (!(await provider.isHealthy(container))) {
    throw new Error(
      `container ${container} not healthy/visible under current docker context`,
    );
  }
  await provider.ensureTestHarness([container]);
  await Deno.mkdir(OUT_DIR, { recursive: true });
  const rows: unknown[] = [];

  for (const [set, apps] of Object.entries(SETS)) {
    for (let run = 1; run <= runs; run++) {
      await provider.prenukeCentralGaugeApps([container]);
      const runDir = await Deno.makeTempDir({
        prefix: `cg-harness-spike-${set}-`,
      });
      await stageCopy(apps, runDir);
      const built: string[] = [];
      const spans: Record<string, { compileMs: number; publishMs: number }> =
        {};
      let testMs = 0, testsPassed = 0, testsTotal = 0;
      let failures: { name: string; error: string | undefined }[] = [];

      for (const app of apps) {
        const dir = join(runDir, app);
        await Deno.mkdir(join(dir, ".alpackages"), { recursive: true });
        for (const dep of built) {
          await Deno.copyFile(
            dep,
            join(dir, ".alpackages", dep.split(/[/\\]/).pop()!),
          );
        }
        const project = await loadProject(dir);

        const c0 = Date.now();
        const compiled = await provider.compileProject(container, project);
        const compileMs = Date.now() - c0;
        if (!compiled.success || !compiled.artifactPath) {
          throw new Error(
            `${app} failed to compile: ${
              compiled.errors.map((e) => `${e.code} ${e.message}`).join("; ")
            }`,
          );
        }

        // Every app, Test included, goes through publishApp. runTests() would
        // publish Test via prepareCandidateApp, whose cleanup uninstalls every
        // non-Prereq CentralGauge app, i.e. the six apps Test depends on.
        const p0 = Date.now();
        await provider.publishApp(container, compiled.artifactPath);
        spans[app] = { compileMs, publishMs: Date.now() - p0 };
        if (app === "Test") {
          const t0 = Date.now();
          const result = await runTestsViaSoap(
            {
              host: container,
              port: 7047,
              company: "My Company",
              tenant: "default",
              credentials,
              timeoutMs: resolveSoapTimeoutMs(undefined),
            },
            80000,
            (project.appJson as { id: string }).id,
          );
          testMs = Date.now() - t0;
          testsPassed = result.passedTests;
          testsTotal = result.totalTests;
          failures = result.results.filter((r) => !r.passed).map((r) => ({
            name: r.name,
            error: r.error,
          }));
        }
        built.push(compiled.artifactPath);
      }
      const row = {
        set,
        run,
        spans,
        testMs,
        testsPassed,
        testsTotal,
        failures,
      };
      console.log(JSON.stringify(row));
      rows.push(row);
    }
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await Deno.writeTextFile(
    join(OUT_DIR, `multiapp-${stamp}.json`),
    JSON.stringify(rows, null, 2),
  );
  await provider.prenukeCentralGaugeApps([container]);
  await provider.dispose();
}

await main();
