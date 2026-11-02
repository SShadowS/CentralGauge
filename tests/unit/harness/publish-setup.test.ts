import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { validatePublishPayload } from "../../../site/src/lib/shared/setup-publish.ts";
import type { CampaignRecords } from "../../../src/harness/integrity.ts";
import { pathComponent } from "../../../src/harness/manifest.ts";
import {
  buildReport,
  type HarnessReport,
} from "../../../src/harness/report.ts";
import type {
  ExecutionRecord,
  JudgmentRecord,
} from "../../../src/harness/records.ts";
import {
  buildSetupPublishPayload,
  MAX_UNKNOWN_COST_SHARE,
  publishedPrice,
  type PublishOptions,
  PublishRefused,
} from "../../../src/harness/publish-setup.ts";
import { campaignJudging } from "../../../src/harness/outcome.ts";
import {
  campaign,
  execution,
  judgment,
  SCORERS_V1_FP,
  telemetry,
} from "./fixtures.ts";

interface Opts {
  unknownCost?: boolean; // plain HX-002 repeat 2 has unknown cost
  unknownCostBoth?: boolean; // with unknownCost: plain HX-002 repeat 1 too
  noSolves?: boolean; // plain fails everything
  unscored?: boolean; // plain HX-002 repeat 2 is unscored
  pending?: boolean; // plain HX-002 repeat 2 has no judgment
  nullWall?: boolean; // plain HX-002 repeat 2 has no wall_ms
  noVersion?: boolean; // no execution observed a harness_version
}

async function records(o: Opts = {}): Promise<CampaignRecords> {
  const c = await campaign({ repeats: 2 });
  const executions: ExecutionRecord[] = [];
  const judgments: JudgmentRecord[] = [];
  for (const arm of ["plain", "skills"]) {
    for (const task of ["HX-001", "HX-002"]) {
      for (const repeat of [1, 2]) {
        const special = arm === "plain" && task === "HX-002" && repeat === 2;
        const unknown = o.unknownCost && arm === "plain" && task === "HX-002" &&
          (repeat === 2 || o.unknownCostBoth);
        const e = execution(c, { arm, task, repeat }, {
          observed: {
            harness_version: o.noVersion ? null : "2.1.282",
            models: null,
            loaded_components: null,
          },
          validity: {
            incomplete_telemetry: unknown ? ["cost_usd"] : [],
            incomplete_observed: o.noVersion ? ["harness_version"] : [],
            infra_exposed: false,
          },
          telemetry: {
            ...telemetry(unknown ? null : 1),
            wall_ms: special && o.nullWall ? null : 1000,
          },
        });
        executions.push(e);
        if (special && o.pending) continue;
        if (special && o.unscored) {
          // Three unscored judgments exhaust the rejudge budget: terminal unscored.
          for (let i = 0; i < 3; i++) judgments.push(judgment(c, e, null));
          continue;
        }
        // plain fails HX-002 (and everything with noSolves).
        judgments.push(
          judgment(
            c,
            e,
            !(arm === "plain" && (task === "HX-002" || o.noSolves)),
          ),
        );
      }
    }
  }
  return { campaign: c, executions, artifacts: [], judgments };
}

interface RepoOpts {
  noInstructionsFile?: boolean;
}

async function repo(
  prompts: Record<string, string>,
  ro: RepoOpts = {},
): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "publish-setup-" });
  const instr = join(root, "harness", "bundles", "instr");
  await Deno.mkdir(join(instr, "rules"), { recursive: true });
  await Deno.mkdir(join(root, "harness", "bundles", "sk", "s1"), {
    recursive: true,
  });
  if (!ro.noInstructionsFile) {
    await Deno.writeTextFile(join(instr, "CLAUDE.md"), "be good\n");
    await Deno.writeTextFile(join(instr, "AGENTS.md"), "be good\n");
  }
  await Deno.writeTextFile(join(instr, "rules", "b.md"), "rule b\n");
  await Deno.writeTextFile(join(instr, "rules", "a.md"), "rule a\n");
  await Deno.writeTextFile(
    join(root, "harness", "bundles", "sk", "s1", "SKILL.md"),
    "skill\n",
  );
  for (const [id, text] of Object.entries(prompts)) {
    await Deno.mkdir(join(root, "harness-tasks", "tasks", id), {
      recursive: true,
    });
    await Deno.writeTextFile(
      join(root, "harness-tasks", "tasks", id, "prompt.md"),
      text,
    );
  }
  return root;
}

/** The records as if the plain arm had run with the bundles under `root`. */
async function ran(
  recs: CampaignRecords,
  root: string,
  harness = "claude-code",
): Promise<CampaignRecords> {
  const h = join(root, "harness");
  const arms = await Promise.all(
    recs.campaign.arms.map(async (a) =>
      a.config_id !== "plain" ? a : {
        ...a,
        manifest: {
          ...a.manifest,
          harness,
          models: { main: "anthropic/model-a", helper: "anthropic/model-b" },
          instructions: await pathComponent(h, "bundles/instr"),
          skills: await pathComponent(h, "bundles/sk"),
          mcp: [{ name: "al-tools", version: "1", tool_schema_hash: "x" }],
        },
      }
    ),
  );
  return { ...recs, campaign: { ...recs.campaign, arms } };
}

const PROMPTS = { "HX-001": "Fix one.\nLine two.\n", "HX-002": "Fix two.\n" };
const base = (repoRoot: string): PublishOptions => ({
  arm: "plain",
  setupId: "plain-setup",
  submissionId: null,
  description: "A plain setup",
  visibility: "public",
  displayName: null,
  repoRoot,
  // No git or symbols lock in the temp repo: the on-disk identity is the campaign's.
  currentIdentity: (c) => Promise.resolve(c.task_set.identity),
});

const rpt = (r: CampaignRecords): Promise<HarnessReport> =>
  buildReport(r, { resamples: 50, seed: 1 });

async function sha(text: string): Promise<string> {
  const d = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.test("publish-setup: a complete campaign maps to cells, score, cost and setup metadata", async () => {
  const root = await repo(PROMPTS);
  const raw = await records();
  const report = await rpt(raw);
  const recs = await ran(raw, root);
  const p = await buildSetupPublishPayload(report, recs, base(root));
  assertEquals(p.run.cells.length, 4);
  const arm = report.arms.find((a) => a.arm === "plain")!;
  assertEquals(p.run.score, arm.pass_rate);
  assertEquals(p.run.cost_per_solved_usd, arm.cost_per_solved_task);
  assertEquals(
    p.run.cells.map((c) => [c.task_id, c.repeat, c.outcome]),
    [
      ["HX-001", 1, "pass"],
      ["HX-001", 2, "pass"],
      ["HX-002", 1, "fail"],
      ["HX-002", 2, "fail"],
    ],
  );
  assert(p.run.cells.every((c) => c.cost_usd === 1 && c.duration_ms === 1000));
  assertEquals(p.run.id, `${recs.campaign.id}:plain`);
  assertEquals(p.run.tool_version, "2.1.282");
  assertEquals(p.run.repeats, 2);
  assertEquals(p.run.excluded_cells, 0);
  assertEquals(p.run.price_note, null);
  assertEquals(p.setup.agent_tool, "claude-code");
  assertEquals(p.setup.base_model, "anthropic/model-a");
  assertEquals(p.setup.roles.map((r) => r.role), ["main", "helper"]);
  assertEquals(p.setup.ingredients.instructions, {
    name: "CLAUDE.md",
    content: "be good\n",
  });
  assertEquals(p.setup.ingredients.rules, [
    { name: "a.md", content: "rule a\n" },
    { name: "b.md", content: "rule b\n" },
  ]);
  assertEquals(p.setup.ingredients.skills, ["s1"]);
  assertEquals(p.setup.ingredients.mcp, ["al-tools"]);
  assertEquals(p.task_set.hash, recs.campaign.task_set.identity);
  assertEquals(
    p.task_set.display_name,
    `HX set ${p.task_set.hash.slice(0, 8)}`,
  );
  assertEquals(validatePublishPayload(p).ok, true);
});

Deno.test("publish-setup: an unscored cell becomes infra and counts as excluded", async () => {
  const root = await repo(PROMPTS);
  const raw = await records({ unscored: true });
  const report = await buildReport(raw, {
    resamples: 50,
    seed: 1,
    judging: { ...campaignJudging(raw.campaign), scorer: SCORERS_V1_FP },
  });
  const p = await buildSetupPublishPayload(
    report,
    await ran(raw, root),
    base(root),
  );
  assertEquals(
    p.run.cells.find((c) => c.task_id === "HX-002" && c.repeat === 2)!.outcome,
    "infra",
  );
  assertEquals(p.run.excluded_cells, 1);
  assertEquals(validatePublishPayload(p).ok, true);
});

Deno.test("publish-setup: a null cost with an unknown-spend cell gets a price note", async () => {
  const root = await repo(PROMPTS);
  const raw = await records({ unknownCost: true, noSolves: true });
  const report = await rpt(raw);
  assertEquals(
    report.arms.find((a) => a.arm === "plain")!.cost_per_solved_task,
    null,
  );
  const p = await buildSetupPublishPayload(
    report,
    await ran(raw, root),
    base(root),
  );
  assertEquals(p.run.cost_per_solved_usd, null);
  assertEquals(
    p.run.price_note,
    "Price not available: 1 cells with unknown cost.",
  );
  assertEquals(
    p.run.cells.find((c) => c.task_id === "HX-002" && c.repeat === 2)!.cost_usd,
    null,
  );
});

Deno.test("publish-setup: a null cost without unknown spend says only that the price is unavailable", async () => {
  const root = await repo(PROMPTS);
  const raw = await records({ noSolves: true });
  const p = await buildSetupPublishPayload(
    await rpt(raw),
    await ran(raw, root),
    base(root),
  );
  assertEquals(p.run.cost_per_solved_usd, null);
  assertEquals(p.run.price_note, "Price not available.");
});

Deno.test("publish-setup: a price over fewer cells (unknown spend, solves) says so", async () => {
  const root = await repo(PROMPTS);
  const raw = await records({ unknownCost: true });
  const report = await rpt(raw);
  const arm = report.arms.find((a) => a.arm === "plain")!;
  assert(arm.cost_per_solved_task !== null);
  const p = await buildSetupPublishPayload(
    report,
    await ran(raw, root),
    base(root),
  );
  assertEquals(p.run.cost_per_solved_usd, arm.cost_per_solved_task);
  assertEquals(p.run.price_note, "Price excludes 1 cells with unknown cost.");
});

Deno.test("publish-setup: unknown cost on more than 25% of the arm's cells publishes no price; the score stands", async () => {
  const root = await repo(PROMPTS);
  // plain HX-002 repeats 1 and 2 unknown: 2 of 4 cells.
  const raw = await records({ unknownCost: true, unknownCostBoth: true });
  const report = await rpt(raw);
  const arm = report.arms.find((a) => a.arm === "plain")!;
  assertEquals(arm.unknown_spend_cells, 2);
  assert(arm.cost_per_solved_task !== null);
  const p = await buildSetupPublishPayload(
    report,
    await ran(raw, root),
    base(root),
  );
  assertEquals(p.run.cost_per_solved_usd, null);
  assertEquals(
    p.run.price_note,
    "Price not available: 2 of 4 cells have unknown cost.",
  );
  assertEquals(p.run.score, arm.pass_rate);
  assertEquals(validatePublishPayload(p).ok, true);
});

Deno.test("publish-setup: the unknown-cost threshold is 25% of the arm's cells, inclusive", () => {
  assertEquals(MAX_UNKNOWN_COST_SHARE, 0.25);
  // Exactly 25% still prices.
  assertEquals(publishedPrice(1.45, 11, 44), {
    cost: 1.45,
    note: "Price excludes 11 cells with unknown cost.",
  });
  // Just above 25%: no price.
  assertEquals(publishedPrice(1.45, 12, 44), {
    cost: null,
    note: "Price not available: 12 of 44 cells have unknown cost.",
  });
  // The cc-v2-tue-realistic dry run.
  assertEquals(publishedPrice(1.45, 24, 44).cost, null);
  // 0% unchanged.
  assertEquals(publishedPrice(1.45, 0, 44), { cost: 1.45, note: null });
  assertEquals(publishedPrice(null, 0, 44), {
    cost: null,
    note: "Price not available.",
  });
  // All unknown folds into the new note.
  assertEquals(publishedPrice(null, 44, 44), {
    cost: null,
    note: "Price not available: 44 of 44 cells have unknown cost.",
  });
  // A null cost at or below 25% keeps its note.
  assertEquals(publishedPrice(null, 1, 4), {
    cost: null,
    note: "Price not available: 1 cells with unknown cost.",
  });
});

Deno.test("publish-setup: a missing wall_ms gives a null duration", async () => {
  const root = await repo(PROMPTS);
  const raw = await records({ nullWall: true });
  const p = await buildSetupPublishPayload(
    await rpt(raw),
    await ran(raw, root),
    base(root),
  );
  assertEquals(
    p.run.cells.find((c) => c.task_id === "HX-002" && c.repeat === 2)!
      .duration_ms,
    null,
  );
  assertEquals(
    p.run.cells.filter((c) => c.duration_ms === 1000).length,
    3,
  );
});

Deno.test("publish-setup: a partial report is refused", async () => {
  const root = await repo(PROMPTS);
  const raw = await records({ pending: true });
  const report = await rpt(raw);
  assert(report.partial !== null);
  await assertRejects(
    async () =>
      await buildSetupPublishPayload(report, await ran(raw, root), base(root)),
    PublishRefused,
    "partial",
  );
});

Deno.test("publish-setup: two harness versions are refused", async () => {
  const root = await repo(PROMPTS);
  // Integrity pins observed to the manifest, so skew the records after the report.
  const good = await records();
  const report = await rpt(good);
  const recs = await ran({
    ...good,
    executions: good.executions.map((e) =>
      e.arm === "plain" && e.task_id === "HX-001" && e.repeat === 1
        ? { ...e, observed: { ...e.observed, harness_version: "2.1.999" } }
        : e
    ),
  }, root);
  await assertRejects(
    async () => await buildSetupPublishPayload(report, recs, base(root)),
    PublishRefused,
    "2.1.999",
  );
});

Deno.test("publish-setup: no observed harness version is refused", async () => {
  const root = await repo(PROMPTS);
  const raw = await records({ noVersion: true });
  await assertRejects(
    async () =>
      await buildSetupPublishPayload(
        await rpt(raw),
        await ran(raw, root),
        base(root),
      ),
    PublishRefused,
    "no observed harness_version",
  );
});

Deno.test("publish-setup: a mock arm and an unknown arm are refused", async () => {
  const root = await repo(PROMPTS);
  const raw = await records();
  const report = await rpt(raw);
  await assertRejects(
    async () =>
      await buildSetupPublishPayload(
        report,
        await ran(raw, root, "mock"),
        base(root),
      ),
    PublishRefused,
    "mock",
  );
  await assertRejects(
    async () =>
      await buildSetupPublishPayload(report, await ran(raw, root), {
        ...base(root),
        arm: "nope",
      }),
    PublishRefused,
    "nope",
  );
});

Deno.test("publish-setup: a missing prompt.md is refused", async () => {
  const root = await repo({ "HX-001": "x\n" });
  const raw = await records();
  await assertRejects(
    async () =>
      await buildSetupPublishPayload(
        await rpt(raw),
        await ran(raw, root),
        base(root),
      ),
    PublishRefused,
    "HX-002",
  );
});

Deno.test("publish-setup: the instructions file the tool loads must exist", async () => {
  const root = await repo(PROMPTS, { noInstructionsFile: true });
  const raw = await records();
  await assertRejects(
    async () =>
      await buildSetupPublishPayload(
        await rpt(raw),
        await ran(raw, root),
        base(root),
      ),
    PublishRefused,
    "CLAUDE.md",
  );
  // A codex arm loads AGENTS.md, which this bundle also lacks.
  await assertRejects(
    async () =>
      await buildSetupPublishPayload(
        await rpt(raw),
        await ran(raw, root, "codex"),
        base(root),
      ),
    PublishRefused,
    "AGENTS.md",
  );
});

Deno.test("publish-setup: an instructions file edited after the run is refused", async () => {
  const root = await repo(PROMPTS);
  const raw = await records();
  const report = await rpt(raw);
  const recs = await ran(raw, root);
  await Deno.writeTextFile(
    join(root, "harness", "bundles", "instr", "CLAUDE.md"),
    "edited\n",
  );
  await assertRejects(
    async () => await buildSetupPublishPayload(report, recs, base(root)),
    PublishRefused,
    "changed since the campaign ran",
  );
});

Deno.test("publish-setup: a task set that differs from the campaign's is refused", async () => {
  const root = await repo(PROMPTS);
  const raw = await records();
  await assertRejects(
    async () =>
      await buildSetupPublishPayload(
        await rpt(raw),
        await ran(raw, root),
        {
          ...base(root),
          currentIdentity: () => Promise.resolve("f".repeat(64)),
        },
      ),
    PublishRefused,
    "task set changed",
  );
});

Deno.test("publish-setup: description_sha is over the LF-normalised prompt", async () => {
  const raw = await records();
  const report = await rpt(raw);
  const rootLf = await repo(PROMPTS);
  const lf = await buildSetupPublishPayload(
    report,
    await ran(raw, rootLf),
    base(rootLf),
  );
  const rootCrlf = await repo({
    "HX-001": "Fix one.\r\nLine two.\r\n",
    "HX-002": "Fix two.\r\n",
  });
  const crlf = await buildSetupPublishPayload(
    report,
    await ran(raw, rootCrlf),
    base(rootCrlf),
  );
  assertEquals(
    lf.task_set.tasks[0]!.description_sha,
    await sha(PROMPTS["HX-001"]),
  );
  assertEquals(lf.task_set.tasks, crlf.task_set.tasks);
});
