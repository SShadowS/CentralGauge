import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { ConfigurationError } from "../../../src/errors.ts";
import { claudeCodeAdapter } from "../../../src/harness/adapters/claude-code.ts";
import { HarnessConfigSchema } from "../../../src/harness/config.ts";
import {
  hasBaseLayers,
  imageFacts,
  imageTag,
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

Deno.test("runtimeFacts: native settings from the catalog; MCP and LSP refused until M2", () => {
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
  assertEquals([f.image.digest, f.backend_version, f.provider_routes["main"]], [
    ID,
    "cg-al-backend@1",
    "anthropic:first-party-oauth",
  ]);
  assertThrows(
    () =>
      runtimeFacts(
        { ...cfg, components: { ...cfg.components, mcp: ["al-tools"] } },
        image,
        claudeCodeAdapter,
        catalog,
      ),
    ConfigurationError,
    "M2",
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
});
