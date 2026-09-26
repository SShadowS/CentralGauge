// SPIKE (throwaway): compile + publish the foreign probe app on the given container.
// Usage: deno run --allow-all scripts/spikes/harness/foreign-probe/publish.ts <container>
import { dirname, fromFileUrl, join } from "@std/path";
import { BcContainerProvider } from "../../../../src/container/bc-container-provider.ts";

const c = Deno.args[0];
if (!c) throw new Error("usage: publish.ts <container>");
const dir = dirname(fromFileUrl(import.meta.url));
const p = new BcContainerProvider();
p.setCredentials(c, { username: "sshadows", password: "1234" });
const appJson = JSON.parse(await Deno.readTextFile(join(dir, "app.json")));
const r = await p.compileProject(c, {
  path: dir,
  appJson,
  sourceFiles: [],
  testFiles: [],
});
if (!r.success || !r.artifactPath) {
  throw new Error(
    `compile failed: ${r.errors.map((e) => e.message).join("; ")}`,
  );
}
await p.publishApp(c, r.artifactPath);
console.log(`published ${r.artifactPath}`);
await p.dispose();
