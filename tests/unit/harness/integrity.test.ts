import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { ValidationError } from "../../../src/errors.ts";
import {
  type CampaignRecords,
  validateCampaignRecords,
} from "../../../src/harness/integrity.ts";
import { manifestHash } from "../../../src/harness/manifest.ts";
import { planBlocks } from "../../../src/harness/records.ts";
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
