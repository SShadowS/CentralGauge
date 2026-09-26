// Ops profile for M1-40 (the backend compile path, no sandbox, no credential).
// Usage (container leased, no bench live):
//   DOCKER_CONTEXT=desktop-windows deno run --allow-all scripts/harness/compile-profile.ts <container> <outDir> [refapp-rev]
// Prints one JSON line per measured step, then a summary line.
import { join, resolve } from "@std/path";
import { setupContainers } from "../../cli/commands/bench/container-setup.ts";
import type { BcContainerProvider } from "../../src/container/bc-container-provider.ts";
import { ConfigManager } from "../../src/config/config.ts";
import { allocatedContainer } from "../../src/harness/allocation.ts";
import { buildApps } from "../../src/harness/bc-lane.ts";
import { hashFile } from "../../src/harness/hash.ts";
import { loadSymbolsLock, REFAPP_PATH } from "../../src/harness/identity.ts";
import {
  readAppGraph,
  readAppJsonRaw,
  TAR_BINARY,
} from "../../src/harness/staging.ts";
import { restoreSymbols } from "../../src/harness/symbols.ts";
import { acquireBenchLock } from "../../src/utils/bench-lock.ts";

const [containerArg, outArg, rev = "refapp-v1-rc1"] = Deno.args;
if (!containerArg || !outArg) {
  throw new Error(
    "usage: compile-profile.ts <container> <outDir> [refapp-rev]",
  );
}
const log = (step: string, data: Record<string, unknown>) =>
  console.log(JSON.stringify({ step, at: new Date().toISOString(), ...data }));
const ms = async <T>(f: () => Promise<T>): Promise<[T, number]> => {
  const t0 = performance.now();
  const r = await f();
  return [r, Math.round(performance.now() - t0)];
};
/** BCH prints one "(using altool)" line per manifest it reads (cache miss). */
const altoolReads = (output: string) =>
  (output.match(/\(using altool\)/g) ?? []).length;

const container = await allocatedContainer(containerArg);
const release = acquireBenchLock("results", {
  command: `compile-profile ${container}`,
});
let bc: BcContainerProvider | null = null;
try {
  const out = resolve(outArg);
  await Deno.mkdir(out, { recursive: true });
  const packages = await loadSymbolsLock(".");
  if (!packages) throw new Error("no symbols lock");
  const lock = { store: resolve("results/harness/symbols"), packages };
  // The refapp at rev, raw blobs, as staging exports it.
  const src = join(out, "refapp");
  await Deno.mkdir(src);
  const tar = join(out, "refapp.tar");
  for (
    const [cmd, args, cwd] of [
      ["git", [
        "-c",
        "core.autocrlf=false",
        "archive",
        "--format=tar",
        "-o",
        tar,
        rev,
        REFAPP_PATH,
      ], undefined],
      [TAR_BINARY, ["-xf", "../refapp.tar", "--strip-components=2"], src],
    ] as const
  ) {
    const r = await new Deno.Command(cmd, {
      args: [...args],
      ...(cwd ? { cwd } : {}),
    }).output();
    if (!r.success) {
      throw new Error(`${cmd}: ${new TextDecoder().decode(r.stderr)}`);
    }
  }
  const apps = await readAppGraph(src);
  const cfg = await ConfigManager.loadConfig();
  const [ready, setup_ms] = await ms(() =>
    setupContainers([container], "bccontainer", cfg.container ?? {})
  );
  bc = ready.containerProvider as BcContainerProvider;
  log("setup", { setup_ms });

  // Step detail on one app (Core): restore, compile, post-compile hashing.
  const core = apps.find((a) => a.folder === "Core")!;
  const dir = join(out, "core-step");
  const pk = join(dir, ".alpackages");
  const [, copy_ms] = await ms(async () => {
    await Deno.mkdir(dir, { recursive: true });
    for await (const e of Deno.readDir(join(src, core.folder))) {
      if (e.isFile) {
        await Deno.copyFile(join(src, core.folder, e.name), join(dir, e.name));
      }
    }
    await Deno.mkdir(join(dir, "src"), { recursive: true });
    for await (const e of Deno.readDir(join(src, core.folder, "src"))) {
      await Deno.copyFile(
        join(src, core.folder, "src", e.name),
        join(dir, "src", e.name),
      );
    }
  });
  const [, restore_ms] = await ms(() =>
    restoreSymbols(lock.store, lock.packages, pk)
  );
  const appJson = await readAppJsonRaw(join(dir, "app.json")) as Record<
    string,
    unknown
  >;
  for (const pass of ["cold", "warm"]) {
    const [r, compile_ms] = await ms(() =>
      bc!.compileProject(container, {
        path: dir,
        appJson,
        sourceFiles: [],
        testFiles: [],
      })
    );
    log(`core-compile-${pass}`, {
      compile_ms,
      success: r.success,
      altool_reads: altoolReads(r.output),
      cache_file: await Deno.stat(join(pk, "cache_AppInfo.json")).then(
        () => true,
        () => false,
      ),
    });
  }
  const [, posthash_ms] = await ms(async () => {
    for await (const e of Deno.readDir(pk)) {
      if (e.name.toLowerCase().endsWith(".app")) {
        await hashFile(pk, join(pk, e.name));
      }
    }
  });
  log("core-steps", { copy_ms, restore_ms, posthash_ms });

  // The backend path as it runs today: all apps, twice (a fresh outDir each).
  for (const pass of ["first", "second"]) {
    const [built, total_ms] = await ms(() =>
      buildApps(bc!, container, {
        srcDir: src,
        apps,
        versions: new Map(),
        outDir: join(out, `build-${pass}`),
        lock,
      })
    );
    log(`buildApps-${pass}`, {
      total_ms,
      apps: built.map((b) => ({
        app: b.folder,
        ok: b.ok,
        compile_ms: Math.round(b.compile_ms),
      })),
    });
  }
} finally {
  await bc?.dispose();
  await release();
}
