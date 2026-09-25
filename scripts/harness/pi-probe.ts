// Usage: deno run --allow-all scripts/harness/pi-probe.ts <image-id> <out-dir> [--proxy-log <host-ip>] [--no-ready]
//        [--skills <dir>] [--instructions <dir>]
// Runs the pi image once with a FAKE OpenRouter key (no credential, no spend) and prints the parse.
// --proxy-log <ip> points HTTPS_PROXY at a listener on <ip>:3999 that logs each request line and
// answers 403 (shows whether pi honors the proxy and which hosts it contacts). --no-ready withholds
// C:\cg-secrets\ready (CG_READY_TIMEOUT_S=10): pi must never start.
import { parseArgs } from "@std/cli/parse-args";
import { join } from "@std/path";
import { parsePiStream, PI_SETTINGS } from "../../src/harness/adapters/pi.ts";
import { ResolvedManifestSchema } from "../../src/harness/manifest.ts";
import { loadPricingBook } from "../../src/harness/pricing.ts";
import { realDocker, runSandbox } from "../../src/harness/sandbox.ts";

const a = parseArgs(Deno.args, {
  boolean: ["no-ready"],
  string: ["proxy-log", "skills", "instructions"],
});
const [imageId, outArg] = a._.map(String);
if (!imageId || !outArg) {
  throw new Error("usage: pi-probe.ts <image-id> <out-dir>");
}
await Deno.mkdir(outArg, { recursive: true });
const out = await Deno.realPath(outArg);
const d = (n: string) => join(out, n);
for (const n of ["workspace", "task", "config", "secrets"]) {
  await Deno.mkdir(d(n), { recursive: true });
}
const copyDir = async (src: string, dst: string) => {
  await Deno.mkdir(dst, { recursive: true });
  for await (const e of Deno.readDir(src)) {
    if (e.isDirectory) await copyDir(join(src, e.name), join(dst, e.name));
    else if (e.isFile) {
      await Deno.copyFile(join(src, e.name), join(dst, e.name));
    }
  }
};
const FAKE = "sk-or-v1-cgprobe" + "0".repeat(48);
await Deno.writeTextFile(join(d("secrets"), "openrouter-api-key"), FAKE);
if (!a["no-ready"]) await Deno.writeTextFile(join(d("secrets"), "ready"), "");
await Deno.writeTextFile(
  join(d("task"), "prompt.md"),
  "Reply with the single word ok.\n",
);
if (a.skills) await copyDir(a.skills, join(d("config"), "bundle", "skills"));
if (a.instructions) {
  await copyDir(a.instructions, join(d("config"), "bundle", "instructions"));
}
await Deno.writeTextFile(
  join(d("config"), "settings.json"),
  JSON.stringify({
    harness: "pi",
    harness_version: "0.87.1",
    models: { main: "openrouter/google/gemini-3.8-flash" },
    settings: {
      provider: "openrouter",
      api_models: { main: "google/gemini-3.8-flash" },
      pi_settings: PI_SETTINGS,
    },
    limits: { timeout_min: 5, max_budget_usd: 0.05 },
    toolchain: [],
  }),
);
const env: Record<string, string> = a["no-ready"]
  ? { CG_READY_TIMEOUT_S: "10" }
  : {};
let listener: Deno.Listener | undefined;
if (a["proxy-log"]) {
  listener = Deno.listen({ hostname: a["proxy-log"], port: 3999 });
  env["HTTPS_PROXY"] = env["HTTP_PROXY"] = `http://${a["proxy-log"]}:3999`;
  (async () => {
    for await (const c of listener!) {
      const buf = new Uint8Array(1024);
      const n = (await c.read(buf)) ?? 0;
      await Deno.writeTextFile(
        d("proxy.log"),
        new TextDecoder().decode(buf.subarray(0, n)).split("\r\n")[0] + "\n",
        { append: true },
      );
      await c.write(
        new TextEncoder().encode(
          "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n",
        ),
      );
      c.close();
    }
  })().catch(() => {});
}
const id = crypto.randomUUID();
const res = await runSandbox(realDocker(), {
  name: `cg-harness-probe-${id}`,
  owner: Deno.hostname(),
  executionId: id,
  imageId,
  workspace: d("workspace"),
  taskDir: d("task"),
  configDir: d("config"),
  secretsDir: d("secrets"),
  extraMounts: [],
  env,
  timeoutMs: 180_000,
  killGraceMs: 30_000,
  opTimeoutMs: 60_000,
  maxCaptureBytes: 16 * 1024 * 1024,
  rawLog: d("raw.jsonl"),
  stderrLog: d("stderr.txt"),
}, [FAKE]);
listener?.close();
const m = ResolvedManifestSchema.parse({
  v: 1,
  rules: "probe",
  config_id: "pi-probe",
  harness: "pi",
  harness_version: "0.87.1",
  models: { main: "openrouter/google/gemini-3.8-flash" },
  settings: { requested: {}, native: {} },
  limits: { timeout_min: 5, max_budget_usd: 0.05 },
  instructions: null,
  skills: null,
  agents: null,
  hooks: null,
  plugins: [],
  mcp: [],
  lsp: [],
  toolchain: [],
  image: { digest: imageId, base_digest: "probe" },
  backend_version: "probe",
  provider_routes: { main: "openrouter:api-key" },
});
const r = parsePiStream(await Deno.readTextFile(d("raw.jsonl")), {
  rawLog: d("raw.jsonl"),
  exitCode: res.exitCode,
  manifest: m,
  pricing: await loadPricingBook("site/catalog", new Date()),
});
console.log(
  JSON.stringify(
    {
      sandbox: res,
      termination: r.termination,
      didWork: r.didWork,
      observed: r.observed,
      telemetry: r.telemetry,
    },
    null,
    2,
  ),
);
