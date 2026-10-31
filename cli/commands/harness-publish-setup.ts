/**
 * `harness publish-setup` and `harness promote-setup-set` (setups leaderboard
 * part 3). Logic lives here so harness-command.ts only registers the commands;
 * every outside effect is an injectable dep.
 */
import * as colors from "@std/fmt/colors";
import type { SetupPublishPayload } from "../../site/src/lib/shared/setup-publish.ts";
import type { AdminConfig } from "../../src/ingest/types.ts";
import {
  type IngestCliFlags,
  loadAdminConfig,
  readPrivateKey,
} from "../../src/ingest/config.ts";
import { postSetupPromote, postSetupPublish } from "../../src/ingest/setups.ts";
import { CentralGaugeError } from "../../src/errors.ts";
import {
  buildSetupPublishPayload,
  PublishRefused,
} from "../../src/harness/publish-setup.ts";
import type { CampaignRecords } from "../../src/harness/integrity.ts";
import { RecordStore } from "../../src/harness/records.ts";
import type { HarnessReport } from "../../src/harness/report.ts";
import type { ReportOptions } from "./harness-command.ts";

export interface PublishSetupOptions {
  arm: string;
  setupId: string;
  judging: "campaign" | "current";
  campaign?: string | undefined;
  submission?: string | undefined;
  description?: string | undefined;
  visibility?: "public" | "private" | undefined;
  displayName?: string | undefined;
  resultsDir: string;
  root: string;
  apply: boolean;
  resamples: number;
  seed: number;
}

export interface PublishSetupDeps {
  report: (e: string, o: ReportOptions) => Promise<HarnessReport>;
  records: (
    resultsDir: string,
    experiment: string,
    campaignId: string,
  ) => Promise<CampaignRecords>;
  build: typeof buildSetupPublishPayload;
  loadConfig: (cwd: string, flags: IngestCliFlags) => Promise<AdminConfig>;
  readKey: (path: string) => Promise<Uint8Array>;
  publish: typeof postSetupPublish;
  promote: typeof postSetupPromote;
  log: (line: string) => void;
  err: (line: string) => void;
}

export async function loadRecords(
  resultsDir: string,
  experiment: string,
  campaignId: string,
): Promise<CampaignRecords> {
  const store = new RecordStore(resultsDir);
  const campaign = (await store.campaigns(experiment)).find((c) =>
    c.id === campaignId
  );
  if (!campaign) {
    throw new CentralGaugeError(
      `No campaign ${campaignId} for experiment ${experiment} in ${resultsDir}`,
      "HARNESS_NO_CAMPAIGN",
    );
  }
  const executions = await store.executions(campaign.id);
  return { campaign, executions, artifacts: [], judgments: [] };
}

export const publishSetupDeps = (
  report: PublishSetupDeps["report"],
): PublishSetupDeps => ({
  report,
  records: loadRecords,
  build: buildSetupPublishPayload,
  loadConfig: loadAdminConfig,
  readKey: readPrivateKey,
  publish: postSetupPublish,
  promote: postSetupPromote,
  log: (l) => console.log(l),
  err: (l) => console.error(l),
});

const fail = (d: PublishSetupDeps, msg: string): number => {
  d.err(`${colors.red("[FAIL]")} ${msg}`);
  return 1;
};

function describePostError(err: unknown): string {
  if (err instanceof CentralGaugeError && err.code === "already_published") {
    return `${err.message} (already_published: this run may already be on the site, for example from an earlier attempt that got through; check the setups page before retrying)`;
  }
  if (err instanceof CentralGaugeError) return `${err.message} (${err.code})`;
  return err instanceof Error ? err.message : String(err);
}

function summary(p: SetupPublishPayload): string[] {
  const r = p.run;
  const price = r.cost_per_solved_usd === null
    ? (r.price_note ?? "not available")
    : `$${r.cost_per_solved_usd.toFixed(4)} per solved task${
      r.price_note ? ` (${r.price_note})` : ""
    }`;
  const tasks = new Set(r.cells.map((c) => c.task_id)).size;
  return [
    `setup id:       ${p.setup.id}`,
    `tool:           ${p.setup.agent_tool}`,
    `base model:     ${p.setup.base_model}`,
    `tool version:   ${r.tool_version}`,
    `task set hash:  ${p.task_set.hash}`,
    `tasks:          ${tasks}`,
    `repeats:        ${r.repeats}`,
    `score:          ${r.score}`,
    `price:          ${price}`,
    `excluded cells: ${r.excluded_cells}`,
    `submission:     ${p.submission_id ?? "(none)"}`,
    `run id:         ${r.id}`,
  ];
}

/** Returns the process exit code. */
export async function runPublishSetup(
  experiment: string,
  o: PublishSetupOptions,
  d: PublishSetupDeps,
): Promise<number> {
  try {
    // Credentials first, so a missing key fails before any report work.
    let config: AdminConfig | undefined;
    let key: Uint8Array | undefined;
    if (o.apply) {
      try {
        config = await d.loadConfig(Deno.cwd(), {});
        key = await d.readKey(config.adminKeyPath);
      } catch (err) {
        return fail(
          d,
          `admin credentials unavailable: ${(err as Error).message}`,
        );
      }
    }
    const report = await d.report(experiment, {
      resultsDir: o.resultsDir,
      campaign: o.campaign,
      resamples: o.resamples,
      seed: o.seed,
      judging: o.judging,
      root: o.root,
    });
    const records = await d.records(
      o.resultsDir,
      experiment,
      report.campaign.id,
    );
    const payload = await d.build(report, records, {
      arm: o.arm,
      setupId: o.setupId,
      submissionId: o.submission ?? null,
      description: o.description ?? null,
      visibility: o.visibility ?? null,
      displayName: o.displayName ?? null,
      repoRoot: o.root,
    });
    for (const l of summary(payload)) d.log(l);
    if (!config || !key) {
      d.log(`${colors.yellow("[DRY]")} nothing sent; pass --apply to publish`);
      return 0;
    }
    const res = await d.publish(config, key, payload);
    d.log(
      `${
        colors.green("[OK]")
      } published run ${res.run_id} for setup ${res.setup_id} on task set ${res.task_set_hash}`,
    );
    return 0;
  } catch (err) {
    if (err instanceof PublishRefused) return fail(d, err.message);
    if (err instanceof CentralGaugeError) {
      return fail(d, describePostError(err));
    }
    throw err;
  }
}

/** Returns the process exit code. */
export async function runPromoteSetupSet(
  hash: string,
  o: { apply: boolean },
  d: PublishSetupDeps,
): Promise<number> {
  if (!o.apply) {
    d.log(
      `${
        colors.yellow("[DRY]")
      } would promote task set ${hash}; pass --apply to send`,
    );
    return 0;
  }
  try {
    const config = await d.loadConfig(Deno.cwd(), {});
    const key = await d.readKey(config.adminKeyPath);
    const res = await d.promote(config, key, hash);
    d.log(
      `${
        colors.green("[OK]")
      } promoted task set ${res.hash} at ${res.promoted_at}`,
    );
    return 0;
  } catch (err) {
    return fail(d, describePostError(err));
  }
}
