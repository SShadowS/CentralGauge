import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { ConfigurationError } from "../../../src/errors.ts";
import { claudeCodeAdapter } from "../../../src/harness/adapters/claude-code.ts";
import {
  HarnessConfigSchema,
  loadConfig,
} from "../../../src/harness/config.ts";
import { hashJson } from "../../../src/harness/hash.ts";
import {
  AL_LSP_DEF,
  AL_LSP_RESOLVED,
  AL_LSP_SHIPPED,
  AL_TOOLS_SHIPPED,
  CLAUDE_CODE_RESOLVED,
  claudeCodeArgs,
  FROZEN_CLAUDE_CODE,
  hasBaseLayers,
  type ImageFacts,
  imageFacts,
  imageTag,
  type LspFact,
  lspLabel,
  lspReleaseArgs,
  mcpDefinitions,
  mcpLabel,
  resolveClaudeCode,
  resolveLspRelease,
  runtimeFacts,
  serverDefinitions,
} from "../../../src/harness/images.ts";
import { readCatalog } from "../../../src/ingest/catalog/read.ts";
import {
  manifestHash,
  resolveManifest,
} from "../../../src/harness/manifest.ts";
import {
  imageReadCreateArgs,
  OWNER_LABEL,
  SANDBOX_PREFIX,
} from "../../../src/harness/sandbox.ts";
import {
  CC_MAIN_URL,
  CC_REL,
  ccFetch,
  ccLabels,
  ccMainDoc,
  ccResolvedJson,
  ccWinDoc,
  ccWinUrl,
  FakeDocker,
  fakeFetch,
  LSP_REL,
  lspLatestBody,
  lspReleaseLabels,
  lspResolvedJson,
} from "./fake-docker.ts";

const ID = `sha256:${"a".repeat(64)}`;
const BASE = `sha256:${"b".repeat(64)}`;
const LABELS = {
  "centralgauge.harness": "claude-code",
  "centralgauge.harness.version": "2.1.282",
  "centralgauge.harness.base_digest": BASE,
};
const catalog = {
  models: [{
    slug: "anthropic/claude-sonnet-5",
    api_model_id: "claude-sonnet-5",
    family: "claude",
    display_name: "S5",
  }],
  pricing: [],
  families: [],
};

Deno.test("imageFacts: immutable id and labelled base digest; wrong labels refused", async () => {
  const d = new FakeDocker();
  await assertRejects(
    () => imageFacts(d, imageTag("claude-code", "2.1.282"), "HOST1"),
    ConfigurationError,
    "images build",
  );
  d.addImage("centralgauge/harness-claude-code:2.1.282", ID, LABELS);
  assertEquals(
    (await imageFacts(d, "centralgauge/harness-claude-code:2.1.282", "HOST1"))
      .digest,
    ID,
  );
  d.addImage("centralgauge/harness-claude-code:9", `sha256:${"9".repeat(64)}`, {
    "centralgauge.harness": "claude-code",
  });
  await assertRejects(
    () => imageFacts(d, "centralgauge/harness-claude-code:9", "HOST1"),
    ConfigurationError,
    "label",
  );
  d.addImage("centralgauge/harness-claude-code:8", `sha256:${"8".repeat(64)}`, {
    ...LABELS,
    "centralgauge.harness.base_digest": "sha256:img",
  });
  await assertRejects(
    () => imageFacts(d, "centralgauge/harness-claude-code:8", "HOST1"),
    ConfigurationError,
    "base_digest",
  );
});

Deno.test("hasBaseLayers: the built image's layers start with the base's layers", async () => {
  const d = new FakeDocker();
  d.addImage("centralgauge/harness-base:1", BASE, {}, ["l1", "l2"]);
  d.addImage("good", ID, LABELS, ["l1", "l2", "l3"]);
  d.addImage("bad", `sha256:${"c".repeat(64)}`, LABELS, ["x1", "l2", "l3"]);
  assert(await hasBaseLayers(d, "good", "centralgauge/harness-base:1"));
  assert(!await hasBaseLayers(d, "bad", "centralgauge/harness-base:1"));
});

Deno.test("runtimeFacts: MCP facts come from the image label; LSP and missing MCP refused", async () => {
  const cfg = HarnessConfigSchema.parse({
    id: "cc",
    harness: "claude-code",
    harness_version: "2.1.282",
    models: { main: "anthropic/claude-sonnet-5" },
    settings: {},
    limits: { timeout_min: 30, max_budget_usd: 5 },
  });
  const image = {
    digest: ID,
    base_digest: BASE,
    harness: "claude-code",
    version: "2.1.282",
    revision: null,
  };
  const f = runtimeFacts(cfg, image, claudeCodeAdapter, catalog);
  assertEquals(
    [f.image.digest, f.backend_version, f.provider_routes["main"], f.servers],
    [ID, "cg-al-backend@1", "anthropic:first-party-oauth", {}],
  );
  const withMcp = {
    ...cfg,
    components: { ...cfg.components, mcp: ["al-tools"] },
  };
  assertThrows(
    () => runtimeFacts(withMcp, image, claudeCodeAdapter, catalog),
    ConfigurationError,
    "no MCP component al-tools",
  );
  const mcp = {
    "al-tools": { version: "al-tools-mcp@1", tool_schema_hash: "h".repeat(64) },
  };
  // M2-09: an MCP arm also needs the repo definition whose hash the label names.
  const defs = { "al-tools": { hash: "h".repeat(64), tools: ["al_compile"] } };
  assertEquals(
    runtimeFacts(withMcp, { ...image, mcp }, claudeCodeAdapter, catalog, defs)
      .servers,
    mcp,
  );
  assertThrows(
    () =>
      runtimeFacts(
        { ...cfg, components: { ...cfg.components, lsp: ["al-lsp"] } },
        image,
        claudeCodeAdapter,
        catalog,
      ),
    ConfigurationError,
    "LSP",
  );
  assertThrows(
    () =>
      runtimeFacts(
        cfg,
        { ...image, version: "2.1.281" },
        claudeCodeAdapter,
        catalog,
      ),
    ConfigurationError,
    "2.1.281",
  );
  const d = new FakeDocker();
  const [key, value] = await mcpLabel(".");
  assertEquals(key, "centralgauge.mcp.al-tools");
  d.addImage("x", ID, { ...LABELS, [key]: value });
  d.shipFile(
    ID,
    AL_TOOLS_SHIPPED,
    await Deno.readTextFile("harness/images/base/al-tools-tools.json"),
  );
  assertEquals(Object.keys((await imageFacts(d, "x", "HOST1")).mcp ?? {}), [
    "al-tools",
  ]);
  d.addImage("y", `sha256:${"d".repeat(64)}`, {
    ...LABELS,
    "centralgauge.mcp.al-tools": "only-one-part",
  });
  await assertRejects(
    () => imageFacts(d, "y", "HOST1"),
    ConfigurationError,
    "centralgauge.mcp.al-tools",
  );
});

Deno.test("mcpLabel: the value is the tool file's version and its hashJson; imageFacts is strict", async () => {
  const def = JSON.parse(
    await Deno.readTextFile("harness/images/base/al-tools-tools.json"),
  );
  const [, value] = await mcpLabel(".");
  assertEquals(value, `${def.version} ${await hashJson(def)}`);
  assertEquals((await mcpLabel("."))[1], value, "deterministic");
  const hash = value.split(" ")[1]!;
  assert(/^[0-9a-f]{64}$/.test(hash));
  const d = new FakeDocker();
  d.addImage("none", ID, LABELS);
  assertEquals((await imageFacts(d, "none", "HOST1")).mcp, {});
  d.addImage("ok", ID, { ...LABELS, "centralgauge.mcp.al-tools": value });
  d.shipFile(
    ID,
    AL_TOOLS_SHIPPED,
    await Deno.readTextFile("harness/images/base/al-tools-tools.json"),
  );
  assertEquals((await imageFacts(d, "ok", "HOST1")).mcp, {
    "al-tools": { version: def.version, tool_schema_hash: hash },
  });
  for (
    const [ref, k, v] of [
      ["unknown", "centralgauge.mcp.other", value],
      ["empty-name", "centralgauge.mcp.", value],
      ["short-hash", "centralgauge.mcp.al-tools", `${def.version} abc`],
      [
        "upper-hash",
        "centralgauge.mcp.al-tools",
        `${def.version} ${"A".repeat(64)}`,
      ],
      ["two-spaces", "centralgauge.mcp.al-tools", `${def.version}  ${hash}`],
      ["tab-version", "centralgauge.mcp.al-tools", `al-tools	mcp@1 ${hash}`],
      ["lead-space", "centralgauge.mcp.al-tools", ` ${def.version} ${hash}`],
    ]
  ) {
    d.addImage(ref!, ID, { ...LABELS, [k!]: v! });
    const err = await assertRejects(
      () => imageFacts(d, ref!, "HOST1"),
      ConfigurationError,
      `image ${ref}`,
    );
    assert(err.message.includes(k!), err.message);
  }
});

Deno.test("runtimeFacts: expected MCP tool names persisted in native settings; definition drift refused before launch", async () => {
  const cfg = HarnessConfigSchema.parse({
    id: "cc-mcp",
    harness: "claude-code",
    harness_version: "2.1.282",
    models: { main: "anthropic/claude-sonnet-5" },
    settings: {},
    components: { mcp: ["al-tools"] },
    limits: { timeout_min: 30, max_budget_usd: 5 },
  });
  const [key, value] = await mcpLabel(".");
  const d = new FakeDocker();
  d.addImage("x", ID, { ...LABELS, [key]: value });
  d.shipFile(
    ID,
    AL_TOOLS_SHIPPED,
    await Deno.readTextFile("harness/images/base/al-tools-tools.json"),
  );
  const image = await imageFacts(d, "x", "HOST1");
  const defs = await mcpDefinitions(".");
  const def = JSON.parse(
    await Deno.readTextFile("harness/images/base/al-tools-tools.json"),
  );
  const names = def.tools.map((t: { name: string }) => t.name).sort();
  const f = runtimeFacts(cfg, image, claudeCodeAdapter, catalog, defs);
  assertEquals(f.native_settings["mcp"], ["al-tools"]);
  assertEquals(f.native_settings["mcp_tools"], { "al-tools": names });
  // Definition drift: the image label names another hash.
  const [version] = value.split(" ");
  const drifted = {
    ...image,
    mcp: {
      "al-tools": { version: version!, tool_schema_hash: "0".repeat(64) },
    },
  };
  assertThrows(
    () => runtimeFacts(cfg, drifted, claudeCodeAdapter, catalog, defs),
    ConfigurationError,
    "differs from image",
  );
  // No definition loaded for a requested server: refused, never guessed.
  assertThrows(
    () => runtimeFacts(cfg, image, claudeCodeAdapter, catalog),
    ConfigurationError,
    "definition",
  );
});

Deno.test("runtimeFacts: a plain arm's native settings carry neither mcp nor mcp_tools", async () => {
  const cfg = HarnessConfigSchema.parse({
    id: "cc",
    harness: "claude-code",
    harness_version: "2.1.282",
    models: { main: "anthropic/claude-sonnet-5" },
    settings: {},
    limits: { timeout_min: 30, max_budget_usd: 5 },
  });
  const image = {
    digest: ID,
    base_digest: BASE,
    harness: "claude-code",
    version: "2.1.282",
    revision: null,
  };
  const f = runtimeFacts(
    cfg,
    image,
    claudeCodeAdapter,
    catalog,
    await mcpDefinitions("."),
  );
  assert(!("mcp" in f.native_settings) && !("mcp_tools" in f.native_settings));
});

Deno.test("mcpDefinitions: a definition without tools, with a nameless or duplicate tool is refused", async () => {
  for (
    const tools of [
      undefined,
      [],
      [{ description: "no name" }],
      [{ name: "al_compile" }, { name: "al_compile" }],
    ]
  ) {
    const root = await Deno.makeTempDir();
    await Deno.mkdir(`${root}/harness/images/base`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/harness/images/base/al-tools-tools.json`,
      JSON.stringify({
        version: "al-tools-mcp@1",
        ...(tools ? { tools } : {}),
      }),
    );
    await assertRejects(
      () => mcpDefinitions(root),
      ConfigurationError,
      "tools",
    );
  }
});

Deno.test("imageFacts: the tool file the image ships must hash to its al-tools label; refused before launch otherwise", async () => {
  const [key, value] = await mcpLabel(".");
  const shipped = await Deno.readTextFile(
    "harness/images/base/al-tools-tools.json",
  );
  const d = new FakeDocker();
  d.addImage("ok", ID, { ...LABELS, [key]: value });
  d.shipFile(ID, AL_TOOLS_SHIPPED, shipped);
  assertEquals(Object.keys((await imageFacts(d, "ok", "HOST1")).mcp ?? {}), [
    "al-tools",
  ]);
  // Same names, another schema: the label says X, the shipped bytes hash to Y.
  const other = `sha256:${"e".repeat(64)}`;
  const def = JSON.parse(shipped);
  def.tools[0].inputSchema = { type: "object", properties: {} };
  d.addImage("drift", other, { ...LABELS, [key]: value });
  d.shipFile(other, AL_TOOLS_SHIPPED, JSON.stringify(def));
  const e = await assertRejects(
    () => imageFacts(d, "drift", "HOST1"),
    ConfigurationError,
    "differs from its label",
  );
  assertEquals(e.message.includes(value.split(" ")[1]!), true);
  assertEquals(e.message.includes(await hashJson(def)), true);
  // Unreadable shipped file: refused, never assumed.
  const none = `sha256:${"f".repeat(64)}`;
  d.addImage("none-shipped", none, { ...LABELS, [key]: value });
  await assertRejects(
    () => imageFacts(d, "none-shipped", "HOST1"),
    ConfigurationError,
    "cannot read",
  );
});

Deno.test("readImageFile: the throwaway container is cg-harness-read-* with the owner label, so a crash leftover is swept", async () => {
  const args = imageReadCreateArgs(ID, "HOST1");
  const name = args[args.indexOf("--name") + 1]!;
  assert(name.startsWith(`${SANDBOX_PREFIX}read-`), name);
  assertEquals(args.slice(-1), [ID]);
  assert(args.includes(`${OWNER_LABEL}=HOST1`));
  assertEquals(args[0], "create");
  // imageFacts passes the owner through to the read.
  const [key, value] = await mcpLabel(".");
  const d = new FakeDocker();
  d.addImage("x", ID, { ...LABELS, [key]: value });
  d.shipFile(
    ID,
    AL_TOOLS_SHIPPED,
    await Deno.readTextFile("harness/images/base/al-tools-tools.json"),
  );
  await imageFacts(d, "x", "HOST1");
  assertEquals(d.reads, [{
    image: ID,
    path: AL_TOOLS_SHIPPED,
    owner: "HOST1",
  }]);
});

// ---- H-01 run 004: image_revision ----

Deno.test("imageTag: no revision is exactly the frozen tag; a revision adds -r<n>", () => {
  assertEquals(
    imageTag("claude-code", "2.1.282"),
    "centralgauge/harness-claude-code:2.1.282",
  );
  assertEquals(imageTag("pi", "0.87.1"), "centralgauge/harness-pi:0.87.1");
  assertEquals(imageTag("mock", "1"), "centralgauge/harness-mock:1");
  assertEquals(
    imageTag("claude-code", "2.1.282", undefined),
    "centralgauge/harness-claude-code:2.1.282",
  );
  assertEquals(
    imageTag("claude-code", "2.1.282", "2"),
    "centralgauge/harness-claude-code:2.1.282-r2",
  );
  assertEquals(
    imageTag("pi", "0.87.1", "2"),
    "centralgauge/harness-pi:0.87.1-r2",
  );
});

Deno.test("imageFacts: revision is the revision label, null when absent", async () => {
  const d = new FakeDocker();
  d.addImage("frozen", ID, LABELS);
  assertEquals((await imageFacts(d, "frozen", "HOST1")).revision, null);
  d.addImage("r2", ID, {
    ...LABELS,
    "centralgauge.harness.revision": "2",
  });
  assertEquals((await imageFacts(d, "r2", "HOST1")).revision, "2");
});

function revisionCase(configRevision?: string) {
  const cfg = HarnessConfigSchema.parse({
    id: "cc",
    harness: "claude-code",
    harness_version: "2.1.282",
    ...(configRevision === undefined ? {} : { image_revision: configRevision }),
    models: { main: "anthropic/claude-sonnet-5" },
    settings: {},
    limits: { timeout_min: 30, max_budget_usd: 5 },
  });
  return (imageRevision: string | null, version = "2.1.282") =>
    runtimeFacts(
      cfg,
      {
        digest: ID,
        base_digest: BASE,
        harness: "claude-code",
        version,
        revision: imageRevision,
      },
      claudeCodeAdapter,
      catalog,
    );
}

Deno.test("runtimeFacts: image revision must equal config image_revision (absent on both sides is the frozen image)", () => {
  // OK: absent on both sides; the manifest image carries no revision key.
  const frozen = revisionCase()(null);
  assertEquals(frozen.image, { digest: ID, base_digest: BASE });
  // OK: equal on both sides; the manifest image records it.
  assertEquals(revisionCase("2")("2").image, {
    digest: ID,
    base_digest: BASE,
    revision: "2",
  });
  // Refused: label present, config absent.
  const e1 = assertThrows(
    () => revisionCase()("2"),
    ConfigurationError,
  );
  assert(
    e1.message.includes("revision 2") && e1.message.includes("no revision"),
    e1.message,
  );
  // Refused: config present, label missing.
  const e2 = assertThrows(
    () => revisionCase("2")(null),
    ConfigurationError,
  );
  assert(
    e2.message.includes("no revision") && e2.message.includes("revision 2"),
    e2.message,
  );
  // Refused: different.
  const e3 = assertThrows(
    () => revisionCase("3")("2"),
    ConfigurationError,
  );
  assert(
    e3.message.includes("revision 2") && e3.message.includes("revision 3"),
    e3.message,
  );
  // Refused: an empty label is not "absent".
  assertThrows(() => revisionCase()(""), ConfigurationError, "revision");
});

Deno.test("runtimeFacts: a version label that differs from harness_version is refused even when revisions match", () => {
  assertThrows(
    () => revisionCase("2")("2", "2.1.300"),
    ConfigurationError,
    "2.1.300",
  );
});

Deno.test("repo configs: claude-code and pi arms resolve to the -r2 images, never the frozen tags", async () => {
  const want: Record<string, string> = {
    "cc-sonnet-mcp": "centralgauge/harness-claude-code:2.1.282-r2",
    "cc-sonnet-plain": "centralgauge/harness-claude-code:2.1.282-r2",
    "cc-sonnet-skills": "centralgauge/harness-claude-code:2.1.282-r2",
    "pi-flash-plain": "centralgauge/harness-pi:0.87.1-r2",
    "pi-sonnet-plain": "centralgauge/harness-pi:0.87.1-r2",
  };
  for (const [id, tag] of Object.entries(want)) {
    const c = await loadConfig("harness", id);
    assertEquals(
      imageTag(c.harness, c.harness_version, c.image_revision),
      tag,
      id,
    );
  }
});

Deno.test("claude-code image: the LSP layer installs from al-lsp.json pins and is locked with M9's inventory before USER", async () => {
  const df = await Deno.readTextFile(
    "harness/images/claude-code/Dockerfile.windows",
  );
  for (
    const s of [
      "COPY lsp/al-lsp.json C:/cg-lsp/al-lsp.json",
      "COPY lsp/lsp-probe.mjs C:/cg-lsp/lsp-probe.mjs",
      "COPY lsp/lsp-probe-lib.mjs C:/cg-lsp/lsp-probe-lib.mjs",
      "COPY lsp/install-lsp.ps1 C:/cg-lsp/install-lsp.ps1",
      "COPY cg-inventory.ps1 C:/cg-inventory.ps1",
    ]
  ) assertStringIncludes(df, s);
  const lock = df.split(/\r?\n/).find((l) => l.includes("cg-lockdown.ps1"))!;
  for (
    const p of [
      "C:\\cg-npm",
      "C:\\run.ps1",
      "C:\\cg-inventory.ps1",
      "C:\\cg-lsp",
    ]
  ) {
    assertStringIncludes(lock, p);
  }
  for (const line of df.split("\n").filter((l) => l.startsWith("RUN "))) {
    assert(
      !line.includes('"'),
      `no double quote in a shell-form RUN: ${line}`,
    );
  }
  assert(df.indexOf("install-lsp.ps1") < df.indexOf("cg-lockdown.ps1"));
  assert(df.indexOf("cg-lockdown.ps1") < df.indexOf("USER ContainerUser"));
});

Deno.test("claude-code image: both probe files ship side by side, present and hashable, the probe importing the lib", async () => {
  const dir = "harness/images/claude-code/lsp/";
  const probe = await Deno.readFile(`${dir}lsp-probe.mjs`);
  const lib = await Deno.readFile(`${dir}lsp-probe-lib.mjs`);
  const def = JSON.parse(await Deno.readTextFile(`${dir}al-lsp.json`));
  assertEquals(Object.keys(def.probe).sort(), [
    "lsp-probe-lib.mjs",
    "lsp-probe.mjs",
  ]);
  const sha = async (b: Uint8Array<ArrayBuffer>) =>
    Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b)))
      .map((x) => x.toString(16).padStart(2, "0")).join("");
  assertEquals(def.probe["lsp-probe.mjs"], await sha(probe));
  assertEquals(def.probe["lsp-probe-lib.mjs"], await sha(lib));
  assertStringIncludes(
    new TextDecoder().decode(probe),
    "./lsp-probe-lib.mjs",
  );
});

// Approved deviation from the plan (decisions/2026-10-03-m10-03-s1-gate-FINAL.md and the
// orchestrator ruling of 2026-10-03): pins.wrapper is an ordered list of two release sources
// (v1.18.3 wrapper, v1.18.2 al-call-hierarchy) instead of one v1.17.0 zip.
Deno.test("al-lsp.json: pins, lineage and diagnostics policy are complete; the shipped .lsp.json is offline, multi-app and matches the policy", async () => {
  const d = JSON.parse(
    await Deno.readTextFile("harness/images/claude-code/lsp/al-lsp.json"),
  );
  const H256 = /^[0-9a-f]{64}$/;
  assertMatch(d.version, /^al-lsp@\d+$/);
  // M10-10 (decisions/2026-10-13-lsp-track-latest.md): no wrapper pins; the release is
  // resolved at build and verified against the API digest (see the M10-10 tests below).
  assertEquals(d.pins.wrapper, undefined);
  assertEquals(
    [d.source.repo, d.source.asset],
    ["SShadowS/al-lsp-for-agents", "al-lsp-wrapper-windows-x64.zip"],
  );
  for (const k of ["al_extension", "dotnet"]) {
    const p = d.pins[k];
    assertMatch(p.url, /^https:\/\//);
    assertMatch(
      p.hash,
      p.algorithm === "SHA512" ? /^[0-9a-f]{128}$/ : H256,
      `${k} hash`,
    );
  }
  assertEquals(d.pins.al_extension.version, "18.0.2732683");
  for (const side of ["extension", "backend"]) {
    assertMatch(d.lineage[side].version, /^\d+\.\d+/);
    assertMatch(d.lineage[side].sha256, H256);
  }
  assertEquals(d.diagnostics, "sidecar-on");
  const al = d.lsp_json.al;
  assertEquals(al.command, "$" + "{CLAUDE_PLUGIN_ROOT}/bin/al-lsp-wrapper.exe");
  assertEquals(al.transport, "stdio");
  const i = al.args.indexOf("--al-extension-path");
  assertEquals(al.args.slice(i, i + 2), [
    "--al-extension-path",
    "C:\\cg-lsp\\al",
  ]);
  assert(!al.args.includes("--auto-download-al-extension"));
  assertEquals(
    al.args.includes("--no-diagnostics"),
    d.diagnostics === "sidecar-off",
  );
  assertEquals(
    [
      al.env.HTTPS_PROXY,
      al.env.HTTP_PROXY,
      al.env.AL_LSP_SOURCE_ROOTS,
      al.env.DOTNET_ROOT,
    ],
    ["", "", "C:\\workspace", "C:\\cg-lsp\\dotnet"],
  );
  assertEquals([al.initializationOptions, al.settings], [{}, {}]);
  assertEquals(d.plugin_json.name, "al-language-server-go-windows");
});

Deno.test("al-lsp.json: the strip list is enumerated (21 exact names, no wildcards) and covers the four tools", async () => {
  const d = JSON.parse(
    await Deno.readTextFile("harness/images/claude-code/lsp/al-lsp.json"),
  );
  const rm: string[] = d.pins.al_extension.remove;
  assertEquals(rm.length, 21);
  assertEquals(new Set(rm).size, 21);
  for (const n of rm) assertMatch(n, /^(alc|altool|aldoc|almcp)\.[A-Za-z.]+$/);
  assert(rm.every((n) => !n.includes("*")));
  for (const t of ["alc", "altool", "aldoc", "almcp"]) {
    for (const ext of ["exe", "dll"]) assert(rm.includes(`${t}.${ext}`));
  }
});

Deno.test("al-lsp.json: the authorized pin values are exact (S1 pins.md, FINAL gate decision, orchestrator ruling 2026-10-03)", async () => {
  const d = JSON.parse(
    await Deno.readTextFile("harness/images/claude-code/lsp/al-lsp.json"),
  );
  // M10-10: the v1.18.3 / v1.18.2 wrapper pins are gone by design (latest release, API digest).
  assertEquals(
    [d.pins.al_extension.algorithm, d.pins.al_extension.hash],
    [
      "SHA256",
      "d45068b508f7d16ba1c88a5ce1831497493c948dc4fb3ae80c92c7ccf8d68433",
    ],
  );
  assertEquals(
    [d.pins.dotnet.url, d.pins.dotnet.algorithm, d.pins.dotnet.hash],
    [
      "https://builds.dotnet.microsoft.com/dotnet/aspnetcore/Runtime/10.0.12/aspnetcore-runtime-10.0.12-win-x64.zip",
      "SHA512",
      "b6958736bd42eff9c78a27a489d43eb0a39c6201039070ecb76a93cb96c519f07c86fa8b62034c6dd1a82a4c8ad0bd781e052008a7ec4cc48f9f792227d9c7ac",
    ],
  );
});

Deno.test("install-lsp.ps1 and Dockerfile: every build-time safety check is present (deleting one fails this test)", async () => {
  const ps = (await Deno.readTextFile(
    "harness/images/claude-code/lsp/install-lsp.ps1",
  )).replace(/\r\n/g, "\n");
  const code = ps.split("\n").filter((l) => !l.trimStart().startsWith("#"));
  const has = (s: string) =>
    assert(code.some((l) => l.includes(s)), `install-lsp.ps1 lacks: ${s}`);
  for (
    const s of [
      "$ErrorActionPreference = 'Stop'",
      // download hash check
      "-Algorithm $pin.algorithm).Hash.ToLowerInvariant()",
      "if ($got -ne $pin.hash) { throw ('hash mismatch for ' + $pin.url",
      // wrapper archive shape; M10-10: the per-exe hand pins became the release zip's
      // API digest (strict args, then the download hash check above)
      "if ($found.Count -ne 1) { throw (",
      'if (Test-Path -LiteralPath "$bin\\$name") { throw (',
      "if ($release -cnotmatch '^v[0-9]+\\.[0-9]+\\.[0-9]+\\z') { throw (",
      "if ($sha -cnotmatch '^[0-9a-f]{64}\\z') { throw (",
      "if ($url -cne $want) { throw (",
      "Get-Pinned @{ url = $Url; algorithm = 'SHA256'; hash = $Sha256 }",
      "Move-Item -LiteralPath $part -Destination $out",
      "if (-not $copy.Wait($left)) { throw (",
      // exact exe set
      "if ($exes -ne 'al-call-hierarchy.exe,al-lsp-wrapper.exe') { throw (",
      // probe hash check, exact names
      "if ($h -ne $p.Value) { throw ('hash mismatch for ' + $p.Name + ': got '",
      "$probeNames -notcontains 'lsp-probe.mjs'",
      "$probeNames -notcontains 'lsp-probe-lib.mjs'",
      "if ($probeNames.Count -ne 2",
      // strip then recursive prefix re-check
      'Remove-Item -LiteralPath "C:\\cg-lsp\\al\\bin\\$name" -Force',
      "foreach ($prefix in 'alc', 'altool', 'aldoc', 'almcp')",
      "Get-ChildItem -LiteralPath 'C:\\cg-lsp\\al' -File -Recurse",
      "if ($left.Count -ne 0) { throw (",
      // lineage
      "if ($ca -ne $def.lineage.extension.sha256) { throw (",
    ]
  ) has(s);
  const df = await Deno.readTextFile(
    "harness/images/claude-code/Dockerfile.windows",
  );
  const run = df.replace(/\\\r?\n\s*/g, "").split(/\r?\n/).find((l) =>
    l.startsWith("RUN ") && l.includes("C:\\cg-lsp\\install-lsp.ps1")
  )!;
  assertStringIncludes(
    run,
    "if ($LASTEXITCODE -ne 0) { throw ('install-lsp failed: ' + $LASTEXITCODE) }",
  );
  assertStringIncludes(run, "Remove-Item -Force C:\\cg-lsp\\install-lsp.ps1");
  assert(
    run.indexOf("$LASTEXITCODE") < run.indexOf("Remove-Item"),
    "the exit check runs before the script is removed",
  );
});

Deno.test("al-lsp.json: an exact manifest of every installed .exe under C:\\cg-lsp, verified after install; zips are screened before extraction", async () => {
  const d = JSON.parse(
    await Deno.readTextFile("harness/images/claude-code/lsp/al-lsp.json"),
  );
  // Source: lane-ops' read of the gated -M10-02f image (H:\cg-coord\m10\cg-lsp-exe-manifest.txt), lowercase.
  // M10-10: the two wrapper exes are no longer pinned here; install-lsp.ps1 adds their
  // hashes from the digest-verified release zip before the manifest check.
  assertEquals(d.exes, {
    "al\\bin\\microsoft.dynamics.nav.editorservices.host.exe":
      "465268879ba69d0d885939d16d5a3e47ac97b2e8aa68d6b27a5c573545d59ec9",
    "dotnet\\dotnet.exe":
      "21a46f1e5235cf4e844b9de5429f0e198b9c97a41f0503a66442f1d639ca3ee6",
    "dotnet\\shared\\microsoft.netcore.app\\10.0.12\\createdump.exe":
      "315307159925d33eb604186a512901d080ecfc4cd8b8198030a7d398c6af2b0b",
  });
  const code = (await Deno.readTextFile(
    "harness/images/claude-code/lsp/install-lsp.ps1",
  )).split(/\r?\n/).filter((l) => !l.trimStart().startsWith("#"));
  for (
    const s of [
      "Assert-ExeManifest 'C:\\cg-lsp' $def.exes",
      'Assert-ZipSafe "$tmp\\al.zip"',
      'Assert-ZipSafe "$tmp\\dotnet.zip"',
      "Assert-ZipSafe $zip",
    ]
  ) assert(code.some((l) => l.includes(s)), `install-lsp.ps1 lacks: ${s}`);
  const at = (s: string) => code.findIndex((l) => l.includes(s));
  const expands = code.filter((l) => l.includes("Expand-Archive")).length;
  const guards =
    code.filter((l) =>
      l.includes("Assert-ZipSafe ") && !l.startsWith("function ")
    ).length;
  assertEquals(expands, 3);
  assertEquals(expands, guards, "every extraction has its own Assert-ZipSafe");
  assert(
    at('Assert-ZipSafe "$tmp\\dotnet.zip"') <
      at('Expand-Archive -LiteralPath "$tmp\\dotnet.zip"'),
  );
  assert(
    at('Assert-ZipSafe "$tmp\\al.zip"') <
      at('Expand-Archive -LiteralPath "$tmp\\al.zip"'),
  );
  assert(
    at("Assert-ZipSafe $zip") < at("Expand-Archive -LiteralPath $zip"),
  );
  assert(
    at("Assert-ExeManifest 'C:\\cg-lsp' $def.exes") >
      at('WriteAllText("$plugin\\.claude-plugin\\plugin.json"'),
    "the manifest check runs after the last install step",
  );
});

Deno.test("lspLabel: the value is al-lsp.json's version and its hashJson; no file, no label", async () => {
  const [k, v] = (await lspLabel("."))!;
  assertEquals(k, "centralgauge.lsp.al");
  const def = JSON.parse(await Deno.readTextFile(AL_LSP_DEF));
  assertEquals(v, `${def.version} ${await hashJson(def)}`);
  assertEquals(await lspLabel(await Deno.makeTempDir()), null);
});

Deno.test("imageFacts: an LSP label needs the shipped al-lsp.json to hash to it; unknown LSP labels refused", async () => {
  const [k, v] = (await lspLabel("."))!;
  const shipped = await Deno.readTextFile(AL_LSP_DEF);
  const d = new FakeDocker();
  // M10-10 fixture: the current recipe needs the release labels and resolved file.
  d.addImage("ok", ID, { ...LABELS, [k]: v, ...lspReleaseLabels() });
  d.shipFile(ID, AL_LSP_SHIPPED, shipped);
  d.shipFile(ID, AL_LSP_RESOLVED, lspResolvedJson());
  assertEquals(
    Object.keys((await imageFacts(d, "ok", "HOST1")).lsp ?? {}),
    ["al"],
  );
  const other = `sha256:${"e".repeat(64)}`;
  const def = JSON.parse(shipped);
  def.lsp_json.al.args = [...def.lsp_json.al.args, "--extra"];
  d.addImage("drift", other, { ...LABELS, [k]: v });
  d.shipFile(other, AL_LSP_SHIPPED, JSON.stringify(def));
  await assertRejects(
    () => imageFacts(d, "drift", "HOST1"),
    ConfigurationError,
    "differs from its label",
  );
  d.addImage("none", `sha256:${"f".repeat(64)}`, { ...LABELS, [k]: v });
  await assertRejects(
    () => imageFacts(d, "none", "HOST1"),
    ConfigurationError,
    "cannot read",
  );
  d.addImage("unknown", `sha256:${"c".repeat(64)}`, {
    ...LABELS,
    "centralgauge.lsp.pyright": v,
  });
  await assertRejects(
    () => imageFacts(d, "unknown", "HOST1"),
    ConfigurationError,
    "unknown LSP component",
  );
  d.addImage("plain", `sha256:${"9".repeat(64)}`, LABELS);
  assertEquals((await imageFacts(d, "plain", "HOST1")).lsp, undefined);
});

Deno.test("runtimeFacts: an LSP arm needs the image's LSP label and the repo definition with the same hash", () => {
  const cfg = HarnessConfigSchema.parse({
    id: "cc-lsp",
    harness: "claude-code",
    harness_version: "2.1.282",
    image_revision: "3",
    models: { main: "anthropic/claude-sonnet-5" },
    components: { lsp: ["al"] },
    limits: { timeout_min: 30, max_budget_usd: 5 },
  });
  const image = {
    digest: ID,
    base_digest: BASE,
    harness: "claude-code",
    version: "2.1.282",
    revision: "3",
  };
  assertThrows(
    () => runtimeFacts(cfg, image, claudeCodeAdapter, catalog),
    ConfigurationError,
    "has no LSP component al",
  );
  const lsp = { al: { version: "al-lsp@1", tool_schema_hash: "1".repeat(64) } };
  assertThrows(
    () => runtimeFacts(cfg, { ...image, lsp }, claudeCodeAdapter, catalog),
    ConfigurationError,
    "no repo definition loaded for LSP component al",
  );
  assertThrows(
    () =>
      runtimeFacts(cfg, { ...image, lsp }, claudeCodeAdapter, catalog, {
        al: { hash: "2".repeat(64), tools: [] },
      }),
    ConfigurationError,
    "differs from image",
  );
  const f = runtimeFacts(cfg, { ...image, lsp }, claudeCodeAdapter, catalog, {
    al: { hash: "1".repeat(64), tools: [] },
  });
  assertEquals(f.servers, lsp);
  assertEquals(f.native_settings["mcp_tools"], undefined);
});

Deno.test("serverDefinitions: only the kinds a config names; the LSP definition lists no MCP tools", async () => {
  assertEquals(await serverDefinitions(".", { mcp: [], lsp: [] }), {});
  const both = await serverDefinitions(".", { mcp: ["al-tools"], lsp: ["al"] });
  assertEquals(Object.keys(both).sort(), ["al", "al-tools"]);
  assertEquals(both["al"]!.tools, []);
  assertEquals(both["al"]!.hash, (await lspLabel("."))![1].split(" ")[1]);
});

Deno.test("serverDefinitions: a name in both mcp and lsp is refused, not overwritten", async () => {
  await assertRejects(
    () => serverDefinitions(".", { mcp: ["al"], lsp: ["al"] }),
    ConfigurationError,
    "both MCP and LSP",
  );
});

Deno.test("runtimeFacts: frozen and pre-LSP images refuse an LSP arm", async () => {
  const cfg = HarnessConfigSchema.parse({
    id: "cc-lsp",
    harness: "claude-code",
    harness_version: "2.1.282",
    image_revision: "3",
    models: { main: "anthropic/claude-sonnet-5" },
    components: { lsp: ["al"] },
    limits: { timeout_min: 30, max_budget_usd: 5 },
  });
  const defs = await serverDefinitions(".", cfg.components);
  const d = new FakeDocker();
  // Frozen: no revision label, no LSP label.
  d.addImage("frozen", ID, LABELS);
  const frozen = await imageFacts(d, "frozen", "HOST1");
  assertEquals(frozen.revision, null);
  assertThrows(
    () => runtimeFacts(cfg, frozen, claudeCodeAdapter, catalog, defs),
    ConfigurationError,
    "has no revision",
  );
  // Revisioned but pre-LSP: no centralgauge.lsp.al label.
  const preId = `sha256:${"d".repeat(64)}`;
  d.addImage("pre", preId, {
    ...LABELS,
    "centralgauge.harness.revision": "3",
  });
  const pre = await imageFacts(d, "pre", "HOST1");
  assertThrows(
    () => runtimeFacts(cfg, pre, claudeCodeAdapter, catalog, defs),
    ConfigurationError,
    "has no LSP component al",
  );
});

Deno.test("LSP label version: a correct hash with a wrong version is refused by imageFacts (shipped file) and runtimeFacts (repo file)", async () => {
  const [k, v] = (await lspLabel("."))!;
  const [version, hash] = v.split(" ");
  const bad = `al-lsp@999 ${hash}`;
  const d = new FakeDocker();
  d.addImage("liar", ID, { ...LABELS, [k]: bad });
  d.shipFile(ID, AL_LSP_SHIPPED, await Deno.readTextFile(AL_LSP_DEF));
  await assertRejects(
    () => imageFacts(d, "liar", "HOST1"),
    ConfigurationError,
    "al-lsp@999",
  );
  // An image facts value that skipped the shipped check still meets the repo file.
  const cfg = HarnessConfigSchema.parse({
    id: "cc-lsp",
    harness: "claude-code",
    harness_version: "2.1.282",
    image_revision: "3",
    models: { main: "anthropic/claude-sonnet-5" },
    components: { lsp: ["al"] },
    limits: { timeout_min: 30, max_budget_usd: 5 },
  });
  const image = {
    digest: ID,
    base_digest: BASE,
    harness: "claude-code",
    version: "2.1.282",
    revision: "3",
    lsp: { al: { version: "al-lsp@999", tool_schema_hash: hash! } },
  };
  const defs = await serverDefinitions(".", cfg.components);
  const err = assertThrows(
    () => runtimeFacts(cfg, image, claudeCodeAdapter, catalog, defs),
    ConfigurationError,
    "al-lsp@999",
  );
  assertStringIncludes(err.message, version!);
});

Deno.test("imageFacts (M10-05): an older MCP label with its matching shipped definition is accepted, version and hash as labelled", async () => {
  const [, current] = await mcpLabel(".");
  const shipped = JSON.parse(
    await Deno.readTextFile("harness/images/base/al-tools-tools.json"),
  );
  const older = { ...shipped, version: "al-tools-mcp@0" };
  const olderHash = await hashJson(older);
  assert(older.version !== shipped.version);
  assert(olderHash !== current.split(" ")[1]);
  const d = new FakeDocker();
  d.addImage("older", ID, {
    ...LABELS,
    "centralgauge.mcp.al-tools": `${older.version} ${olderHash}`,
  });
  d.shipFile(ID, AL_TOOLS_SHIPPED, JSON.stringify(older));
  assertEquals((await imageFacts(d, "older", "HOST1")).mcp, {
    "al-tools": { version: older.version, tool_schema_hash: olderHash },
  });
});

// M10-10 (decisions/2026-10-13-lsp-track-latest.md): the wrapper tracks the newest release.
Deno.test("resolveLspRelease (M10-10): one unauthenticated HTTPS call for the newest release; tag, exact asset URL and API digest come back", async () => {
  const calls: { url: string; init?: RequestInit | undefined }[] = [];
  const r = await resolveLspRelease(
    ".",
    fakeFetch(lspLatestBody(), 200, calls),
  );
  assertEquals(r, {
    tag: LSP_REL.tag,
    asset: LSP_REL.asset,
    url: LSP_REL.url,
    sha256: LSP_REL.sha256,
    dependency_source: "embedded",
  });
  assertEquals(calls.map((c) => c.url), [
    "https://api.github.com/repos/SShadowS/al-lsp-for-agents/releases/latest",
  ]);
  assertEquals(new Headers(calls[0]!.init?.headers).get("authorization"), null);
  assert(calls[0]!.init?.signal, "the API call has a deadline");
});

Deno.test("resolveLspRelease (M10-10): fails closed on a network error, non-200, odd tag, missing or duplicate asset, missing or non-sha256 digest, foreign URL", async () => {
  const withAsset = (over: Record<string, unknown>) => {
    const b = lspLatestBody();
    b.assets[1] = { ...b.assets[1]!, ...over };
    return b;
  };
  const b = lspLatestBody();
  const cases: [string, typeof fetch, string][] = [
    [
      "network",
      (() => Promise.reject(new TypeError("dns failure"))) as typeof fetch,
      "dns failure",
    ],
    ["404", fakeFetch({ message: "Not Found" }, 404), "HTTP 404"],
    ["403", fakeFetch({ message: "rate limited" }, 403), "HTTP 403"],
    ["201", fakeFetch(lspLatestBody(), 201), "HTTP 201"],
    ["not json", fakeFetch("<html>", 200), "cannot resolve"],
    ["no tag", fakeFetch({ ...b, tag_name: undefined }), "tag_name"],
    ["short tag", fakeFetch({ ...b, tag_name: "v1.18" }), "tag_name"],
    ["no v", fakeFetch({ ...b, tag_name: "1.18.8" }), "tag_name"],
    ["suffix", fakeFetch({ ...b, tag_name: "v1.18.8-rc1" }), "tag_name"],
    ["newline", fakeFetch({ ...b, tag_name: "v1.18.8\n" }), "tag_name"],
    ["prerelease", fakeFetch({ ...b, prerelease: true }), "prerelease"],
    ["draft", fakeFetch({ ...b, draft: true }), "draft"],
    [
      "no asset",
      fakeFetch({ ...b, assets: b.assets.slice(0, 1) }),
      "0 assets named al-lsp-wrapper-windows-x64.zip",
    ],
    [
      "two assets",
      fakeFetch({ ...b, assets: [...b.assets, b.assets[1]] }),
      "2 assets named",
    ],
    ["no assets", fakeFetch({ ...b, assets: undefined }), "0 assets named"],
    ["no digest", fakeFetch(withAsset({ digest: undefined })), "digest"],
    [
      "sha512",
      fakeFetch(withAsset({ digest: `sha512:${"a".repeat(128)}` })),
      "digest",
    ],
    [
      "upper",
      fakeFetch(
        withAsset({ digest: `sha256:${LSP_REL.sha256.toUpperCase()}` }),
      ),
      "digest",
    ],
    [
      "short",
      fakeFetch(withAsset({ digest: `sha256:${"a".repeat(63)}` })),
      "digest",
    ],
    [
      "foreign url",
      fakeFetch(withAsset({
        browser_download_url: LSP_REL.url.replace("SShadowS", "evil"),
      })),
      "browser_download_url",
    ],
  ];
  for (const [name, f, msg] of cases) {
    const err = await assertRejects(
      () => resolveLspRelease(".", f),
      ConfigurationError,
      undefined,
      name,
    );
    assertStringIncludes(err.message, msg, name);
  }
});

Deno.test("lspReleaseArgs (M10-10): the build args and labels carry the resolved tag, asset URL, digest and dependency-source mode", async () => {
  const r = await resolveLspRelease(".", fakeFetch());
  assertEquals(lspReleaseArgs(r), [
    "--build-arg",
    `LSP_RELEASE=${LSP_REL.tag}`,
    "--build-arg",
    `LSP_WRAPPER_URL=${LSP_REL.url}`,
    "--build-arg",
    `LSP_WRAPPER_SHA256=${LSP_REL.sha256}`,
    "--label",
    `centralgauge.lsp.al.release=${LSP_REL.tag}`,
    "--label",
    `centralgauge.lsp.al.asset=${LSP_REL.asset} sha256:${LSP_REL.sha256}`,
    "--label",
    "centralgauge.lsp.al.dependency_source=embedded",
  ]);
});

Deno.test("al-lsp.json (M10-10): the wrapper and al-call-hierarchy come from one latest-release source, no hand pin; embedded mode leaves AL_SEM_DEPENDENCY_SOURCE unset", async () => {
  const d = JSON.parse(await Deno.readTextFile(AL_LSP_DEF));
  assertEquals(d.source, {
    repo: "SShadowS/al-lsp-for-agents",
    asset: "al-lsp-wrapper-windows-x64.zip",
    exes: ["al-call-hierarchy.exe", "al-lsp-wrapper.exe"],
    dependency_source: "embedded",
  });
  assertEquals(d.pins.wrapper, undefined);
  assertEquals(
    Object.keys(d.exes).filter((k) =>
      k.startsWith("al-language-server-go-windows")
    ),
    [],
  );
  assertEquals(
    Object.hasOwn(d.lsp_json.al.env, "AL_SEM_DEPENDENCY_SOURCE"),
    false,
  );
  assert(
    !/\d+\.\d+\.\d+/.test(d.plugin_json.description),
    `plugin_json.description names a version: ${d.plugin_json.description}`,
  );
});

Deno.test("claude-code image (M10-10): the Dockerfile passes the resolved release to install-lsp.ps1, which checks it before any download and records it", async () => {
  const df = await Deno.readTextFile(
    "harness/images/claude-code/Dockerfile.windows",
  );
  for (const a of ["LSP_RELEASE", "LSP_WRAPPER_URL", "LSP_WRAPPER_SHA256"]) {
    assert(df.split(/\r?\n/).includes(`ARG ${a}`), `Dockerfile lacks ARG ${a}`);
  }
  const run = df.replace(/\\\r?\n\s*/g, "").split(/\r?\n/).find((l) =>
    l.startsWith("RUN ") && l.includes("C:\\cg-lsp\\install-lsp.ps1")
  )!;
  assertStringIncludes(
    run,
    "install-lsp.ps1 -Release $env:LSP_RELEASE -Url $env:LSP_WRAPPER_URL -Sha256 $env:LSP_WRAPPER_SHA256;",
  );
  assert(df.indexOf("ARG LSP_RELEASE") < df.indexOf(run.slice(0, 20)));
  const code = (await Deno.readTextFile(
    "harness/images/claude-code/lsp/install-lsp.ps1",
  )).split(/\r?\n/).filter((l) => !l.trimStart().startsWith("#"));
  const at = (s: string) => code.findIndex((l) => l.includes(s));
  for (
    const s of [
      "param([switch]$LibOnly, [string]$Release, [string]$Url, [string]$Sha256)",
      "Assert-ReleaseArgs $src $Release $Url $Sha256",
      "Get-Pinned @{ url = $Url; algorithm = 'SHA256'; hash = $Sha256 } \"$tmp\\wrapper.zip\"",
      'Install-WrapperZip "$tmp\\wrapper.zip" $src.exes "$plugin\\bin"',
      "'C:\\cg-lsp\\al-lsp-resolved.json'",
      "Set-DependencySource $def",
    ]
  ) assert(at(s) >= 0, `install-lsp.ps1 lacks: ${s}`);
  assert(at("Assert-ReleaseArgs $src") < at("Get-Pinned @{ url = $Url"));
  assert(at("Get-Pinned @{ url = $Url") < at('Install-WrapperZip "$tmp'));
  assert(
    at("Set-DependencySource $def") < at('WriteAllText("$plugin\\.lsp.json"'),
  );
  assert(
    at("Assert-ExeManifest 'C:\\cg-lsp' $def.exes") >
      at("'C:\\cg-lsp\\al-lsp-resolved.json'"),
  );
});

Deno.test("imageFacts (M10-10): the release labels are LSP facts; the shipped al-lsp-resolved.json must agree with them and with the recipe", async () => {
  const [k, v] = (await lspLabel("."))!;
  const [version, hash] = v.split(" ") as [string, string];
  const shipped = await Deno.readTextFile(AL_LSP_DEF);
  const d = new FakeDocker();
  let n = 0;
  const image = (labels: Record<string, string>, resolved: string | null) => {
    n++;
    const id = `sha256:${n.toString(16).padStart(64, "0")}`;
    d.addImage(`img${n}`, id, { ...LABELS, [k]: v, ...labels });
    d.shipFile(id, AL_LSP_SHIPPED, shipped);
    if (resolved !== null) d.shipFile(id, AL_LSP_RESOLVED, resolved);
    return `img${n}`;
  };
  const want = {
    version,
    tool_schema_hash: hash,
    release: LSP_REL.tag,
    asset: `${LSP_REL.asset} sha256:${LSP_REL.sha256}`,
    dependency_source: "embedded",
  };
  const ok = image(lspReleaseLabels(), lspResolvedJson());
  assertEquals((await imageFacts(d, ok, "HOST1")).lsp, { al: want });
  assertEquals((await imageFacts(d, ok, null)).lsp, { al: want });
  const rel = lspReleaseLabels();
  const cases: [string, Record<string, string>, string | null, string][] = [
    [
      "release",
      rel,
      lspResolvedJson({ release: "v1.18.7" }),
      "release v1.18.7 differs from its label v1.18.8",
    ],
    ["digest", rel, lspResolvedJson({ sha256: "e".repeat(64) }), "asset"],
    [
      "mode",
      lspReleaseLabels("symbols"),
      lspResolvedJson(),
      "dependency_source",
    ],
    [
      "recipe mode",
      lspReleaseLabels("symbols"),
      lspResolvedJson({ dependency_source: "symbols" }),
      "recipe",
    ],
    [
      "exes",
      rel,
      lspResolvedJson({ exes: { "al-lsp-wrapper.exe": "d".repeat(64) } }),
      "exes",
    ],
    [
      "exe hash",
      rel,
      lspResolvedJson({
        exes: { "al-call-hierarchy.exe": "x", "al-lsp-wrapper.exe": "y" },
      }),
      "exes",
    ],
    ["no file", rel, null, "cannot read"],
    ["not json", rel, "{", "cannot read"],
    [
      "no labels",
      {},
      lspResolvedJson(),
      "lacks label centralgauge.lsp.al.release",
    ],
    [
      "partial",
      { "centralgauge.lsp.al.release": LSP_REL.tag },
      lspResolvedJson(),
      "together",
    ],
    [
      "odd release label",
      { ...rel, "centralgauge.lsp.al.release": "latest" },
      lspResolvedJson(),
      "centralgauge.lsp.al.release",
    ],
    [
      "odd asset label",
      { ...rel, "centralgauge.lsp.al.asset": LSP_REL.asset },
      lspResolvedJson(),
      "centralgauge.lsp.al.asset",
    ],
    [
      "odd mode label",
      { ...rel, "centralgauge.lsp.al.dependency_source": "fast" },
      lspResolvedJson(),
      "centralgauge.lsp.al.dependency_source",
    ],
    [
      "unknown field",
      { ...rel, "centralgauge.lsp.al.extra": "1" },
      lspResolvedJson(),
      "unknown LSP component",
    ],
  ];
  for (const [name, labels, resolved, msg] of cases) {
    const ref = image(labels, resolved);
    const err = await assertRejects(
      () => imageFacts(d, ref, "HOST1"),
      ConfigurationError,
      undefined,
      name,
    );
    assertStringIncludes(err.message, msg, name);
  }
  // Release labels without the al label they describe.
  d.addImage("orphan", `sha256:${"f".repeat(64)}`, { ...LABELS, ...rel });
  await assertRejects(
    () => imageFacts(d, "orphan", null),
    ConfigurationError,
    "together",
  );
});

Deno.test("runtimeFacts (M10-10): the resolved release reaches the arm manifest's lsp server entry", async () => {
  const cfg = HarnessConfigSchema.parse({
    id: "cc-lsp",
    harness: "claude-code",
    harness_version: "2.1.282",
    image_revision: "3",
    models: { main: "anthropic/claude-sonnet-5" },
    components: { lsp: ["al"] },
    limits: { timeout_min: 30, max_budget_usd: 5 },
  });
  const al = {
    version: "al-lsp@2",
    tool_schema_hash: "1".repeat(64),
    release: LSP_REL.tag,
    asset: `${LSP_REL.asset} sha256:${LSP_REL.sha256}`,
    dependency_source: "embedded",
  };
  const f = runtimeFacts(
    cfg,
    {
      digest: ID,
      base_digest: BASE,
      harness: "claude-code",
      version: "2.1.282",
      revision: "3",
      lsp: { al },
    },
    claudeCodeAdapter,
    catalog,
    { al: { hash: "1".repeat(64), tools: [] } },
  );
  assertEquals(f.servers, { al });
  const m = await resolveManifest("harness", cfg, f);
  assertEquals(m.lsp, [{ name: "al", ...al }]);
});

Deno.test("resolveLspRelease (M10-10 r2): the API call refuses redirects; a 3xx or a redirect error fails closed", async () => {
  const calls: { url: string; init?: RequestInit | undefined }[] = [];
  await resolveLspRelease(".", fakeFetch(lspLatestBody(), 200, calls));
  assertEquals(calls[0]!.init?.redirect, "error");
  // A fetch that follows redirects unless told not to (as global fetch does):
  // with redirect "error" it rejects, so another authority never supplies the digest.
  const following =
    ((_u: string | URL | Request, init?: RequestInit) =>
      init?.redirect === "error"
        ? Promise.reject(new TypeError("unexpected redirect"))
        : Promise.resolve(
          new Response(JSON.stringify(lspLatestBody()), { status: 200 }),
        )) as typeof fetch;
  const err = await assertRejects(
    () => resolveLspRelease(".", following),
    ConfigurationError,
  );
  assertStringIncludes(err.message, "unexpected redirect");
  for (const s of [301, 302, 303, 307, 308]) {
    const e = await assertRejects(
      () => resolveLspRelease(".", fakeFetch(lspLatestBody(), s)),
      ConfigurationError,
    );
    assertStringIncludes(e.message, `HTTP ${s}`);
  }
});

Deno.test("runtimeFacts (M10-10 r2): every cell on a release-labelled image records the installed LSP release in image.installed, plain arms without enabling LSP; an unlabelled image records nothing new", async () => {
  const al = {
    version: "al-lsp@2",
    tool_schema_hash: "1".repeat(64),
    release: LSP_REL.tag,
    asset: `${LSP_REL.asset} sha256:${LSP_REL.sha256}`,
    dependency_source: "embedded",
  };
  const installed = {
    lsp: {
      al: {
        release: al.release,
        asset: al.asset,
        dependency_source: al.dependency_source,
      },
    },
  };
  const cfg = (id: string, components: Record<string, unknown>) =>
    HarnessConfigSchema.parse({
      id,
      harness: "claude-code",
      harness_version: "2.1.282",
      image_revision: "3",
      models: { main: "anthropic/claude-sonnet-5" },
      components,
      limits: { timeout_min: 30, max_budget_usd: 5 },
    });
  const img = (lsp?: Record<string, LspFact>): ImageFacts => ({
    digest: ID,
    base_digest: BASE,
    harness: "claude-code",
    version: "2.1.282",
    revision: "3",
    ...(lsp ? { lsp } : {}),
  });
  const manifest = (c: ReturnType<typeof cfg>, i: ImageFacts) =>
    resolveManifest(
      "harness",
      c,
      runtimeFacts(c, i, claudeCodeAdapter, catalog, {
        al: { hash: "1".repeat(64), tools: [] },
      }),
    );
  // Plain arm: the installed build is recorded, LSP stays off.
  const plain = await manifest(cfg("cc-plain", {}), img({ al }));
  assertEquals(plain.lsp, []);
  assertEquals(plain.image, {
    digest: ID,
    base_digest: BASE,
    revision: "3",
    installed,
  });
  // LSP arm: the enabled entry and the installed block both carry it.
  const on = await manifest(cfg("cc-lsp", { lsp: ["al"] }), img({ al }));
  assertEquals(on.lsp, [{ name: "al", ...al }]);
  assertEquals(on.image.installed, installed);
  // A pre-M10-10 LSP image and an image without LSP: no installed key.
  const old = { version: al.version, tool_schema_hash: al.tool_schema_hash };
  for (const lsp of [{ al: old }, undefined]) {
    const m = await manifest(cfg("cc-plain", {}), img(lsp));
    assertEquals(m.image, { digest: ID, base_digest: BASE, revision: "3" });
  }
});

Deno.test("install-lsp.ps1 (M10-10 r2): the wrapper exes join the exe manifest (Add-Member) before Assert-ExeManifest checks it", async () => {
  const code = (await Deno.readTextFile(
    "harness/images/claude-code/lsp/install-lsp.ps1",
  )).split(/\r?\n/).filter((l) => !l.trimStart().startsWith("#"));
  const at = (s: string) => code.findIndex((l) => l.includes(s));
  const add =
    "Add-Member -InputObject $def.exes -NotePropertyName ('al-language-server-go-windows\\bin\\' + $name) -NotePropertyValue $wrapperExes[$name]";
  assert(at(add) >= 0, `install-lsp.ps1 lacks: ${add}`);
  assert(at(add) < at("Assert-ExeManifest 'C:\\cg-lsp' $def.exes"));
});

// ---- H-03: Claude Code tracks the newest release ----

/** An untracked v1 image (r2, 2.1.282) carrying the MCP labels a config needs. */
async function v1Manifest(id: string) {
  const cfg = await loadConfig("harness", id);
  const defs = await serverDefinitions(".", cfg.components);
  const image: ImageFacts = {
    digest: ID,
    base_digest: BASE,
    harness: "claude-code",
    version: "2.1.282",
    revision: "2",
    mcp: Object.fromEntries(
      Object.entries(defs).map((
        [n, d],
      ) => [n, { version: d.version!, tool_schema_hash: d.hash }]),
    ),
  };
  return await resolveManifest(
    "harness",
    cfg,
    runtimeFacts(
      cfg,
      image,
      claudeCodeAdapter,
      await readCatalog("site/catalog"),
      defs,
    ),
  );
}

Deno.test("H-03 golden: the v1 cc-sonnet configs resolve to the manifest hashes of master 03261fdc", async () => {
  const got: Record<string, string> = {};
  for (const id of ["cc-sonnet-plain", "cc-sonnet-mcp", "cc-sonnet-skills"]) {
    const m = await v1Manifest(id);
    assertEquals(m.harness_version, "2.1.282", id);
    assertEquals(Object.hasOwn(m.image, "package"), false, id);
    got[id] = await manifestHash(m);
  }
  assertEquals(got, {
    "cc-sonnet-plain":
      "f49c1b2f72ea42f2d650603fe0e3ca779f11f186e0c5252382ef1cff42aef971",
    "cc-sonnet-mcp":
      "dc1eb8d7612903a7669b9cb2723fcab462ae4a8f0df9c79afb7a0cbff04f957d",
    "cc-sonnet-skills":
      "bde2be08e57ce178c978bee62b59a77b10f7679be79152c16260a85bf8752d43",
  });
});

Deno.test("resolveClaudeCode (H-03): the registry's latest document and the platform document, verified; build args and labels", async () => {
  const calls: { url: string; init?: RequestInit | undefined }[] = [];
  const r = await resolveClaudeCode(ccFetch({ calls }));
  assertEquals(r, CC_REL);
  assertEquals(calls.map((c) => c.url), [CC_MAIN_URL, ccWinUrl()]);
  for (const c of calls) assertEquals(c.init?.redirect, "error");
  const args = claudeCodeArgs(r);
  for (
    const a of [
      `CLAUDE_CODE_VERSION=${r.version}`,
      `CLAUDE_CODE_URL=${r.main.url}`,
      `CLAUDE_CODE_INTEGRITY=${r.main.integrity}`,
      `CLAUDE_CODE_WIN_URL=${r.win32_x64.url}`,
      `CLAUDE_CODE_WIN_INTEGRITY=${r.win32_x64.integrity}`,
    ]
  ) {
    assertEquals(args[args.indexOf(a) - 1], "--build-arg", a);
  }
  for (const [k, v] of Object.entries(ccLabels())) {
    assertEquals(args[args.indexOf(`${k}=${v}`) - 1], "--label", k);
  }
});

Deno.test("resolveClaudeCode (H-03): fails closed on transport, status and every document check", async () => {
  const main = ccMainDoc();
  const win = ccWinDoc();
  const dist = main["dist"] as Record<string, unknown>;
  const wdist = win["dist"] as Record<string, unknown>;
  const cases: [string, Parameters<typeof ccFetch>[0], string][] = [
    ["main 404", { status: { [CC_MAIN_URL]: 404 } }, "HTTP 404"],
    ["win 500", { status: { [ccWinUrl()]: 500 } }, "HTTP 500"],
    ["not json", { main: "<html>" }, "registry.npmjs.org"],
    ["prerelease", { main: { ...main, version: "2.1.297-beta.1" } }, "version"],
    ["name", { main: { ...main, name: "@evil/claude-code" } }, "name"],
    ["deps", { main: { ...main, dependencies: { x: "^1" } } }, "dependencies"],
    ["bin", { main: { ...main, bin: { claude: "cli.js" } } }, "bin"],
    [
      "platform pin",
      {
        main: {
          ...main,
          optionalDependencies: {
            "@anthropic-ai/claude-code-win32-x64": "2.1.295",
          },
        },
      },
      "optionalDependencies",
    ],
    [
      "sri",
      { main: { ...main, dist: { ...dist, integrity: "sha1-abc" } } },
      "integrity",
    ],
    [
      "tarball",
      {
        main: {
          ...main,
          dist: { ...dist, tarball: "https://evil.example/c.tgz" },
        },
      },
      "tarball",
    ],
    ["win os", { win: { ...win, os: ["linux"] } }, "os"],
    ["win cpu", { win: { ...win, cpu: ["arm64"] } }, "cpu"],
    [
      "win scripts",
      { win: { ...win, scripts: { postinstall: "x" } } },
      "scripts",
    ],
    ["win deps", { win: { ...win, dependencies: { y: "1" } } }, "dependencies"],
    ["win version", { win: { ...win, version: "2.1.295" } }, "version"],
    [
      "win sri",
      { win: { ...win, dist: { ...wdist, integrity: "sha512-x" } } },
      "integrity",
    ],
    [
      "win tarball",
      {
        win: {
          ...win,
          dist: { ...wdist, tarball: CC_REL.main.url },
        },
      },
      "tarball",
    ],
  ];
  for (const [name, o, msg] of cases) {
    const err = await assertRejects(
      () => resolveClaudeCode(ccFetch(o)),
      ConfigurationError,
      undefined,
      name,
    );
    assertStringIncludes(err.message, msg, name);
  }
  await assertRejects(
    () => resolveClaudeCode(() => Promise.reject(new TypeError("offline"))),
    ConfigurationError,
    "offline",
  );
});

const CC_ID = `sha256:${"c".repeat(64)}`;
const ccImageLabels = (over: Record<string, string> = {}) => ({
  ...LABELS,
  "centralgauge.harness.revision": "3",
  ...ccLabels(),
  ...over,
});

Deno.test("imageFacts (H-03): track and package labels go together, are strictly parsed and agree with the version label and the shipped resolved file", async () => {
  const d = new FakeDocker();
  d.addImage("ok", CC_ID, ccImageLabels());
  d.shipFile(CC_ID, CLAUDE_CODE_RESOLVED, ccResolvedJson());
  const f = await imageFacts(d, "ok", "HOST1");
  assertEquals(f.version, CC_REL.version);
  assertEquals(f.package, {
    name: "@anthropic-ai/claude-code",
    version: CC_REL.version,
    track: "npm-latest",
    integrity: {
      main: CC_REL.main.integrity,
      win32_x64: CC_REL.win32_x64.integrity,
    },
  });
  // A dry run (no owner) reads nothing.
  const before = d.reads.length;
  assertEquals((await imageFacts(d, "ok", null)).package, f.package);
  assertEquals(d.reads.length, before);
  // An untracked image has no package key at all.
  d.addImage("v1", ID, LABELS);
  assertEquals(
    Object.hasOwn(await imageFacts(d, "v1", "HOST1"), "package"),
    false,
  );

  const P = "centralgauge.harness.package";
  const T = "centralgauge.harness.track";
  const bad: [string, Record<string, string>, string][] = [
    ["track only", { [P]: "" }, "go together"],
    ["package only", { [T]: "" }, "go together"],
    ["track word", { [T]: "npm-stable" }, T],
    ["package name", {
      [P]:
        `@evil/claude-code@${CC_REL.version} ${CC_REL.main.integrity} ${CC_REL.win32_x64.integrity}`,
    }, P],
    ["package sri", {
      [P]:
        `@anthropic-ai/claude-code@${CC_REL.version} sha512-x ${CC_REL.win32_x64.integrity}`,
    }, P],
    ["package extra", {
      [P]: `${ccLabels()[P]} more`,
    }, P],
    ["version mismatch", {
      "centralgauge.harness.version": "2.1.295",
    }, "2.1.295"],
  ];
  for (const [name, over, msg] of bad) {
    const labels: Record<string, string> = ccImageLabels(over);
    for (const [k, v] of Object.entries(over)) if (v === "") delete labels[k];
    const id = `sha256:${
      String(bad.findIndex((b) => b[0] === name)).padStart(64, "0")
    }`;
    d.addImage(name, id, labels);
    d.shipFile(id, CLAUDE_CODE_RESOLVED, ccResolvedJson());
    const err = await assertRejects(
      () => imageFacts(d, name, null),
      ConfigurationError,
      undefined,
      name,
    );
    assertStringIncludes(err.message, msg, name);
  }
  // The shipped resolved file must agree with the labels (owner read only).
  const shipped: [string, string | null, string][] = [
    ["missing", null, "cannot read"],
    ["version", ccResolvedJson({ version: "2.1.295" }), "version"],
    [
      "integrity",
      ccResolvedJson({
        packages: {
          "@anthropic-ai/claude-code": {
            tarball: CC_REL.main.url,
            integrity: CC_REL.win32_x64.integrity,
          },
          "@anthropic-ai/claude-code-win32-x64": CC_REL.win32_x64,
        },
      }),
      "@anthropic-ai/claude-code",
    ],
    [
      "exe hash",
      ccResolvedJson({ claude_exe_sha256: "x" }),
      "claude_exe_sha256",
    ],
    ["method", ccResolvedJson({ install_method: "online" }), "install_method"],
  ];
  for (const [i, [name, text, msg]] of shipped.entries()) {
    const id = `sha256:${String(90 + i).padStart(64, "0")}`;
    d.addImage(`r-${name}`, id, ccImageLabels());
    if (text !== null) d.shipFile(id, CLAUDE_CODE_RESOLVED, text);
    const err = await assertRejects(
      () => imageFacts(d, `r-${name}`, "HOST1"),
      ConfigurationError,
      undefined,
      name,
    );
    assertStringIncludes(err.message, msg, name);
  }
});

const ccConfig = (over: Record<string, unknown> = {}) =>
  HarnessConfigSchema.parse({
    id: "cc-latest",
    harness: "claude-code",
    harness_version: "latest",
    image_revision: "3",
    models: { main: "anthropic/claude-sonnet-5" },
    limits: { timeout_min: 30, max_budget_usd: 5 },
    ...over,
  });
const ccImage = (over: Partial<ImageFacts> = {}): ImageFacts => ({
  digest: CC_ID,
  base_digest: BASE,
  harness: "claude-code",
  version: CC_REL.version,
  revision: "3",
  package: {
    name: "@anthropic-ai/claude-code",
    version: CC_REL.version,
    track: "npm-latest",
    integrity: {
      main: CC_REL.main.integrity,
      win32_x64: CC_REL.win32_x64.integrity,
    },
  },
  ...over,
});

Deno.test("runtimeFacts (H-03): a latest config needs a tracked image, a concrete one an untracked image; the resolved version and package flow on", () => {
  const f = runtimeFacts(ccConfig(), ccImage(), claudeCodeAdapter, catalog);
  assertEquals(f.harness_version, CC_REL.version);
  assertEquals(f.image.package, ccImage().package);
  const { package: _p, ...untracked } = ccImage();
  assertThrows(
    () => runtimeFacts(ccConfig(), untracked, claudeCodeAdapter, catalog),
    ConfigurationError,
    "has no resolved Claude Code version",
  );
  // A concrete config never runs on a tracked image, even at the same version.
  assertThrows(
    () =>
      runtimeFacts(
        ccConfig({ harness_version: CC_REL.version }),
        ccImage(),
        claudeCodeAdapter,
        catalog,
      ),
    ConfigurationError,
    "tracks npm-latest",
  );
  // The concrete path is unchanged: equal versions, untracked image.
  const v1 = runtimeFacts(
    ccConfig({ harness_version: "2.1.282", image_revision: "2" }),
    { ...untracked, version: "2.1.282", revision: "2" },
    claudeCodeAdapter,
    catalog,
  );
  assertEquals(v1.harness_version, "2.1.282");
  assertEquals(Object.hasOwn(v1.image, "package"), false);
});

Deno.test("runtimeFacts (H-03): a recorded (frozen) revision accepts exactly its digest, version and integrities", () => {
  const rec = {
    "3": {
      version: CC_REL.version,
      digest: CC_ID,
      integrity: {
        main: CC_REL.main.integrity,
        win32_x64: CC_REL.win32_x64.integrity,
      },
    },
  };
  const run = (image: ImageFacts, frozen = rec) =>
    runtimeFacts(ccConfig(), image, claudeCodeAdapter, catalog, {}, frozen);
  assertEquals(run(ccImage()).image.digest, CC_ID);
  assertThrows(
    () => run(ccImage({ digest: `sha256:${"9".repeat(64)}` })),
    ConfigurationError,
    "freeze record",
  );
  assertThrows(
    () =>
      run(ccImage(), {
        "3": {
          ...rec["3"],
          integrity: {
            ...rec["3"].integrity,
            main: CC_REL.win32_x64.integrity,
          },
        },
      }),
    ConfigurationError,
    "freeze record",
  );
  // A dev revision is never in the record.
  assertEquals(
    runtimeFacts(
      ccConfig({ image_revision: "3-dev-H-03" }),
      ccImage({ revision: "3-dev-H-03" }),
      claudeCodeAdapter,
      catalog,
      {},
      rec,
    ).image.revision,
    "3-dev-H-03",
  );
  assertEquals(
    FROZEN_CLAUDE_CODE,
    {},
    "nothing is frozen until r3 is accepted",
  );
});

Deno.test("resolveManifest (H-03): a latest arm records the resolved version and the package; latest is never stored", async () => {
  const cfg = ccConfig();
  const facts = runtimeFacts(cfg, ccImage(), claudeCodeAdapter, catalog);
  const m = await resolveManifest("harness", cfg, facts);
  assertEquals(m.harness_version, CC_REL.version);
  assertEquals(m.image, {
    digest: CC_ID,
    base_digest: BASE,
    revision: "3",
    package: ccImage().package,
  });
  const { harness_version: _h, ...noVersion } = facts;
  await assertRejects(
    () => resolveManifest("harness", cfg, noVersion),
    ConfigurationError,
    "latest",
  );
});
