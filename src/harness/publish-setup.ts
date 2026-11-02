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
import { experimentTasks } from "./campaign.ts";
import { sha256Hex } from "./hash.ts";
import { loadSymbolsLock, taskSetIdentity } from "./identity.ts";
import type { CampaignRecords } from "./integrity.ts";
import { pathComponent, type ResolvedManifest } from "./manifest.ts";
import type { CampaignRecord } from "./records.ts";
import type { HarnessReport } from "./report.ts";

export interface PublishOptions {
  arm: string;
  setupId: string;
  submissionId: string | null;
  description: string | null;
  visibility: "public" | "private" | null;
  displayName: string | null;
  repoRoot: string;
  /** Test seam: the task-set identity of the files on disk. Default recomputes it. */
  currentIdentity?: (c: CampaignRecord, repoRoot: string) => Promise<string>;
}

async function identityOnDisk(
  c: CampaignRecord,
  repoRoot: string,
): Promise<string> {
  const symbols = await loadSymbolsLock(repoRoot);
  if (!symbols) return "(no symbols lock)";
  const tasks = await experimentTasks(repoRoot, c.experiment.id, c.experiment);
  return (await taskSetIdentity(repoRoot, tasks, symbols)).identity;
}

export class PublishRefused extends CentralGaugeError {
  constructor(reason: string) {
    super(`Publish refused: ${reason}`, "PUBLISH_REFUSED");
    this.name = "PublishRefused";
  }
}

const enc = new TextEncoder();

/** Refuse when a component on disk is no longer what the campaign ran. */
async function checkComponents(
  harnessRoot: string,
  m: ResolvedManifest,
): Promise<void> {
  const parts = [
    ["instructions", m.instructions],
    ["skills", m.skills],
    ["agents", m.agents],
    ["hooks", m.hooks],
    ...m.plugins.map((p) => ["plugin", p] as const),
  ] as const;
  for (const [name, c] of parts) {
    if (c === null) continue;
    let now: string | null = null;
    try {
      now = (await pathComponent(harnessRoot, c.path)).hash;
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
    if (now !== c.hash) {
      throw new PublishRefused(
        `${name} component ${c.path} changed since the campaign ran (manifest ${
          c.hash.slice(0, 8)
        }, now ${now === null ? "missing" : now.slice(0, 8)})`,
      );
    }
  }
}

async function ingredients(
  harnessRoot: string,
  m: ResolvedManifest,
): Promise<Ingredients> {
  let instructions: NamedFile | null = null;
  const rules: NamedFile[] = [];
  if (m.instructions !== null) {
    const base = join(harnessRoot, m.instructions.path);
    const expected = m.harness === "claude-code" ? "CLAUDE.md" : "AGENTS.md";
    const paths = m.instructions.files.map((f) => f.path);
    if (!paths.includes(expected)) {
      throw new PublishRefused(
        `instructions ${m.instructions.path} has no ${expected}, which ${m.harness} loads`,
      );
    }
    instructions = {
      name: expected,
      content: await Deno.readTextFile(join(base, expected)),
    };
    for (const p of paths.filter((p) => /^rules\/[^/]+\.md$/.test(p)).sort()) {
      rules.push({
        name: p.slice("rules/".length),
        content: await Deno.readTextFile(join(base, p)),
      });
    }
  }
  const firstSegments = (files: { path: string }[] | undefined) =>
    [
      ...new Set(
        (files ?? []).filter((f) => f.path.includes("/")).map((f) =>
          f.path.split("/")[0]!
        ),
      ),
    ].sort();
  return {
    instructions,
    rules,
    settings: null,
    skills: firstSegments(m.skills?.files),
    mcp: m.mcp.map((s) => s.name),
    hooks: (m.hooks?.files ?? []).map((f) => f.path).sort(),
  };
}

/**
 * Above this share of an arm's cells with unknown cost, no price is published:
 * the unknown cells are mostly timeouts and crashes, the expensive runs, so a
 * price over the rest is biased low.
 */
export const MAX_UNKNOWN_COST_SHARE = 0.25;

/** The published cost per solved task and its note. */
export function publishedPrice(
  cost: number | null,
  unknown: number,
  total: number,
): { cost: number | null; note: string | null } {
  if (total > 0 && unknown / total > MAX_UNKNOWN_COST_SHARE) {
    return {
      cost: null,
      note:
        `Price not available: ${unknown} of ${total} cells have unknown cost.`,
    };
  }
  if (cost === null) {
    return {
      cost,
      note: unknown > 0
        ? `Price not available: ${unknown} cells with unknown cost.`
        : "Price not available.",
    };
  }
  return {
    cost,
    note: unknown > 0
      ? `Price excludes ${unknown} cells with unknown cost.`
      : null,
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
  // What actually ran: the arm's campaign manifest, not the working-tree config.
  const manifest = records.campaign.arms.find((a) => a.config_id === opts.arm)
    ?.manifest;
  if (!manifest) {
    throw new PublishRefused(`arm ${opts.arm} is not in the campaign`);
  }
  if (!AGENT_TOOLS.includes(manifest.harness as AgentTool)) {
    throw new PublishRefused(
      `harness ${manifest.harness} is not a publishable agent tool (${
        AGENT_TOOLS.join(", ")
      })`,
    );
  }
  await checkComponents(harnessRoot, manifest);
  const onDisk = await (opts.currentIdentity ?? identityOnDisk)(
    records.campaign,
    opts.repoRoot,
  );
  if (onDisk !== records.campaign.task_set.identity) {
    throw new PublishRefused(
      `the task set changed since the campaign ran (campaign ${
        records.campaign.task_set.identity.slice(0, 8)
      }, now ${onDisk.slice(0, 8)})`,
    );
  }

  const cells = report.cells.filter((c) => c.arm === opts.arm);
  const byId = new Map(records.executions.map((e) => [e.id, e]));
  const versions = new Set<string>();
  for (const c of cells) {
    const v = c.used_execution === null
      ? null
      : byId.get(c.used_execution)?.observed.harness_version;
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
      : byId.get(c.used_execution)?.telemetry.wall_ms ?? null;
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

  const slots = Object.entries(manifest.models);
  const identity = records.campaign.task_set.identity;
  const price = publishedPrice(
    arm.cost_per_solved_task,
    arm.unknown_spend_cells,
    cells.length,
  );
  return {
    setup: {
      id: opts.setupId,
      agent_tool: manifest.harness as AgentTool,
      base_model: manifest.models["main"] ?? slots[0]![1],
      description: opts.description,
      visibility: opts.visibility,
      roles: slots.map(([role, model]) => ({ role, model, effort: null })),
      ingredients: await ingredients(harnessRoot, manifest),
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
      cost_per_solved_usd: price.cost,
      price_note: price.note,
      excluded_cells: arm.unscored_cells,
      repeats: report.repeats.reported,
      cells: outCells,
    },
  };
}
