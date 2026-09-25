import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { ConfigurationError } from "../../../src/errors.ts";
import { claudeCodeAdapter } from "../../../src/harness/adapters/claude-code.ts";
import { HarnessConfigSchema } from "../../../src/harness/config.ts";
import { hashJson } from "../../../src/harness/hash.ts";
import {
  hasBaseLayers,
  imageFacts,
  imageTag,
  mcpLabel,
  runtimeFacts,
} from "../../../src/harness/images.ts";
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
    () => imageFacts(d, imageTag("claude-code", "2.1.282")),
    ConfigurationError,
    "images build",
  );
  d.addImage("centralgauge/harness-claude-code:2.1.282", ID, LABELS);
  assertEquals(
    (await imageFacts(d, "centralgauge/harness-claude-code:2.1.282")).digest,
    ID,
  );
  d.addImage("centralgauge/harness-claude-code:9", `sha256:${"9".repeat(64)}`, {
    "centralgauge.harness": "claude-code",
  });
  await assertRejects(
    () => imageFacts(d, "centralgauge/harness-claude-code:9"),
    ConfigurationError,
    "label",
  );
  d.addImage("centralgauge/harness-claude-code:8", `sha256:${"8".repeat(64)}`, {
    ...LABELS,
    "centralgauge.harness.base_digest": "sha256:img",
  });
  await assertRejects(
    () => imageFacts(d, "centralgauge/harness-claude-code:8"),
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
  assertEquals(
    runtimeFacts(withMcp, { ...image, mcp }, claudeCodeAdapter, catalog)
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
  assertEquals(Object.keys((await imageFacts(d, "x")).mcp ?? {}), [
    "al-tools",
  ]);
  d.addImage("y", `sha256:${"d".repeat(64)}`, {
    ...LABELS,
    "centralgauge.mcp.al-tools": "only-one-part",
  });
  await assertRejects(
    () => imageFacts(d, "y"),
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
  assertEquals((await imageFacts(d, "none")).mcp, {});
  d.addImage("ok", ID, { ...LABELS, "centralgauge.mcp.al-tools": value });
  assertEquals((await imageFacts(d, "ok")).mcp, {
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
      () => imageFacts(d, ref!),
      ConfigurationError,
      `image ${ref}`,
    );
    assert(err.message.includes(k!), err.message);
  }
});
