import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { ValidationError } from "../../../src/errors.ts";
import { readCatalog } from "../../../src/ingest/catalog/read.ts";
import { adapterFor } from "../../../src/harness/adapters/mod.ts";
import { loadExperiment, type VaryKey } from "../../../src/harness/config.ts";
import { runtimeFacts } from "../../../src/harness/images.ts";
import {
  type CampaignRecords,
  validateCampaignRecords,
} from "../../../src/harness/integrity.ts";
import {
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

Deno.test("validateCampaignRecords: task-effective limits are the only allowed tightening", async () => {
  const r = await scenario();
  const tasks_meta = r.campaign.tasks_meta.map((t) =>
    t.id === "HX-002" ? { ...t, limits: { timeout_min: 20 } } : t
  );
  const campaign = { ...r.campaign, tasks_meta };
  const other = r.executions[2]!;
  const exact = {
    ...other,
    manifest: {
      ...other.manifest,
      limits: { timeout_min: 20, max_budget_usd: 5 },
    },
  };
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
