import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { validatePublishPayload } from "../../../site/src/lib/shared/setup-publish.ts";
import type { CampaignRecords } from "../../../src/harness/integrity.ts";
import { buildReport } from "../../../src/harness/report.ts";
import type {
  ExecutionRecord,
  JudgmentRecord,
} from "../../../src/harness/records.ts";
import {
  buildSetupPublishPayload,
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
  unscored?: boolean; // plain HX-002 repeat 2 is unscored
  pending?: boolean; // plain HX-002 repeat 2 has no judgment
}

async function records(o: Opts = {}): Promise<CampaignRecords> {
  const c = await campaign({ repeats: 2 });
  const executions: ExecutionRecord[] = [];
  const judgments: JudgmentRecord[] = [];
  for (const arm of ["plain", "skills"]) {
    for (const task of ["HX-001", "HX-002"]) {
      for (const repeat of [1, 2]) {
        const special = arm === "plain" && task === "HX-002" && repeat === 2;
        const e = execution(c, { arm, task, repeat }, {
          observed: {
            harness_version: "2.1.282",
            models: null,
            loaded_components: null,
          },
          validity: {
            incomplete_telemetry: special && o.unknownCost ? ["cost_usd"] : [],
            incomplete_observed: [],
            infra_exposed: false,
          },
          telemetry: {
            ...telemetry(special && o.unknownCost ? null : 1),
            wall_ms: 1000,
          },
        });
        executions.push(e);
        if (special && o.pending) continue;
        if (special && o.unscored) {
          // Three unscored judgments exhaust the rejudge budget: terminal unscored.
          for (let i = 0; i < 3; i++) judgments.push(judgment(c, e, null));
          continue;
        }
        // plain fails HX-002 (and everything when cost is null: no solves).
        judgments.push(
          judgment(
            c,
            e,
            !(arm === "plain" && (task === "HX-002" || o.unknownCost)),
          ),
        );
      }
    }
  }
  return { campaign: c, executions, artifacts: [], judgments };
}

async function repo(
  prompts: Record<string, string>,
  harness = "claude-code",
): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "publish-setup-" });
  await Deno.mkdir(join(root, "harness", "configs"), { recursive: true });
  await Deno.mkdir(join(root, "harness", "bundles", "i", "skills", "s1"), {
    recursive: true,
  });
  await Deno.writeTextFile(
    join(root, "harness", "bundles", "i", "CLAUDE.md"),
    "be good\n",
  );
  for (const id of ["plain", "skills"]) {
    await Deno.writeTextFile(
      join(root, "harness", "configs", `${id}.yml`),
      `id: ${id}
harness: ${harness}
harness_version: "2.1.282"
models:
  main: anthropic/model-a
  helper: anthropic/model-b
components:
  instructions: bundles/i
  skills: bundles/i/skills
  mcp: [al-tools]
limits: { timeout_min: 30, max_budget_usd: 5 }
`,
    );
  }
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

const PROMPTS = { "HX-001": "Fix one.\nLine two.\n", "HX-002": "Fix two.\n" };
const base = (repoRoot: string) => ({
  arm: "plain",
  setupId: "plain-setup",
  submissionId: null,
  description: "A plain setup",
  visibility: "public" as const,
  displayName: null,
  repoRoot,
});

async function sha(text: string): Promise<string> {
  const d = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.test("publish-setup: a complete campaign maps to cells, score, cost and setup metadata", async () => {
  const recs = await records();
  const report = await buildReport(recs, { resamples: 50, seed: 1 });
  const root = await repo(PROMPTS);
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
  const recs = await records({ unscored: true });
  const report = await buildReport(recs, {
    resamples: 50,
    seed: 1,
    judging: { ...campaignJudging(recs.campaign), scorer: SCORERS_V1_FP },
  });
  const p = await buildSetupPublishPayload(
    report,
    recs,
    base(await repo(PROMPTS)),
  );
  assertEquals(
    p.run.cells.find((c) => c.task_id === "HX-002" && c.repeat === 2)!.outcome,
    "infra",
  );
  assertEquals(p.run.excluded_cells, 1);
  assertEquals(validatePublishPayload(p).ok, true);
});

Deno.test("publish-setup: a null cost with an unknown-spend cell gets a price note", async () => {
  const recs = await records({ unknownCost: true });
  const report = await buildReport(recs, { resamples: 50, seed: 1 });
  const arm = report.arms.find((a) => a.arm === "plain")!;
  assertEquals(arm.cost_per_solved_task, null);
  const p = await buildSetupPublishPayload(
    report,
    recs,
    base(await repo(PROMPTS)),
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

Deno.test("publish-setup: a partial report is refused", async () => {
  const recs = await records({ pending: true });
  const report = await buildReport(recs, { resamples: 50, seed: 1 });
  assert(report.partial !== null);
  await assertRejects(
    async () =>
      await buildSetupPublishPayload(report, recs, base(await repo(PROMPTS))),
    PublishRefused,
    "partial",
  );
});

Deno.test("publish-setup: two harness versions are refused", async () => {
  // Integrity pins observed to the manifest, so skew the records after the report.
  const good = await records();
  const report = await buildReport(good, { resamples: 50, seed: 1 });
  const recs = {
    ...good,
    executions: good.executions.map((e) =>
      e.arm === "plain" && e.task_id === "HX-001" && e.repeat === 1
        ? { ...e, observed: { ...e.observed, harness_version: "2.1.999" } }
        : e
    ),
  };
  await assertRejects(
    async () =>
      await buildSetupPublishPayload(report, recs, base(await repo(PROMPTS))),
    PublishRefused,
    "2.1.999",
  );
});

Deno.test("publish-setup: a mock arm and an unknown arm are refused", async () => {
  const recs = await records();
  const report = await buildReport(recs, { resamples: 50, seed: 1 });
  await assertRejects(
    async () =>
      await buildSetupPublishPayload(
        report,
        recs,
        base(await repo(PROMPTS, "mock")),
      ),
    PublishRefused,
    "mock",
  );
  await assertRejects(
    async () =>
      await buildSetupPublishPayload(report, recs, {
        ...base(await repo(PROMPTS)),
        arm: "nope",
      }),
    PublishRefused,
    "nope",
  );
});

Deno.test("publish-setup: a missing prompt.md is refused", async () => {
  const recs = await records();
  const report = await buildReport(recs, { resamples: 50, seed: 1 });
  await assertRejects(
    async () =>
      await buildSetupPublishPayload(
        report,
        recs,
        base(await repo({ "HX-001": "x\n" })),
      ),
    PublishRefused,
    "HX-002",
  );
});

Deno.test("publish-setup: description_sha is over the LF-normalised prompt", async () => {
  const recs = await records();
  const report = await buildReport(recs, { resamples: 50, seed: 1 });
  const lf = await buildSetupPublishPayload(
    report,
    recs,
    base(await repo(PROMPTS)),
  );
  const crlf = await buildSetupPublishPayload(
    report,
    recs,
    base(
      await repo({
        "HX-001": "Fix one.\r\nLine two.\r\n",
        "HX-002": "Fix two.\r\n",
      }),
    ),
  );
  assertEquals(
    lf.task_set.tasks[0]!.description_sha,
    await sha(PROMPTS["HX-001"]),
  );
  assertEquals(lf.task_set.tasks, crlf.task_set.tasks);
});
