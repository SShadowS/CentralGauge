import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { ConfigurationError } from "../../../src/errors.ts";
import { claudeCodeAdapter } from "../../../src/harness/adapters/claude-code.ts";
import { HarnessConfigSchema } from "../../../src/harness/config.ts";
import { hashJson } from "../../../src/harness/hash.ts";
import {
  AL_TOOLS_SHIPPED,
  hasBaseLayers,
  imageFacts,
  imageTag,
  mcpDefinitions,
  mcpLabel,
  runtimeFacts,
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
