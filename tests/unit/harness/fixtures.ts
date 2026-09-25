/**
 * Consistent record builders for harness unit tests. Every stored hash is
 * computed with the real functions, so a fixture passes
 * validateCampaignRecords unless a test deliberately breaks it.
 */

import { ExperimentSchema } from "../../../src/harness/config.ts";
import { taskSetHash } from "../../../src/harness/identity.ts";
import {
  manifestHash,
  type ResolvedManifest,
  ResolvedManifestSchema,
} from "../../../src/harness/manifest.ts";
import {
  type CampaignRecord,
  type ExecutionRecord,
  experimentHash,
  type JudgmentRecord,
  planBlocks,
  scorerFingerprint,
  type Telemetry,
} from "../../../src/harness/records.ts";

export const H = (c: string) => c.repeat(64);
export const SCORERS_V1 = { build: "1" };
export const SCORERS_V1_FP = await scorerFingerprint(SCORERS_V1);
export const CAMPAIGN_ID = "00000000-0000-4000-8000-000000000001";
const TASK_HASHES: Record<string, [string, string]> = {
  "HX-001": [H("1"), H("2")],
  "HX-002": [H("3"), H("4")],
};

export function manifest(
  config_id: string,
  over: Partial<ResolvedManifest> = {},
): ResolvedManifest {
  return ResolvedManifestSchema.parse({
    v: 1,
    rules: "hr1",
    config_id,
    harness: "claude-code",
    harness_version: "2.1.282",
    models: { main: "anthropic/model-a" },
    settings: { requested: {}, native: {} },
    limits: { timeout_min: 30, max_budget_usd: 5 },
    instructions: null,
    skills: null,
    agents: null,
    hooks: null,
    plugins: [],
    mcp: [],
    lsp: [],
    toolchain: [],
    image: { digest: "sha256:img", base_digest: "sha256:base" },
    backend_version: "b1",
    provider_routes: { main: "anthropic" },
    ...over,
  });
}

export function telemetry(cost_usd: number | null): Telemetry {
  return {
    harness_version: "2.1.282",
    cost_usd,
    cost_source: cost_usd === null ? null : "estimated",
    pricing_snapshot: cost_usd === null ? null : "2026-09-30",
    reported_cost_usd: null,
    per_model: [],
    turns: null,
    compactions: null,
    wall_ms: null,
    exit_code: 0,
    stop_reason: null,
    refusal_detected: null,
    raw_usage: null,
  };
}

/** plain vs skills over HX-001 and HX-002. */
export async function campaign(
  opts: { repeats?: number; id?: string; created_at?: string } = {},
): Promise<CampaignRecord> {
  const repeats = opts.repeats ?? 1;
  const experiment = ExperimentSchema.parse({
    id: "skills-vs-plain",
    hypothesis: "Skills cut cost per solved task.",
    primary_metric: "cost_per_solved_task",
    baseline: "plain",
    variants: ["skills"],
    vary: ["skills"],
    tasks: "harness-tasks/tasks/*",
    repeats,
  });
  const tasks = Object.entries(TASK_HASHES).map(([id, [visible, oracle]]) => ({
    id,
    refapp_commit: "c".repeat(40),
    visible,
    oracle,
  }));
  const plain = manifest("plain");
  const skills = manifest("skills", {
    skills: { path: "bundles/s", hash: H("5"), files: [] },
  });
  return {
    v: 1,
    id: opts.id ?? CAMPAIGN_ID,
    experiment,
    experiment_hash: await experimentHash(experiment),
    created_at: opts.created_at ?? "2026-10-01T10:00:00.000Z",
    seed: 1,
    reuse: [],
    task_set: {
      identity: await taskSetHash(tasks),
      provisional: false,
      tasks,
    },
    tasks_meta: tasks.map((t) => ({
      id: t.id,
      kind: "bugfix" as const,
      coupling: ["events"],
      limits: {},
    })),
    arms: [
      {
        config_id: "plain",
        manifest_hash: await manifestHash(plain),
        manifest: plain,
      },
      {
        config_id: "skills",
        manifest_hash: await manifestHash(skills),
        manifest: skills,
      },
    ],
    blocks: planBlocks(
      Object.keys(TASK_HASHES),
      repeats,
      ["plain", "skills"],
      1,
    ),
  };
}

let seq = 0;
const next = () => (++seq).toString(16).padStart(12, "0");

export interface CellSel {
  task?: string;
  repeat?: number;
  arm?: string;
  attempt?: number;
  run_kind?: ExecutionRecord["run_kind"];
  retry_of?: string | null;
}

/** An execution placed consistently in campaign `c`. */
export function execution(
  c: CampaignRecord,
  sel: CellSel = {},
  over: Partial<ExecutionRecord> = {},
): ExecutionRecord {
  const task = sel.task ?? "HX-001";
  const repeat = sel.repeat ?? 1;
  const armId = sel.arm ?? "plain";
  const block = c.blocks.find((b) =>
    b.task_id === task && b.repeat === repeat
  )!;
  const arm = c.arms.find((a) => a.config_id === armId)!;
  const n = next();
  return {
    v: 1,
    id: `00000000-0000-4000-9000-${n}`,
    campaign_id: c.id,
    block: block.index,
    order_in_block: block.order.indexOf(armId),
    arm: armId,
    task_id: task,
    task_visible_hash: c.task_set.tasks.find((t) => t.id === task)!.visible,
    repeat,
    attempt: sel.attempt ?? 1,
    run_kind: sel.run_kind ?? "planned",
    retry_of: sel.retry_of ?? null,
    started_at: "2026-10-01T10:01:00.000Z",
    ended_at: "2026-10-01T10:11:00.000Z",
    arm_manifest_hash: arm.manifest_hash,
    manifest: arm.manifest,
    observed: { harness_version: null, models: null, loaded_components: null },
    termination: "completed",
    did_work: true,
    validity: { incomplete_telemetry: [], infra_exposed: false },
    image_attachments: "none",
    telemetry: telemetry(1),
    trace_path: null,
    host_log_path: null,
    raw_log_path: null,
    container_assignments: ["Cronus281"],
    workspace_hash: n.padStart(64, "0"),
    ...over,
  };
}

/** A judgment of execution `e` against the campaign's oracle for its task. */
export function judgment(
  c: CampaignRecord,
  e: ExecutionRecord,
  passed: boolean | null,
  over: Partial<JudgmentRecord> = {},
): JudgmentRecord {
  return {
    v: 1,
    id: `00000000-0000-4000-a000-${next()}`,
    execution_id: e.id,
    workspace_hash: e.workspace_hash!,
    task_id: e.task_id,
    task_oracle_hash: c.task_set.tasks.find((t) => t.id === e.task_id)!.oracle,
    scorer_versions: SCORERS_V1,
    scorer_fingerprint: SCORERS_V1_FP,
    scorers: [{ name: "build", passed, tests: [] }],
    verdict: passed === null ? "unscored" : passed ? "pass" : "fail",
    verdict_container: "Cronus282",
    started_at: "2026-10-01T10:12:00.000Z",
    ended_at: "2026-10-01T10:14:00.000Z",
    ...over,
  };
}
