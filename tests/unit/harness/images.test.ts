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
  AL_LSP_SHIPPED,
  AL_TOOLS_SHIPPED,
  hasBaseLayers,
  imageFacts,
  imageTag,
  lspLabel,
  mcpDefinitions,
  mcpLabel,
  runtimeFacts,
  serverDefinitions,
} from "../../../src/harness/images.ts";
import {
  imageReadCreateArgs,
  OWNER_LABEL,
  SANDBOX_PREFIX,
} from "../../../src/harness/sandbox.ts";
import { FakeDocker } from "./fake-docker.ts";

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
  assertEquals(
    d.pins.wrapper.map((s: { release: string }) => s.release),
    ["v1.18.3", "v1.18.2"],
  );
  assertEquals(
    d.pins.wrapper.map((s: { files: object }) => Object.keys(s.files)),
    [["al-lsp-wrapper.exe"], ["al-call-hierarchy.exe"]],
  );
  for (
    const s of d.pins.wrapper as {
      release: string;
      url: string;
      algorithm: string;
      hash: string;
      files: Record<string, string>;
    }[]
  ) {
    assertEquals(
      s.url,
      `https://github.com/SShadowS/al-lsp-for-agents/releases/download/${s.release}/al-lsp-wrapper-windows-x64.zip`,
    );
    assertEquals(s.algorithm, "SHA256");
    assertMatch(s.hash, H256);
    for (const h of Object.values(s.files)) assertMatch(h, H256);
  }
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
  const [w3, w2] = d.pins.wrapper;
  assertEquals(
    w3.hash,
    "92859e899990e24b7b7ab7360280260ec3e00bde9321c46a8a7e9cf97d00df98",
  );
  assertEquals(
    w3.files,
    {
      "al-lsp-wrapper.exe":
        "d5c529bb116fd0ba7f72a0fa9b4f08ff575ae2a3ac6aaf2c33e290f9165fe210",
    },
  );
  assertEquals(
    w2.hash,
    "85a1c77796ee5738fe02939398bc48473cbb411a3c2c7e76150dcc40fb6ef02e",
  );
  assertEquals(
    w2.files,
    {
      "al-call-hierarchy.exe":
        "e85e25bcb9633635a22d36bf28eb1a234bc2ef2f43cac8b23110933d517b4563",
    },
  );
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
      // wrapper archive shape and per-exe hash check
      "if ($found.Count -ne 1) { throw (",
      'if (Test-Path -LiteralPath "$plugin\\bin\\$($p.Name)") { throw (',
      "if ($h -ne $p.Value) { throw ('hash mismatch for ' + $p.Name + ' (' + $src.release",
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
  assertEquals(d.exes, {
    "al\\bin\\microsoft.dynamics.nav.editorservices.host.exe":
      "465268879ba69d0d885939d16d5a3e47ac97b2e8aa68d6b27a5c573545d59ec9",
    "al-language-server-go-windows\\bin\\al-call-hierarchy.exe":
      "e85e25bcb9633635a22d36bf28eb1a234bc2ef2f43cac8b23110933d517b4563",
    "al-language-server-go-windows\\bin\\al-lsp-wrapper.exe":
      "d5c529bb116fd0ba7f72a0fa9b4f08ff575ae2a3ac6aaf2c33e290f9165fe210",
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
      'Assert-ZipSafe "$tmp\\wrapper$n.zip"',
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
    at('Assert-ZipSafe "$tmp\\wrapper$n.zip"') <
      at('Expand-Archive -LiteralPath "$tmp\\wrapper$n.zip"'),
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
  d.addImage("ok", ID, { ...LABELS, [k]: v });
  d.shipFile(ID, AL_LSP_SHIPPED, shipped);
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
