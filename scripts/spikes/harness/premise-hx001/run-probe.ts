// SPIKE (throwaway): harness bench M4-00 premise probe (HX-001)
// Usage: deno run --allow-all scripts/spikes/harness/premise-hx001/run-probe.ts <container>
// Compiles + publishes HXP Core and HXP Sub, runs test codeunit 50160 over SOAP,
// prints one line per test, then removes both apps (prenukeCentralGaugeApps).
import { dirname, fromFileUrl, join } from "@std/path";
import { BcContainerProvider } from "../../../../src/container/bc-container-provider.ts";
import {
  resolveSoapTimeoutMs,
  runTestsViaSoap,
} from "../../../../src/container/soap-test-client.ts";

const container = Deno.args[0];
if (!container) throw new Error("usage: run-probe.ts <container>");
const HERE = dirname(fromFileUrl(import.meta.url));
const credentials = {
  username: Deno.env.get("CG_SPIKE_BC_USER") ?? "sshadows",
  password: Deno.env.get("CG_SPIKE_BC_PASSWORD") ?? "1234",
};

const provider = new BcContainerProvider();
provider.setCredentials(container, credentials);
if (!(await provider.isHealthy(container))) {
  throw new Error(`container ${container} not healthy/visible`);
}
await provider.ensureTestHarness([container]);
await provider.prenukeCentralGaugeApps([container]);
const runDir = await Deno.makeTempDir({ prefix: "cg-harness-hx001-" });
try {
  const built: string[] = [];
  for (const app of ["Core", "Sub"]) {
    const dir = join(runDir, app);
    await Deno.mkdir(join(dir, "src"), { recursive: true });
    await Deno.mkdir(join(dir, ".alpackages"), { recursive: true });
    await Deno.copyFile(join(HERE, app, "app.json"), join(dir, "app.json"));
    const files: string[] = [];
    for await (const e of Deno.readDir(join(HERE, app, "src"))) {
      await Deno.copyFile(
        join(HERE, app, "src", e.name),
        join(dir, "src", e.name),
      );
      files.push(join(dir, "src", e.name));
    }
    for (const dep of built) {
      await Deno.copyFile(
        dep,
        join(dir, ".alpackages", dep.split(/[/\\]/).pop()!),
      );
    }
    const appJson = JSON.parse(await Deno.readTextFile(join(dir, "app.json")));
    const compiled = await provider.compileProject(container, {
      path: dir,
      appJson,
      sourceFiles: files,
      testFiles: [],
    });
    if (!compiled.success || !compiled.artifactPath) {
      throw new Error(
        `${app} failed to compile: ${
          compiled.errors.map((e) => `${e.code} ${e.message}`).join("; ")
        }`,
      );
    }
    await provider.publishApp(container, compiled.artifactPath);
    built.push(compiled.artifactPath);
  }
  const result = await runTestsViaSoap(
    {
      host: container,
      port: 7047,
      company: "My Company",
      tenant: "default",
      credentials,
      timeoutMs: resolveSoapTimeoutMs(undefined),
    },
    50160,
    "c6a1e000-0000-4000-8000-0000000000a2",
  );
  console.log(`[probe] tests=${result.totalTests}`);
  for (const r of result.results) {
    console.log(
      JSON.stringify({ test: r.name, passed: r.passed, error: r.error }),
    );
  }
} finally {
  await provider.prenukeCentralGaugeApps([container]);
  await provider.dispose();
  await Deno.remove(runDir, { recursive: true });
}
