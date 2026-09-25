// Real-runtime proof for the pi budget guard (M3-02): the real pi 0.87.1
// against a scripted local provider. Runs only when CG_PI_CLI names pi
// 0.87.1's dist/bundle/cli.js (a reported skip is not an acceptance).
// Isolation: a fake key, the provider baseUrl on loopback, --offline and
// PI_OFFLINE, an isolated agent directory and home, an env built from an
// explicit allowlist (no inherited provider key), and every non-loopback
// HTTP(S) request routed to a sink proxy that must see no connection.
import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  parsePiStream,
  PI_SETTINGS,
} from "../../../src/harness/adapters/pi.ts";
import { loadPricingBook } from "../../../src/harness/pricing.ts";
import { manifest } from "../../unit/harness/fixtures.ts";
import { type FakeTurn, startFakeOpenRouter } from "./fake-openrouter.ts";

const CLI = Deno.env.get("CG_PI_CLI");
const KEY = "sk-or-v1-cgfake" + "0".repeat(48);
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const ALLOWED_ENV = new Set([
  "PATH",
  "SystemRoot",
  "windir",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "HOME",
  "APPDATA",
  "LOCALAPPDATA",
  "PI_CODING_AGENT_DIR",
  "PI_OFFLINE",
  "PI_SKIP_VERSION_CHECK",
  "PI_TELEMETRY",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "CG_PI_KEY_FILE",
  "CG_MAX_BUDGET_USD",
]);
const PROVIDER_ENV =
  /^(OPENROUTER|ANTHROPIC|OPENAI|GEMINI|GOOGLE|AZURE|AWS|MISTRAL|GROQ|XAI|DEEPSEEK|CLAUDE)/i;

/** A proxy that answers nothing: any request pi sends off loopback lands here and is counted. */
function startSink() {
  const l = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  let connections = 0;
  (async () => {
    for await (const c of l) {
      connections++;
      c.close();
    }
  })().catch(() => {});
  return {
    url: `http://127.0.0.1:${(l.addr as Deno.NetAddr).port}`,
    count: () => connections,
    close: () => l.close(),
  };
}

async function runPi(
  script: FakeTurn[],
  o: { limit: number; guard?: boolean; model?: string },
) {
  assert(CLI, "CG_PI_CLI");
  assert(KEY.startsWith("sk-or-v1-cgfake"), "only the fake key");
  const fake = startFakeOpenRouter(script);
  const sink = startSink();
  assert(LOOPBACK.has(new URL(fake.baseUrl).hostname), "provider on loopback");
  const dir = await Deno.realPath(await Deno.makeTempDir());
  const agent = join(dir, "agent");
  const ws = join(dir, "ws");
  const home = join(dir, "home");
  for (const d of [agent, ws, home]) await Deno.mkdir(d);
  await Deno.writeTextFile(
    join(agent, "settings.json"),
    JSON.stringify({
      ...PI_SETTINGS,
      retry: { ...PI_SETTINGS.retry, baseDelayMs: 10 },
    }),
  );
  // A zero-cost model entry (o.model) replaces openrouter's built-in list for that run only.
  const zero = {
    id: o.model,
    name: "zero cost",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  };
  const models = {
    providers: {
      openrouter: {
        baseUrl: fake.baseUrl,
        ...(o.model ? { api: "openai-completions", models: [zero] } : {}),
      },
    },
  };
  await Deno.writeTextFile(join(agent, "models.json"), JSON.stringify(models));
  await Deno.writeTextFile(join(dir, "key"), KEY);
  const args = [
    CLI,
    "--mode",
    "json",
    "--no-session",
    "--offline",
    "--no-approve",
    "--no-extensions",
    ...(o.guard === false
      ? []
      : ["-e", join(Deno.cwd(), "harness", "images", "pi", "cg-budget.ts")]),
    "--no-skills",
    "--provider",
    "openrouter",
    "--model",
    o.model ?? "google/gemini-3.8-flash",
  ];
  const env: Record<string, string> = {
    PATH: Deno.env.get("PATH") ?? "",
    SystemRoot: Deno.env.get("SystemRoot") ?? "",
    windir: Deno.env.get("windir") ?? "",
    TEMP: dir,
    TMP: dir,
    USERPROFILE: home,
    HOME: home,
    APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
    PI_CODING_AGENT_DIR: agent,
    PI_OFFLINE: "1",
    PI_SKIP_VERSION_CHECK: "1",
    PI_TELEMETRY: "0",
    HTTP_PROXY: sink.url,
    HTTPS_PROXY: sink.url,
    NO_PROXY: "127.0.0.1,localhost",
    CG_PI_KEY_FILE: join(dir, "key"),
    CG_MAX_BUDGET_USD: String(o.limit),
  };
  for (const k of Object.keys(env)) {
    assert(ALLOWED_ENV.has(k), `env ${k} is not on the allowlist`);
    assert(!PROVIDER_ENV.test(k), `provider env ${k} reaches pi`);
  }
  assert(!Object.values(env).includes(KEY), "the key never travels by env");
  assert(!args.some((a) => a.includes(KEY)), "the key never travels by argv");
  const child = new Deno.Command("node", {
    args,
    cwd: ws,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    clearEnv: true,
    env,
  }).spawn();
  const w = child.stdin.getWriter();
  await w.write(
    new TextEncoder().encode("Run the command echo hi, then reply ok."),
  );
  await w.close();
  const out = await child.output();
  await fake.close();
  sink.close();
  assertEquals(sink.count(), 0, "no request left loopback");
  const stdout = new TextDecoder().decode(out.stdout);
  const stderr = new TextDecoder().decode(out.stderr);
  assert(!stderr.includes(KEY), "the key never reaches stderr");
  assert(!stdout.includes(KEY), "the key never reaches stdout");
  for (const q of fake.requests) {
    assertEquals(
      `${q.method} ${q.path}`,
      "POST /v1/chat/completions",
      "only chat completions reach the provider",
    );
  }
  const text =
    `{"type":"cg_entry","pi_version":"0.87.1","max_budget_usd":${o.limit},"ready":true}\n` +
    stdout;
  const r = parsePiStream(text, {
    rawLog: "runtime",
    exitCode: out.code,
    pricing: await loadPricingBook("site/catalog", new Date()),
    manifest: manifest("pi", {
      harness: "pi",
      harness_version: "0.87.1",
      models: { main: "openrouter/google/gemini-3.8-flash" },
      provider_routes: { main: "openrouter:api-key" },
      limits: { timeout_min: 5, max_budget_usd: o.limit },
    }),
  });
  await Deno.remove(dir, { recursive: true });
  return { r, text, stderr, requests: fake.requests, code: out.code };
}

const TEXT: FakeTurn = {
  kind: "text",
  text: "ok",
  usage: { prompt_tokens: 1000, completion_tokens: 10 },
};
const TOOL: FakeTurn = {
  kind: "tool",
  name: "bash",
  args: { command: "echo hi" },
  usage: { prompt_tokens: 1000, completion_tokens: 10 },
};
const opts = { ignore: !CLI, sanitizeResources: false, sanitizeOps: false };
const armedCount = (t: string) =>
  t.split("\n").filter((l) =>
    l.includes('"customType":"cg-budget"') && l.includes('"event":"armed"')
  ).length;

Deno.test({
  name:
    "pi runtime: one armed record with the effective limit, the key only in the Authorization header",
  ...opts,
  async fn() {
    const { r, text, requests } = await runPi([TOOL, TEXT], { limit: 5 });
    assertEquals(armedCount(text), 1);
    assertEquals(r.termination, "completed");
    assert(
      requests.length >= 2 && requests.every((q) => q.auth === `Bearer ${KEY}`),
    );
  },
});

Deno.test({
  name: "pi runtime: a trip stops further provider requests",
  ...opts,
  async fn() {
    const { r, requests } = await runPi([TOOL, TOOL, TEXT], {
      limit: 0.000001,
    });
    assertEquals(r.termination, "budget_exhausted");
    assertEquals(
      (r.telemetry.raw_usage as { budget: { reason: string } }).budget.reason,
      "limit",
    );
    assertEquals(requests.length, 1, "no request after the trip");
  },
});

Deno.test({
  name: "pi runtime: guard missing: pi makes no provider request",
  ...opts,
  async fn() {
    const { r, requests } = await runPi([TEXT], { limit: 5, guard: false });
    assertEquals(requests.length, 0, "no key without the guard, so no request");
    assert(r.termination !== "completed");
    assertEquals(r.didWork, false);
  },
});

Deno.test({
  name:
    "pi runtime: one armed record across retries; retry then success completes",
  ...opts,
  async fn() {
    const { r, text } = await runPi([
      { kind: "status", status: 500, body: "boom" },
      TEXT,
    ], { limit: 5 });
    assertEquals(armedCount(text), 1);
    assertEquals(r.termination, "completed");
    assert(r.trace.some((e) => e.type === "retry"));
  },
});

Deno.test({
  name:
    "pi runtime: scripted 500s end in harness_crash, scripted 429s in usage_limited",
  ...opts,
  async fn() {
    assertEquals(
      (await runPi([{ kind: "status", status: 500, body: "boom" }], {
        limit: 5,
      })).r.termination,
      "harness_crash",
    );
    assertEquals(
      (await runPi([{ kind: "status", status: 429, body: "rate limit" }], {
        limit: 5,
      })).r.termination,
      "usage_limited",
    );
  },
});

Deno.test({
  name: "pi runtime: unpriced billable usage fails closed",
  ...opts,
  async fn() {
    const { r, requests } = await runPi([TEXT, TEXT], {
      limit: 5,
      model: "cg/zero-cost",
    });
    assertEquals(r.termination, "budget_exhausted");
    assertEquals(
      (r.telemetry.raw_usage as { budget: { reason: string } }).budget.reason,
      "unpriced",
    );
    assertEquals(requests.length, 1);
  },
});
