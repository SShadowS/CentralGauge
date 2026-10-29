import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { ConfigurationError, ValidationError } from "../../../src/errors.ts";
import { readCatalog } from "../../../src/ingest/catalog/read.ts";
import {
  claudeCodeDerivedNative,
  claudeCodeHarnessNative,
} from "../../../src/harness/adapters/claude-code.ts";
import { adapterFor } from "../../../src/harness/adapters/mod.ts";
import { piHarnessNative } from "../../../src/harness/adapters/pi.ts";
import { loadExperiment, type VaryKey } from "../../../src/harness/config.ts";
import { runtimeFacts } from "../../../src/harness/images.ts";
import {
  type CampaignRecords,
  validateCampaignRecords,
} from "../../../src/harness/integrity.ts";
import {
  assertVaryHolds,
  manifestHash,
  type ResolvedManifest,
  resolveManifest,
} from "../../../src/harness/manifest.ts";
import {
  type CampaignRecord,
  experimentHash,
  planBlocks,
} from "../../../src/harness/records.ts";
import { campaign, execution, H, judgment, manifest } from "./fixtures.ts";

async function scenario(): Promise<CampaignRecords> {
  const c = await campaign();
  const first = execution(c, { arm: "plain" }, {
    termination: "setup_failed",
    did_work: false,
    workspace_hash: null,
  });
  const retry = execution(c, {
    arm: "plain",
    attempt: 2,
    run_kind: "auto_retry",
    retry_of: first.id,
  });
  const other = execution(c, { task: "HX-002", arm: "skills" });
  return {
    campaign: c,
    executions: [first, retry, other],
    artifacts: [{
      v: 1,
      execution_id: retry.id,
      workspace_hash: retry.workspace_hash!,
      stored_path: `workspaces/${retry.workspace_hash}`,
      created_at: "2026-10-01T10:12:00.000Z",
    }],
    judgments: [judgment(c, retry, true), judgment(c, other, false)],
  };
}

async function problems(r: CampaignRecords): Promise<string[]> {
  try {
    await validateCampaignRecords(r);
    return [];
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    return err.errors;
  }
}

Deno.test("validateCampaignRecords: a consistent campaign passes", async () => {
  assertEquals(await problems(await scenario()), []);
});

Deno.test("validateCampaignRecords: tampered stored hashes are caught", async () => {
  const r = await scenario();
  const c = r.campaign;
  const broken = {
    ...c,
    experiment_hash: H("0"),
    task_set: { ...c.task_set, identity: H("0") },
    arms: [{ ...c.arms[0]!, manifest_hash: H("0") }, c.arms[1]!],
  };
  const p = await problems({ ...r, campaign: broken });
  assertEquals(p.length >= 3, true);
  assertStringIncludes(p.join("\n"), "experiment_hash");
  assertStringIncludes(p.join("\n"), "task_set.identity");
  assertStringIncludes(p.join("\n"), "arm plain: manifest_hash");
});

Deno.test("validateCampaignRecords: a variant outside vary is caught", async () => {
  const r = await scenario();
  const m = manifest("skills", {
    skills: { path: "bundles/s", hash: H("5"), files: [] },
    mcp: [{ name: "al-tools", version: "1", tool_schema_hash: "s" }],
  });
  const arms = [r.campaign.arms[0]!, {
    config_id: "skills",
    manifest: m,
    manifest_hash: await manifestHash(m),
  }];
  const p = await problems({ ...r, campaign: { ...r.campaign, arms } });
  assertStringIncludes(p.join("\n"), "outside vary [skills]: mcp");
});

Deno.test("validateCampaignRecords: executions that do not belong are caught", async () => {
  const r = await scenario();
  const [first, retry, other] = r.executions as [
    typeof r.executions[0],
    typeof r.executions[0],
    typeof r.executions[0],
  ];
  const cases: Array<[string, typeof first]> = [
    ["visible-input hash", { ...other, task_visible_hash: H("9") }],
    ["is not at position", {
      ...other,
      order_in_block: 1 - other.order_in_block,
    }],
    ["is not (HX-002, 1)", { ...other, block: first.block }],
    ["belongs to campaign", {
      ...other,
      campaign_id: "00000000-0000-4000-8000-0000000000ff",
    }],
    ["arm_manifest_hash", { ...other, arm_manifest_hash: H("0") }],
    ["component limits differs", {
      ...other,
      manifest: {
        ...other.manifest,
        limits: { timeout_min: 99, max_budget_usd: 5 },
      },
    }],
    // A tighter limit than the task allows is caught too (exact match).
    ["component limits differs", {
      ...other,
      manifest: {
        ...other.manifest,
        limits: { timeout_min: 1, max_budget_usd: 5 },
      },
    }],
  ];
  for (const [needle, bad] of cases) {
    const p = await problems({
      ...r,
      executions: [first, retry, bad],
      judgments: r.judgments.filter((j) => j.execution_id !== other.id),
    });
    assertStringIncludes(p.join("\n"), needle);
  }
  const dup = { ...retry, id: "00000000-0000-4000-9000-0000000000ff" };
  assertStringIncludes(
    (await problems({ ...r, executions: [...r.executions, dup] })).join("\n"),
    "duplicate attempt 2",
  );
  const orphan = { ...retry, retry_of: other.id };
  assertStringIncludes(
    (await problems({
      ...r,
      executions: [first, orphan, other],
      judgments: [],
    }))
      .join("\n"),
    "retry_of is not an execution of",
  );
});

Deno.test("validateCampaignRecords: judgments and artifacts must match their execution", async () => {
  const r = await scenario();
  const [j1, j2] = r.judgments as [
    typeof r.judgments[0],
    typeof r.judgments[0],
  ];
  const p = await problems({
    ...r,
    judgments: [{ ...j1, task_id: "HX-002" }, {
      ...j2,
      workspace_hash: H("7"),
    }],
    artifacts: [{ ...r.artifacts[0]!, workspace_hash: H("8") }],
  });
  const text = p.join("\n");
  assertStringIncludes(text, "task HX-002 != HX-001");
  assertStringIncludes(text, "judged a different workspace");
  assertStringIncludes(text, "workspace hash differs");
});

Deno.test("validateCampaignRecords: throws one ValidationError", async () => {
  const r = await scenario();
  await assertRejects(
    () =>
      validateCampaignRecords({
        ...r,
        campaign: { ...r.campaign, experiment_hash: H("0") },
      }),
    ValidationError,
    "Inconsistent records",
  );
});

// H-23 owner ruling 2026-10-17: a task tightens only the budget; the time limit stays the arm's,
// so an execution that kept a task's lower timeout_min is a mismatch.
Deno.test("validateCampaignRecords: task-effective limits are the only allowed tightening (budget only; the time limit is the arm's)", async () => {
  const r = await scenario();
  const tasks_meta = r.campaign.tasks_meta.map((t) =>
    t.id === "HX-002"
      ? { ...t, limits: { timeout_min: 20, max_budget_usd: 2 } }
      : t
  );
  const campaign = { ...r.campaign, tasks_meta };
  const other = r.executions[2]!;
  const exact = {
    ...other,
    manifest: {
      ...other.manifest,
      limits: { ...other.manifest.limits, max_budget_usd: 2 },
    },
  };
  const taskTimeout = {
    ...exact,
    manifest: {
      ...exact.manifest,
      limits: { timeout_min: 20, max_budget_usd: 2 },
    },
  };
  assert(other.manifest.limits.timeout_min !== 20);
  assertStringIncludes(
    (await problems({
      ...r,
      campaign,
      executions: [r.executions[0]!, r.executions[1]!, taskTimeout],
      judgments: [],
    })).join("\n"),
    "component limits differs",
  );
  assertEquals(
    await problems({
      ...r,
      campaign,
      executions: [r.executions[0]!, r.executions[1]!, exact],
      judgments: [],
    }),
    [],
  );
  assertStringIncludes(
    (await problems({ ...r, campaign, judgments: [] })).join("\n"),
    "component limits differs",
  );
});

Deno.test("validateCampaignRecords: retries must be eligible and used once", async () => {
  const r = await scenario();
  const c = r.campaign;
  const done = execution(c, { task: "HX-002", arm: "plain" });
  const afterDone = execution(c, {
    task: "HX-002",
    arm: "plain",
    attempt: 2,
    run_kind: "auto_retry",
    retry_of: done.id,
  });
  const setup = {
    termination: "setup_failed" as const,
    did_work: false,
    workspace_hash: null,
  };
  const [first, retry] = r.executions as [typeof done, typeof done];
  const retryAgain = execution(c, {
    attempt: 3,
    run_kind: "auto_retry",
    retry_of: retry.id,
  });
  const text = (await problems({
    ...r,
    executions: [first, { ...retry, ...setup }, retryAgain, done, afterDone],
    judgments: [],
    artifacts: [],
  })).join("\n");
  assertStringIncludes(text, "of an execution that ended completed");
  assertStringIncludes(text, "the one retry was used");
});

Deno.test("validateCampaignRecords: a judgment's scorer fingerprint must match its versions", async () => {
  const r = await scenario();
  const [j1, j2] = r.judgments as [
    typeof r.judgments[0],
    typeof r.judgments[0],
  ];
  const p = await problems({
    ...r,
    judgments: [{ ...j1, scorer_versions: { build: "2" } }, j2],
  });
  assertStringIncludes(p.join("\n"), "scorer_fingerprint does not match");
});

// Beyond the plan: checks deferred from M1-07 and gaps found in review.

Deno.test("validateCampaignRecords: blocks must be the seeded plan", async () => {
  const r = await scenario();
  const c = r.campaign;
  const b0 = c.blocks[0]!;
  const swapped = [
    { ...b0, order: [...b0.order].reverse() },
    ...c.blocks.slice(1),
  ];
  assertStringIncludes(
    (await problems({ ...r, campaign: { ...c, blocks: swapped } })).join("\n"),
    "block 0 differs from planBlocks",
  );
});

Deno.test("validateCampaignRecords: time runs forward, compared as instants", async () => {
  const r = await scenario();
  const [first, retry, other] = r.executions as [
    typeof r.executions[0],
    typeof r.executions[0],
    typeof r.executions[0],
  ];
  // Equal instants at different precision: a string comparison would flag it.
  const same = {
    ...other,
    started_at: "2026-10-01T10:11:00Z",
    ended_at: "2026-10-01T10:11:00.000Z",
  };
  assertEquals(
    await problems({ ...r, executions: [first, retry, same] }),
    [],
  );
  const backwards = { ...other, ended_at: "2026-10-01T10:00:59.999Z" };
  const j = { ...r.judgments[0]!, ended_at: "2026-10-01T10:11:59Z" };
  const text = (await problems({
    ...r,
    executions: [first, retry, backwards],
    judgments: [j, r.judgments[1]!],
  })).join("\n");
  assertStringIncludes(text, `execution ${other.id}: ended_at is before`);
  assertStringIncludes(text, `judgment ${j.id}: ended_at is before`);
});

Deno.test("validateCampaignRecords: time order is exact below a millisecond", async () => {
  const r = await scenario();
  const [first, retry, other] = r.executions as [
    typeof r.executions[0],
    typeof r.executions[0],
    typeof r.executions[0],
  ];
  // Same millisecond: Date.parse would call these equal.
  const backwards = {
    ...other,
    started_at: "2026-10-01T10:11:00.0009Z",
    ended_at: "2026-10-01T10:11:00.0001Z",
  };
  assertStringIncludes(
    (await problems({ ...r, executions: [first, retry, backwards] })).join(
      "\n",
    ),
    `execution ${other.id}: ended_at is before`,
  );
});

Deno.test("validateCampaignRecords: a retry is its parent's attempt + 1 in the same cell", async () => {
  const r = await scenario();
  const [first, retry, other] = r.executions as [
    typeof r.executions[0],
    typeof r.executions[0],
    typeof r.executions[0],
  ];
  assertStringIncludes(
    (await problems({
      ...r,
      executions: [first, { ...retry, attempt: 3 }, other],
    }))
      .join("\n"),
    "retry_of is not the previous attempt",
  );
  const twin = execution(r.campaign, {
    arm: "plain",
    attempt: 3,
    run_kind: "auto_retry",
    retry_of: first.id,
  });
  assertStringIncludes(
    (await problems({ ...r, executions: [first, retry, twin, other] })).join(
      "\n",
    ),
    `retry_of ${first.id} is not a unique link`,
  );
});

Deno.test("validateCampaignRecords: an execution manifest names its arm and rules", async () => {
  const r = await scenario();
  const [first, retry, other] = r.executions as [
    typeof r.executions[0],
    typeof r.executions[0],
    typeof r.executions[0],
  ];
  for (
    const [needle, manifest] of [
      ["manifest config_id plain != arm skills", {
        ...other.manifest,
        config_id: "plain",
      }],
      ["not comparable", { ...other.manifest, rules: "hr0" }],
    ] as const
  ) {
    const p = await problems({
      ...r,
      executions: [first, retry, { ...other, manifest }],
    });
    assertStringIncludes(p.join("\n"), needle);
  }
});

Deno.test("validateCampaignRecords: duplicate ids and associations are caught", async () => {
  const r = await scenario();
  const [first, retry, other] = r.executions as [
    typeof r.executions[0],
    typeof r.executions[0],
    typeof r.executions[0],
  ];
  const [j1, j2] = r.judgments as [
    typeof r.judgments[0],
    typeof r.judgments[0],
  ];
  const text = (await problems({
    ...r,
    executions: [first, retry, other, {
      ...execution(r.campaign, { task: "HX-002", arm: "plain" }),
      id: other.id,
    }],
    judgments: [j1, { ...j2, id: j1.id }],
    artifacts: [r.artifacts[0]!, r.artifacts[0]!],
  })).join("\n");
  assertStringIncludes(text, `duplicate execution id ${other.id}`);
  assertStringIncludes(text, `duplicate judgment id ${j1.id}`);
  assertStringIncludes(
    text,
    `more than one artifact for execution ${retry.id}`,
  );
});

Deno.test("validateCampaignRecords: record shapes are validated, not trusted", async () => {
  const r = await scenario();
  const other = r.executions[2]!;
  const p = await problems({
    ...r,
    executions: [r.executions[0]!, r.executions[1]!, { ...other, attempt: 0 }],
  });
  assertStringIncludes(p.join("\n"), `execution ${other.id}: attempt:`);
});

Deno.test("validateCampaignRecords: arm order for the plan comes from the experiment", async () => {
  const r = await scenario();
  const c = r.campaign;
  // Stored arm order is not hashed; re-deriving from it would accept this.
  const swapped = {
    ...c,
    arms: [...c.arms].reverse(),
    blocks: planBlocks(["HX-001", "HX-002"], 1, ["skills", "plain"], c.seed),
  };
  assertStringIncludes(
    (await problems({
      campaign: swapped,
      executions: [],
      artifacts: [],
      judgments: [],
    }))
      .join("\n"),
    "differs from planBlocks",
  );
});

Deno.test("validateCampaignRecords: artifacts and judgments of unknown executions", async () => {
  const r = await scenario();
  const ghost = "00000000-0000-4000-9000-0000000000ee";
  const j = { ...r.judgments[0]!, execution_id: ghost };
  const text = (await problems({
    ...r,
    artifacts: [{ ...r.artifacts[0]!, execution_id: ghost }],
    judgments: [j, r.judgments[1]!],
  })).join("\n");
  assertStringIncludes(text, `artifact for unknown execution ${ghost}`);
  assertStringIncludes(text, `judgment ${j.id}: unknown execution ${ghost}`);
});

Deno.test("validateCampaignRecords: a fail with a null scorer is consistent; unscored next to a false is not", async () => {
  const r = await scenario();
  const scorers = [
    { name: "build", passed: true, tests: [] },
    { name: "pass_to_pass", passed: null, tests: [] },
    { name: "fail_to_pass", passed: false, tests: [] },
  ];
  const j = r.judgments[1]!;
  assertEquals(
    await problems({
      ...r,
      judgments: [r.judgments[0]!, { ...j, scorers, verdict: "fail" }],
    }),
    [],
  );
  const bad = await problems({
    ...r,
    judgments: [r.judgments[0]!, { ...j, scorers, verdict: "unscored" }],
  });
  assertStringIncludes(bad.join("\n"), "verdict");
});

Deno.test("validateCampaignRecords: a campaign mixing execution record versions is refused", async () => {
  const r = await scenario();
  const old = {
    ...r.executions[2]!,
    v: 1 as const,
    validity: { incomplete_telemetry: [], infra_exposed: false },
  };
  const text = (await problems({
    ...r,
    executions: [r.executions[0]!, r.executions[1]!, old],
  })).join("\n");
  assertStringIncludes(text, "mixes execution record versions");
  assertStringIncludes(text, r.executions[0]!.id);
  assertStringIncludes(text, old.id);
  // One version throughout (all v: 1) is consistent.
  const v1 = r.executions.map((e) => ({
    ...e,
    v: 1 as const,
    validity: { incomplete_telemetry: [], infra_exposed: false },
  }));
  assertEquals(await problems({ ...r, executions: v1 }), []);
});

// M5-01a: under vary [harness], each side's native settings may differ only
// by the keys its own adapter derives, with exactly the derived values.
const REPO = fromFileUrl(new URL("../../../", import.meta.url));

/** The real cc-vs-pi arms, resolved the way `harness run` resolves them. */
async function ccVsPi(
  edit: (m: ResolvedManifest) => ResolvedManifest = (m) => m,
  vary?: VaryKey[],
  /** Edit the baseline arm instead of the variant. */
  baseline = false,
): Promise<string[]> {
  const harnessRoot = join(REPO, "harness");
  const { experiment: exp, configs } = await loadExperiment(
    harnessRoot,
    "cc-vs-pi",
  );
  const experiment = vary ? { ...exp, vary } : exp;
  const catalog = await readCatalog(join(REPO, "site", "catalog"));
  const arms: CampaignRecord["arms"] = [];
  for (const config of configs) {
    const image = {
      digest: `sha256:${config.harness}`,
      base_digest: "sha256:base",
      harness: config.harness,
      version: config.harness_version,
      revision: config.image_revision ?? null,
    };
    const facts = runtimeFacts(
      config,
      image,
      adapterFor(config.harness),
      catalog,
    );
    let m = await resolveManifest(harnessRoot, config, facts);
    if ((config.id === experiment.baseline) === baseline) m = edit(m);
    arms.push({
      config_id: config.id,
      manifest_hash: await manifestHash(m),
      manifest: m,
    });
  }
  const c = await campaign();
  return await problems({
    campaign: {
      ...c,
      experiment,
      experiment_hash: await experimentHash(experiment),
      arms,
      blocks: planBlocks(
        c.task_set.tasks.map((t) => t.id),
        experiment.repeats,
        [experiment.baseline, ...experiment.variants],
        c.seed,
      ),
    },
    executions: [],
    artifacts: [],
    judgments: [],
  });
}

const native = (
  m: ResolvedManifest,
  f: (n: Record<string, unknown>) => Record<string, unknown>,
): ResolvedManifest => ({
  ...m,
  settings: { ...m.settings, native: f({ ...m.settings.native }) },
});

Deno.test("validateCampaignRecords: cc-vs-pi admits only adapter-derived native keys", async () => {
  // The real pair passes: disallowed_tools vs provider + pi_settings.
  assertEquals(await ccVsPi(), []);
});

Deno.test("validateCampaignRecords: cc-vs-pi refuses an extra native key", async () => {
  for (
    const f of [
      (n: Record<string, unknown>) => ({ ...n, extra: 1 }),
      // Another adapter's derived key is not this adapter's.
      (n: Record<string, unknown>) => ({ ...n, disallowed_tools: [] }),
    ]
  ) {
    assertStringIncludes(
      (await ccVsPi((m) => native(m, f))).join("\n"),
      "outside vary [harness, harness_version, models]: settings",
    );
  }
});

Deno.test("validateCampaignRecords: cc-vs-pi refuses a changed derived value", async () => {
  for (
    const f of [
      (n: Record<string, unknown>) => ({ ...n, provider: "anthropic" }),
      (n: Record<string, unknown>) => ({ ...n, pi_settings: {} }),
      (n: Record<string, unknown>) => {
        delete n["provider"];
        return n;
      },
      (n: Record<string, unknown>) => ({ ...n, api_models: { main: 1 } }),
      (n: Record<string, unknown>) => ({ ...n, api_models: {} }),
    ]
  ) {
    assertStringIncludes(
      (await ccVsPi((m) => native(m, f))).join("\n"),
      ": settings",
    );
  }
  // The baseline's derived value is checked too, not only the variant's.
  const text = (await ccVsPi(
    (m) => native(m, (n) => ({ ...n, disallowed_tools: ["X"] })),
    undefined,
    true,
  )).join(" ");
  assertStringIncludes(text, ": settings");
});

Deno.test("validateCampaignRecords: cc-vs-pi refuses a changed shared setting", async () => {
  const cases: [(m: ResolvedManifest) => ResolvedManifest, string][] = [
    [(m) => ({ ...m, limits: { ...m.limits, timeout_min: 60 } }), "limits"],
    [(m) => ({ ...m, instructions: null }), "instructions"],
    [
      (m) => ({
        ...m,
        settings: {
          requested: { thinking: "high" },
          native: m.settings.native,
        },
      }),
      "settings",
    ],
    [(m) => native(m, (n) => ({ ...n, thinking: "high" })), "settings"],
  ];
  for (const [edit, key] of cases) {
    assertStringIncludes((await ccVsPi(edit)).join("\n"), `models]: ${key}`);
  }
});

Deno.test("validateCampaignRecords: without harness in vary the native differences refuse", async () => {
  const text = (await ccVsPi(undefined, ["harness_version", "models"])).join(
    "\n",
  );
  assertStringIncludes(text, "outside vary [harness_version, models]");
  assertStringIncludes(text, "settings");
  // vary [harness] alone: api_models follows models, so settings still refuse.
  assertStringIncludes(
    (await ccVsPi(undefined, ["harness", "harness_version"])).join("\n"),
    "settings",
  );
});

/** A fixture campaign with its arms replaced by baseline `a`, variant `b`. */
async function pair(
  vary: VaryKey[],
  a: ResolvedManifest,
  b: ResolvedManifest,
): Promise<string[]> {
  const c = await campaign();
  const experiment = {
    ...c.experiment,
    baseline: a.config_id,
    variants: [b.config_id],
    vary,
  };
  return await problems({
    campaign: {
      ...c,
      experiment,
      experiment_hash: await experimentHash(experiment),
      arms: await Promise.all([a, b].map(async (m) => ({
        config_id: m.config_id,
        manifest_hash: await manifestHash(m),
        manifest: m,
      }))),
      blocks: planBlocks(
        c.task_set.tasks.map((t) => t.id),
        experiment.repeats,
        [a.config_id, b.config_id],
        c.seed,
      ),
    },
    executions: [],
    artifacts: [],
    judgments: [],
  });
}

Deno.test("validateCampaignRecords: vary [harness, models] refuses a model id that is not its slug's", async () => {
  // Same label on both sides; only the api model id behind it differs.
  const models = { main: "anthropic/model-a" };
  const cc = manifest("cc", {
    models,
    settings: {
      requested: {},
      native: { ...claudeCodeHarnessNative(), api_models: { main: "model-a" } },
    },
  });
  const pi = manifest("pi", {
    harness: "pi",
    models,
    settings: {
      requested: {},
      native: { ...piHarnessNative(), api_models: { main: "claude-opus-5" } },
    },
  });
  assertStringIncludes(
    (await pair(["harness", "models"], cc, pi)).join("\n"),
    "outside vary [harness, models]: settings",
  );
  const ok = manifest("pi", {
    ...pi,
    settings: {
      requested: {},
      native: { ...piHarnessNative(), api_models: { main: "model-a" } },
    },
  });
  assertEquals(await pair(["harness", "models"], cc, ok), []);
  // The real pair's baseline is checked against its slug the same way.
  assertStringIncludes(
    (await ccVsPi(
      (m) =>
        native(m, (n) => ({ ...n, api_models: { main: "claude-opus-5" } })),
      undefined,
      true,
    )).join("\n"),
    ": settings",
  );
});

Deno.test("validateCampaignRecords: vary [harness, mcp] keeps the MCP rule", async () => {
  const server = { name: "al-tools", version: "1", tool_schema_hash: "s" };
  const cc = (
    id: string,
    extra: Record<string, unknown> = {},
    mcp = [server],
  ) =>
    manifest(id, {
      mcp: extra["mcp"] ? mcp : [],
      settings: {
        requested: {},
        native: { ...claudeCodeHarnessNative(), ...extra },
      },
    });
  const tools = (t: string[]) => ({
    mcp: ["al-tools"],
    mcp_tools: { "al-tools": t },
  });
  // Same harness, MCP-only difference: passes as under vary [mcp].
  assertEquals(
    await pair(["harness", "mcp"], cc("plain"), cc("mcp", tools(["a"]))),
    [],
  );
  // A tool list changed on a server identical on both sides is not MCP-derived.
  assertStringIncludes(
    (await pair(
      ["harness", "mcp"],
      cc("a", tools(["a"])),
      cc("b", tools(["a", "b"])),
    )).join("\n"),
    "outside vary [harness, mcp]: settings",
  );
});

Deno.test("validateCampaignRecords: a campaign on a development image revision is refused (M9-16)", async () => {
  const c = await campaign();
  const onRevision = async (rev: string) => ({
    ...c,
    arms: await Promise.all(c.arms.map(async (a) => {
      const m = {
        ...a.manifest,
        image: { ...a.manifest.image, revision: rev },
      };
      return { ...a, manifest: m, manifest_hash: await manifestHash(m) };
    })),
  });
  const empty = { executions: [], artifacts: [], judgments: [] };
  // Same revision on both arms: vary holds, hashes match; only the dev label is wrong.
  assertEquals(
    await problems({ campaign: await onRevision("3"), ...empty }),
    [],
  );
  const p = await problems({
    campaign: await onRevision("3-dev-M9-16"),
    ...empty,
  });
  assertEquals(
    p,
    c.arms.map((a) =>
      `arm ${a.config_id}: development image revision 3-dev-M9-16 is not allowed in a campaign`
    ),
  );
});

Deno.test("validateCampaignRecords (H-07): a pre-H-07 cc-vs-pi campaign (six disallowed tools) stays valid; a web arm under vary [harness] is refused", async () => {
  const six = claudeCodeHarnessNative(true, true).disallowed_tools;
  const asClaude = (f: (m: ResolvedManifest) => ResolvedManifest) =>
  (
    m: ResolvedManifest,
  ) => m.harness === "claude-code" ? f(m) : m;
  const legacy = asClaude((m) =>
    native(m, (n) => ({ ...n, disallowed_tools: six }))
  );
  assertEquals(await ccVsPi(legacy), []);
  assertEquals(await ccVsPi(legacy, undefined, true), []);
  const webArm = asClaude((m) => ({
    ...native(m, (n) => ({ ...n, disallowed_tools: six })),
    settings: {
      requested: { ...m.settings.requested, web_tools: true },
      native: { ...m.settings.native, disallowed_tools: six },
    },
  }));
  // The edit applies to whichever side is the claude-code arm.
  const p = [
    ...await ccVsPi(webArm),
    ...await ccVsPi(webArm, undefined, true),
  ];
  assertEquals(p.length, 1);
  assertStringIncludes(p[0]!, ": settings");
});

Deno.test("validateCampaignRecords (R-01): cc-vs-pi stays valid with each recorded default list (pre-H-07 six, H-07 eight, R-01 nine with Monitor); a tampered list is refused", async () => {
  const six = [
    "CronCreate",
    "CronDelete",
    "ListAgents",
    "RemoteTrigger",
    "ScheduleWakeup",
    "SendMessage",
  ];
  const eight = [...six, "WebFetch", "WebSearch"].sort();
  const nine = [...eight, "Monitor"].sort();
  const withList = (list: string[]) => (m: ResolvedManifest) =>
    m.harness === "claude-code"
      ? native(m, (n) => ({ ...n, disallowed_tools: list }))
      : m;
  // cc-sonnet-plain is the cc arm and the baseline, so `true` edits it. It is
  // a frozen v1 arm: resolved today it still records the six.
  assertEquals(await ccVsPi(), []);
  for (const list of [six, eight, nine]) {
    assertEquals(
      await ccVsPi(withList(list), undefined, true),
      [],
      JSON.stringify(list),
    );
  }
  for (
    const bad of [
      [...six, "Monitor"].sort(), // six + Monitor, web tools not blocked
      six.slice(1),
      eight.filter((t) => t !== "WebFetch"),
      nine.filter((t) => t !== "ScheduleWakeup"),
    ]
  ) {
    const p = await ccVsPi(withList(bad), undefined, true);
    assertEquals(p.length, 1, JSON.stringify(bad));
    assertStringIncludes(p[0]!, ": settings");
  }
  // R-01b (Sol R-01 P2): a 2.1.310 manifest with Monitor removed alone (and
  // its hashes recomputed) is refused; with Monitor it is valid.
  const at310 = (list: string[]) => (m: ResolvedManifest) =>
    m.harness === "claude-code"
      ? {
        ...native(m, (n) => ({ ...n, disallowed_tools: list })),
        harness_version: "2.1.310",
      }
      : m;
  assertEquals(await ccVsPi(at310(nine), undefined, true), []);
  const tampered = await ccVsPi(at310(eight), undefined, true);
  assertEquals(tampered.length, 1);
  assertStringIncludes(tampered[0]!, ": settings");
  // Two claude-code arms of different eras (H-07 eight, R-01 nine) differ in
  // settings, even under vary [harness].
  const arm = (id: string, disallowed: string[]) =>
    manifest(id, {
      harness: "claude-code",
      settings: { requested: {}, native: { disallowed_tools: disallowed } },
    });
  const derive = { "claude-code": claudeCodeDerivedNative };
  await assertVaryHolds(
    arm("r01", nine),
    arm("r01", nine),
    ["harness"],
    derive,
  );
  await assertRejects(
    () =>
      assertVaryHolds(arm("h07", eight), arm("r01", nine), ["harness"], derive),
    ConfigurationError,
    "settings",
  );
});

Deno.test("assertVaryHolds (H-07 review): two claude-code arms with six vs eight disallowed tools differ in settings, even under vary [harness]", async () => {
  const arm = (id: string, disallowed: string[]) =>
    manifest(id, {
      harness: "claude-code",
      settings: { requested: {}, native: { disallowed_tools: disallowed } },
    });
  // The lists recorded before R-01 (no Monitor).
  const six = arm(
    "legacy",
    claudeCodeHarnessNative(true, true).disallowed_tools,
  );
  const eight = arm(
    "now",
    claudeCodeHarnessNative(false, true).disallowed_tools,
  );
  const derive = { "claude-code": claudeCodeDerivedNative };
  await assertRejects(
    () => assertVaryHolds(six, eight, ["harness"], derive),
    ConfigurationError,
    "settings",
  );
  // Each alone still matches its own derivation (pre-H-07 campaigns stay valid).
  await assertVaryHolds(six, six, ["harness"], derive);
  await assertVaryHolds(eight, eight, ["harness"], derive);
  // A missing derived key is a settings refusal, never a serialization error.
  const none = manifest("none", {
    harness: "claude-code",
    settings: { requested: {}, native: {} },
  });
  for (const [a, b] of [[none, eight], [eight, none], [none, none]]) {
    await assertRejects(
      () => assertVaryHolds(a!, b!, ["harness"], derive),
      ConfigurationError,
      "settings",
    );
  }
});

// ---- H-35 S2.2 (design-r3 6.3, design-r2 3): suites, the effective scorer set ----

Deno.test("H-35 S2.2: every suite that ever shipped is known; an unknown combination and the H-35 suite without agent_tests are not", async () => {
  const { KNOWN_SUITES, SCORER_SUITE, suiteOf } = await import(
    "../../../src/harness/verdict.ts"
  );
  assertEquals(KNOWN_SUITES.length, 8);
  assertEquals(suiteOf(SCORER_SUITE)?.v, 2);
  assertEquals(
    suiteOf({
      build: "3",
      pass_to_pass: "5",
      fail_to_pass: "3",
      mutant_kill: "5",
    })?.v,
    1,
  );
  assertEquals(suiteOf({ build: "9" }), null);
  const { agent_tests: _, ...noAgent } = SCORER_SUITE;
  assertEquals(suiteOf(noAgent), null);
});

Deno.test("H-35 S2.2: expectedScorers: a legacy suite expects the task's list, the H-35 suite adds agent_tests to every kind but test-authoring", async () => {
  const { expectedScorers, SCORER_SUITE } = await import(
    "../../../src/harness/verdict.ts"
  );
  const legacy = {
    build: "3",
    pass_to_pass: "5",
    fail_to_pass: "3",
    mutant_kill: "5",
  };
  const change = { kind: "bugfix", scorers: ["build", "pass_to_pass"] };
  assertEquals(expectedScorers(change, legacy), ["build", "pass_to_pass"]);
  assertEquals(expectedScorers(change, SCORER_SUITE), [
    "build",
    "pass_to_pass",
    "agent_tests",
  ]);
  assertEquals(
    expectedScorers(
      { kind: "test-authoring", scorers: ["build"] },
      SCORER_SUITE,
    ),
    ["build"],
  );
  assertEquals(expectedScorers(change, { build: "9" }), null);
});

Deno.test("H-35 S2.2: validateCampaignRecords refuses an unknown suite, a suite of another record version, and scorer names other than the expected set", async () => {
  const { SCORER_SUITE, currentScorerFingerprint } = await import(
    "../../../src/harness/verdict.ts"
  );
  const r = await scenario();
  const [j1, j2] = r.judgments as [
    typeof r.judgments[0],
    typeof r.judgments[0],
  ];
  const { scorerFingerprint } = await import("../../../src/harness/records.ts");
  const unknown = { build: "9" };
  const p1 = await problems({
    ...r,
    judgments: [{
      ...j1,
      scorer_versions: unknown,
      scorer_fingerprint: await scorerFingerprint(unknown),
    }, j2],
  });
  assertStringIncludes(p1.join("\n"), "unknown scorer suite");
  // A v1 record under the H-35 suite.
  const p2 = await problems({
    ...r,
    judgments: [{
      ...j1,
      scorer_versions: SCORER_SUITE,
      scorer_fingerprint: await currentScorerFingerprint(),
    }, j2],
  });
  assertStringIncludes(p2.join("\n"), "under the h38 suite");
  // Names other than the descriptor's expected set.
  const descriptor = () =>
    Promise.resolve({
      kind: "bugfix" as const,
      scorers: ["build", "pass_to_pass"],
      pass_to_pass: [],
      fail_to_pass: null,
      mutants: [],
      production_allow: null,
      recovered_from: null,
    });
  let p3: string[] = [];
  try {
    await validateCampaignRecords(r, { descriptor });
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    p3 = err.errors;
  }
  assertStringIncludes(
    p3.join("\n"),
    "scorers build != expected build, pass_to_pass",
  );
});

// ---- H-38 (Q9, design 7, 8.5): the H-35 suite frozen, the live suite bumped ----

/** The scorer versions every stored P-02 / M8-16a judgment carries, and their fingerprint. */
const H35 = {
  build: "4",
  pass_to_pass: "6",
  fail_to_pass: "4",
  mutant_kill: "6",
  agent_tests: "1",
};
const H35_FP =
  "b23eeb83c8c0d79b209ac4a4d75a8b45fe03daba32646ab400e20f19a281fcfc";

Deno.test("H-38 (Q9, 8.5): a stored h35 judgment (v2 record, fingerprint b23eeb83) passes full integrity with the descriptor check after the bump and is not current; the live suite is h38, the legacy suites unchanged", async () => {
  const {
    currentScorerFingerprint,
    isCurrentJudgment,
    KNOWN_SUITES,
    SCORER_SUITE,
    suiteOf,
  } = await import("../../../src/harness/verdict.ts");
  const { scorerFingerprint } = await import("../../../src/harness/records.ts");
  assertEquals(await scorerFingerprint(H35), H35_FP);
  assertEquals(suiteOf(H35)?.id, "h35");
  assertEquals(SCORER_SUITE, {
    build: "5",
    pass_to_pass: "7",
    fail_to_pass: "5",
    mutant_kill: "7",
    agent_tests: "2",
  });
  assertEquals(suiteOf(SCORER_SUITE)?.id, "h38");
  assert((await currentScorerFingerprint()) !== H35_FP);
  assertEquals(
    KNOWN_SUITES.map((s) => [s.id, s.v, Object.values(s.versions).join(".")]),
    [
      ["legacy-1", 1, "1.1.1.1"],
      ["legacy-2", 1, "1.1.1.2"],
      ["legacy-3", 1, "1.2.1.3"],
      ["legacy-4", 1, "2.3.2.4"],
      ["legacy-5", 1, "2.4.2.4"],
      ["legacy-6", 1, "3.5.3.5"],
      ["h35", 2, "4.6.4.6.1"],
      ["h38", 2, "5.7.5.7.2"],
    ],
  );
  const r = await scenario();
  const stored = r.judgments.map((j) => ({
    ...j,
    v: 2 as const,
    scorer_versions: H35,
    scorer_fingerprint: H35_FP,
    scorers: ["build", "pass_to_pass", "agent_tests"].map((name) => ({
      name,
      passed: j.verdict === "pass",
      state: "measured" as const,
      tests: [],
    })),
    policy: { passed: true, violations: [] },
    provenance: {
      harness_commit: "9f14963c",
      production_manifest: null,
      env_fp: null,
    },
  }));
  const descriptor = () =>
    Promise.resolve({
      kind: "bugfix" as const,
      scorers: ["build", "pass_to_pass"],
      pass_to_pass: [],
      fail_to_pass: null,
      mutants: [],
      production_allow: null,
      recovered_from: null,
    });
  await validateCampaignRecords({ ...r, judgments: stored }, { descriptor });
  for (const j of stored) assertEquals(await isCurrentJudgment(j), false);
});
