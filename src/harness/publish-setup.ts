/**
 * Build the setups-leaderboard publish payload for one arm of a complete
 * harness campaign. Pure mapping: score and price are the report's own
 * numbers, never recomputed.
 */
import { join } from "@std/path";
import type { SetupPublishPayload } from "../../site/src/lib/shared/setup-publish.ts";
import { AGENT_TOOLS } from "../../site/src/lib/shared/setups.ts";
import type {
  AgentTool,
  CellOutcome,
  Ingredients,
  NamedFile,
} from "../../site/src/lib/shared/setups.ts";
import { normalizeHxPrompt } from "../../shared/task-summaries.ts";
import { CentralGaugeError } from "../errors.ts";
import { type HarnessConfig, loadConfig } from "./config.ts";
import { sha256Hex } from "./hash.ts";
import type { CampaignRecords } from "./integrity.ts";
import type { HarnessReport } from "./report.ts";

export interface PublishOptions {
  arm: string;
  setupId: string;
  submissionId: string | null;
  description: string | null;
  visibility: "public" | "private" | null;
  displayName: string | null;
  repoRoot: string;
}

export class PublishRefused extends CentralGaugeError {
  constructor(reason: string) {
    super(`Publish refused: ${reason}`, "PUBLISH_REFUSED");
    this.name = "PublishRefused";
  }
}

const enc = new TextEncoder();

async function entryNames(dir: string): Promise<string[]> {
  const names: string[] = [];
  for await (const e of Deno.readDir(dir)) names.push(e.name);
  return names.sort();
}

async function readInstructions(
  harnessRoot: string,
  config: HarnessConfig,
): Promise<NamedFile | null> {
  const rel = config.components.instructions;
  if (rel === null) return null;
  const dir = join(harnessRoot, rel);
  const files = (await Array.fromAsync(Deno.readDir(dir)))
    .filter((e) => e.isFile).map((e) => e.name).sort();
  const preferred = config.harness === "claude-code"
    ? "CLAUDE.md"
    : "AGENTS.md";
  const name = files.includes(preferred) ? preferred : files[0];
  if (name === undefined) return null;
  return { name, content: await Deno.readTextFile(join(dir, name)) };
}

async function ingredients(
  harnessRoot: string,
  config: HarnessConfig,
): Promise<Ingredients> {
  const c = config.components;
  return {
    instructions: await readInstructions(harnessRoot, config),
    rules: [],
    settings: null,
    skills: c.skills === null
      ? []
      : await entryNames(join(harnessRoot, c.skills)),
    mcp: [...c.mcp],
    hooks: c.hooks === null ? [] : await entryNames(join(harnessRoot, c.hooks)),
  };
}

export async function buildSetupPublishPayload(
  report: HarnessReport,
  records: CampaignRecords,
  opts: PublishOptions,
): Promise<SetupPublishPayload> {
  if (report.partial !== null) {
    throw new PublishRefused(
      `the report is partial (${
        report.partial.reasons.join(", ")
      }); only a complete report is published`,
    );
  }
  const arm = report.arms.find((a) => a.arm === opts.arm);
  if (!arm) {
    throw new PublishRefused(
      `arm ${opts.arm} is not in the report (arms: ${
        report.arms.map((a) => a.arm).join(", ")
      })`,
    );
  }
  if (arm.pass_rate === null) {
    throw new PublishRefused(`arm ${opts.arm} has no pass rate`);
  }
  const harnessRoot = join(opts.repoRoot, "harness");
  const config = await loadConfig(harnessRoot, opts.arm);
  if (!AGENT_TOOLS.includes(config.harness as AgentTool)) {
    throw new PublishRefused(
      `harness ${config.harness} is not a publishable agent tool (${
        AGENT_TOOLS.join(", ")
      })`,
    );
  }

  const cells = report.cells.filter((c) => c.arm === opts.arm);
  const used = new Map(records.executions.map((e) => [e.id, e]));
  const versions = new Set<string>();
  for (const c of cells) {
    const v = c.used_execution === null
      ? null
      : used.get(c.used_execution)?.observed.harness_version;
    if (v) versions.add(v);
  }
  if (versions.size > 1) {
    throw new PublishRefused(
      `arm ${opts.arm} ran under several harness versions: ${
        [...versions].sort().join(", ")
      }`,
    );
  }
  const [toolVersion] = versions;
  if (toolVersion === undefined) {
    throw new PublishRefused(
      `arm ${opts.arm} has no observed harness_version`,
    );
  }

  const tasks: { task_id: string; description_sha: string }[] = [];
  for (
    const t of [...records.campaign.task_set.tasks].sort((a, b) =>
      a.id.localeCompare(b.id)
    )
  ) {
    const path = join(
      opts.repoRoot,
      "harness-tasks",
      "tasks",
      t.id,
      "prompt.md",
    );
    let text: string;
    try {
      text = await Deno.readTextFile(path);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        throw new PublishRefused(`task ${t.id} has no prompt.md (${path})`);
      }
      throw err;
    }
    tasks.push({
      task_id: t.id,
      description_sha: await sha256Hex(enc.encode(normalizeHxPrompt(text))),
    });
  }

  const outCells = cells.map((c) => {
    const wall = c.used_execution === null
      ? null
      : used.get(c.used_execution)?.telemetry.wall_ms ?? null;
    const outcome: CellOutcome = c.status === "scored"
      ? (c.pass ? "pass" : "fail")
      : "infra";
    return {
      task_id: c.task,
      repeat: c.repeat,
      outcome,
      cost_usd: c.spend_usd,
      duration_ms: wall,
    };
  }).sort((a, b) => a.task_id.localeCompare(b.task_id) || a.repeat - b.repeat);

  const slots = Object.entries(config.models);
  const identity = records.campaign.task_set.identity;
  const cost = arm.cost_per_solved_task;
  return {
    setup: {
      id: opts.setupId,
      agent_tool: config.harness as AgentTool,
      base_model: config.models["main"] ?? slots[0]![1],
      description: opts.description,
      visibility: opts.visibility,
      roles: slots.map(([role, model]) => ({ role, model, effort: null })),
      ingredients: await ingredients(harnessRoot, config),
    },
    submission_id: opts.submissionId,
    task_set: {
      hash: identity,
      display_name: opts.displayName ?? `HX set ${identity.slice(0, 8)}`,
      tasks,
    },
    run: {
      id: `${records.campaign.id}:${opts.arm}`,
      tool_version: toolVersion,
      score: arm.pass_rate,
      cost_per_solved_usd: cost,
      price_note: cost !== null
        ? null
        : arm.unknown_spend_cells > 0
        ? `Price not available: ${arm.unknown_spend_cells} cells with unknown cost.`
        : "Price not available.",
      excluded_cells: arm.unscored_cells,
      repeats: report.repeats.reported,
      cells: outCells,
    },
  };
}
