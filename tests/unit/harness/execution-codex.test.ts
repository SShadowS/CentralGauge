/**
 * H-02: a pi arm on the ChatGPT subscription (pi's openai-codex provider,
 * route openai-codex:oauth). Custody of the OAuth credential file, its
 * inner values as secrets, the host-side expiry refusal, and record mode
 * for the route (fake Docker and a fake egress runtime; nothing real runs).
 */
import { assert, assertEquals, assertRejects } from "@std/assert";
import { walk } from "@std/fs";
import { join } from "@std/path";
import { ConfigurationError, ContainerError } from "../../../src/errors.ts";
import { runCell } from "../../../src/harness/execution.ts";
import {
  loadRecordedHosts,
  RECORDED_HOSTS_PATH,
  recordedHostsJson,
} from "../../../src/harness/egress.ts";
import { imageTag } from "../../../src/harness/images.ts";
import { codexAuthText, FAKE_CODEX } from "./codex-fixture.ts";
import { write } from "./refapp-fixture.ts";
import { cellFor, enforce, makeEnv, type TestEnv } from "./runtime-fixture.ts";
import type { RunBehavior, RunCall } from "./fake-docker.ts";

const ARM = "pi-luna-codex";
const PI_IMAGE_ID = `sha256:${"d".repeat(64)}`;
const IN_3H = () => Date.now() + 3 * 3600_000;
const U16 = (s: string) =>
  String.fromCharCode(
    ...new Uint8Array(
      new Uint16Array([...s].map((c) => c.charCodeAt(0))).buffer,
    ),
  );
const WHOLE = (expires: number) => codexAuthText(expires);

async function allBytes(root: string): Promise<string> {
  let out = "";
  for await (const e of walk(root, { includeDirs: false })) {
    out += new TextDecoder("latin1").decode(
      await Deno.readFile(e.path).catch(() => new Uint8Array()),
    );
  }
  return out;
}
const leaks = (text: string, secret: string) =>
  text.includes(secret) || text.includes(U16(secret));

/** A completed pi 0.87.1 JSON stream on the codex provider, the guard armed at the run's limit. */
async function piLines(call: RunCall, extra: string[] = []): Promise<string[]> {
  const cfg = JSON.parse(
    await Deno.readTextFile(
      join(call.mounts.get("C:\\config")!.src, "settings.json"),
    ),
  );
  const limit = cfg.limits.max_budget_usd;
  return [
    {
      type: "cg_entry",
      pi_version: "0.87.1",
      max_budget_usd: limit,
      ready: true,
    },
    { type: "session", id: "s-codex" },
    {
      type: "entry_appended",
      entry: {
        type: "custom",
        id: "e1",
        parentId: null,
        customType: "cg-budget",
        data: { event: "armed", limit_usd: limit },
      },
    },
    { type: "message_start", message: { role: "assistant" } },
    ...extra.map((text) => ({ type: "message_update", text })),
    {
      type: "message_end",
      message: {
        role: "assistant",
        provider: "openai-codex",
        model: "gpt-6-luna",
        stopReason: "stop",
        usage: {
          input: 10,
          output: 5,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 15,
          cost: { total: 0.0000035 },
        },
      },
    },
    { type: "agent_end", messages: [], willRetry: false },
    { type: "agent_settled" },
  ].map((l) => JSON.stringify(l));
}

async function codexEnv(expires = IN_3H()): Promise<TestEnv> {
  const t = await makeEnv();
  await write(
    t.harnessRoot,
    `configs/${ARM}.yml`,
    `id: ${ARM}
harness: pi
harness_version: "0.87.1"
models: { main: openai-codex/gpt-6-luna }
settings: {}
limits: { timeout_min: 30, max_budget_usd: 5 }
`,
  );
  t.docker.addImage(imageTag("pi", "0.87.1"), PI_IMAGE_ID, {
    "centralgauge.harness": "pi",
    "centralgauge.harness.version": "0.87.1",
    "centralgauge.harness.base_digest": `sha256:${"b".repeat(64)}`,
  });
  await Deno.writeTextFile(
    join(t.env.secretAccounts[0]!.dir, "openai-codex-auth"),
    WHOLE(expires) + "\n",
  );
  const behavior: RunBehavior = async (call, io) => {
    for (const l of await piLines(call)) await io.stdout(l);
    return 0;
  };
  t.docker.behavior = behavior;
  return t;
}

Deno.test("codex arm: only its own credential file is released, never in argv; every inner value is redacted from every published surface", async () => {
  const t = await codexEnv();
  let released: string[] = [];
  let file = "";
  let args = "";
  t.docker.behavior = async (call, io) => {
    const secrets = call.mounts.get("C:\\cg-secrets")!.src;
    released = [...Deno.readDirSync(secrets)].map((e) => e.name).sort();
    file = await Deno.readTextFile(join(secrets, "openai-codex-auth"));
    args = call.args.join(" ");
    const ws = call.mounts.get("C:\\workspace")!.src;
    await Deno.writeTextFile(
      join(ws, "leak.txt"),
      `${FAKE_CODEX.access}|${FAKE_CODEX.refresh}|${FAKE_CODEX.accountId}`,
    );
    await Deno.writeFile(
      join(ws, "leak16.txt"),
      new Uint8Array(
        new Uint16Array([...FAKE_CODEX.refresh].map((c) => c.charCodeAt(0)))
          .buffer,
      ),
    );
    const lines = await piLines(call, [
      `Bearer ${FAKE_CODEX.access}`,
      `chatgpt-account-id: ${FAKE_CODEX.accountId}`,
      `refresh ${FAKE_CODEX.refresh}`,
    ]);
    for (const l of lines) await io.stdout(l);
    return 0;
  };
  const book = t.env.pricing;
  const armSlugs: (readonly string[] | undefined)[] = [];
  t.env.pricing = (at, slugs) => {
    armSlugs.push(slugs);
    return book(at, slugs);
  };
  const r = await runCell(t.env, await cellFor(t, ARM));
  const e = r.executions[0]!;
  assertEquals(e.termination, "completed");
  assertEquals(e.manifest.provider_routes, { main: "openai-codex:oauth" });
  // The book is the arm's: gpt-6-luna is priced as openai-codex/gpt-6-luna.
  assertEquals(armSlugs, [["openai-codex/gpt-6-luna"]]);
  // The OpenRouter key is never released to this arm (nor this file to an OpenRouter arm).
  assertEquals(released, ["backend-token", "openai-codex-auth", "ready"]);
  assertEquals(file.trim(), WHOLE(JSON.parse(file)["openai-codex"].expires));
  for (const v of [...Object.values(FAKE_CODEX), file.trim()]) {
    assert(!args.includes(v), "argv");
  }
  const published = await allBytes(t.env.resultsRoot);
  for (const v of Object.values(FAKE_CODEX)) {
    assert(!leaks(published, v), `published: ${v.slice(0, 6)}`);
  }
  const rawLog = await Deno.readTextFile(
    join(t.env.resultsRoot, e.raw_log_path!),
  );
  assertEquals(rawLog.split("[REDACTED:openai-codex-auth]").length - 1, 3);
});

Deno.test("codex arm: a token that does not outlive the timeout plus 15 minutes is refused before anything is reserved or run", async () => {
  const t = await codexEnv(Date.now() + 20 * 60_000);
  const e = (await runCell(t.env, await cellFor(t, ARM))).executions[0]!;
  assertEquals(e.termination, "setup_failed");
  assertEquals(t.docker.runs, []);
  assert(
    !await Deno.stat(t.env.credentialLedger!).then(() => true, () => false),
    "no slot reserved",
  );
  assert(
    (await allBytes(t.env.resultsRoot)).includes(
      "pi auth print-bearer-token --provider openai-codex",
    ),
  );
});

Deno.test("codex arm: a malformed credential file is refused before the run; the refusal holds no value", async () => {
  const t = await codexEnv();
  await Deno.writeTextFile(
    join(t.env.secretAccounts[0]!.dir, "openai-codex-auth"),
    codexAuthText(IN_3H(), { accountId: "short" }),
  );
  const e = (await runCell(t.env, await cellFor(t, ARM))).executions[0]!;
  assertEquals(e.termination, "setup_failed");
  assertEquals(t.docker.runs, []);
  const published = await allBytes(t.env.resultsRoot);
  assert(published.includes("secret openai-codex-auth: accountId"));
  for (const v of Object.values(FAKE_CODEX)) assert(!leaks(published, v));
});

Deno.test("codex arm: an enforced run is refused until the route's hosts are recorded", async () => {
  const t = await codexEnv();
  enforce(t); // authorized; the recording holds only the first-party OAuth route
  await assertRejects(
    async () => runCell(t.env, await cellFor(t, ARM)),
    ContainerError,
    "openai-codex:oauth",
  );
  assertEquals(t.docker.runs, []);
});

Deno.test("record mode (H-02): a supervised qualified pi codex cell records its hosts beside the OAuth recording", async () => {
  const t = await codexEnv();
  const eg = enforce(t);
  t.env.egressEnforced = false; // qualified
  t.env.recordOAuthHosts = true;
  const path = join(t.env.repoRoot, ...RECORDED_HOSTS_PATH.split("/"));
  await Deno.mkdir(join(path, ".."), { recursive: true });
  await Deno.writeTextFile(
    path,
    recordedHostsJson(["api.anthropic.com"], "record mode execution cc-1"),
  );
  const inner = t.docker.behavior;
  t.docker.behavior = async (call, io) => {
    for (const target of ["chatgpt.example.test:443", "ab.example.test:443"]) {
      eg.log!({
        at: new Date().toISOString(),
        decision: "allow",
        target,
        reason: "allowed",
      });
    }
    return await inner(call, io);
  };
  const r = await runCell(t.env, await cellFor(t, ARM));
  const e = r.executions[0]!;
  assertEquals(e.termination, "completed");
  // Record mode: nothing fixed for this route, the proxy allows any DNS name.
  assertEquals([eg.proxyRecord, eg.proxyHosts], [true, []]);
  assertEquals(await loadRecordedHosts(t.env.repoRoot), {
    "anthropic:first-party-oauth": ["api.anthropic.com"],
    "openai-codex:oauth": ["ab.example.test", "chatgpt.example.test"],
  });
  assertEquals(
    JSON.parse(await Deno.readTextFile(path)).source,
    `record mode execution cc-1; record mode execution ${e.id}`,
  );
  const facts = JSON.parse(
    await Deno.readTextFile(
      join(t.env.resultsRoot, "runs", e.id, "record-mode.json"),
    ),
  );
  assertEquals([facts.harness, facts.credential_bearing], ["pi", true]);
});

Deno.test("record mode (H-02): refused when the route is already recorded or the recording is invalid", async () => {
  for (
    const [what, text, arm] of [
      [
        "already recorded",
        JSON.stringify({
          v: 1,
          source: "s",
          routes: { "openai-codex:oauth": ["x.example.test"] },
        }),
        ARM,
      ],
      ["invalid", "{}", ARM],
    ] as const
  ) {
    const t = await codexEnv();
    const eg = enforce(t);
    t.env.egressEnforced = false;
    eg.recordedHosts = {};
    t.env.recordOAuthHosts = true;
    const path = join(t.env.repoRoot, ...RECORDED_HOSTS_PATH.split("/"));
    await Deno.mkdir(join(path, ".."), { recursive: true });
    await Deno.writeTextFile(path, text);
    await assertRejects(
      async () => runCell(t.env, await cellFor(t, arm)),
      ConfigurationError,
      "record mode refused",
      what,
    );
    assertEquals(t.docker.runs, [], what);
    assertEquals(await Deno.readTextFile(path), text, what);
  }
});
