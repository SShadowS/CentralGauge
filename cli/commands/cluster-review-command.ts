/**
 * D-data §D7 — `centralgauge lifecycle cluster-review` interactive CLI.
 *
 * Drains the pending_review queue (the 0.70 ≤ cosine < 0.85 ambiguity
 * band populated by the D1.6 backfill + Plan D-prompt's analyzer) one
 * row at a time. For each pending pair the operator sees:
 *
 *   - the proposed concept slug (LLM-coined free text)
 *   - the nearest existing canonical slug + similarity score
 *   - 3 sample shortcoming descriptions per side
 *
 * and presses one of:
 *
 *   M → merge proposed into existing  (writes concept.aliased)
 *   C → create a new concept           (writes concept.created)
 *   S → split the existing concept     (writes concept.split + N children)
 *   N → skip / decide later            (no event; row stays pending)
 *
 * Resumable: each decision flips the row to status='accepted' /
 * 'rejected'; re-running the command picks up where the operator left
 * off via the queue endpoint's `WHERE status = 'pending'` filter.
 *
 * Auth: Ed25519 admin scope. The /decide endpoint is dual-auth target
 * (CF Access JWT OR Ed25519); until Plan F ships authenticateAdminRequest
 * the endpoint accepts Ed25519 only and the swap is patched in by Plan F.
 *
 * @module cli/commands/cluster-review
 */

import { Command } from "@cliffy/command";
import { Confirm, Input, Select } from "@cliffy/prompt";
import * as colors from "@std/fmt/colors";
import { loadAdminConfig, readPrivateKey } from "../../src/ingest/config.ts";
import { signPayload } from "../../src/ingest/sign.ts";
import { postWithRetry } from "../../src/ingest/client.ts";
import { collectEnvelope } from "../../src/lifecycle/envelope.ts";

export interface PendingRow {
  id: number;
  model_slug: string;
  concept_slug_proposed: string;
  confidence: number;
  created_at: number;
  payload: {
    nearest_concept_id: number | null;
    similarity: number | null;
    shortcoming_ids: number[];
    sample_descriptions: string[];
    al_concept: string;
  };
  nearest: {
    id: number | null;
    slug: string | null;
    description: string | null;
    sample_descriptions: string[];
  };
}

async function fetchQueue(
  siteUrl: string,
  signed: { version: 1; payload: unknown; signature: unknown },
): Promise<PendingRow[]> {
  const resp = await postWithRetry(
    `${siteUrl}/api/v1/admin/lifecycle/cluster-review/queue`,
    signed,
  );
  if (!resp.ok) {
    throw new Error(`fetch queue failed: ${resp.status} ${await resp.text()}`);
  }
  const body = (await resp.json()) as { rows: PendingRow[] };
  return body.rows;
}

async function gitUserEmail(): Promise<string | null> {
  try {
    const cmd = new Deno.Command("git", {
      args: ["config", "user.email"],
      stdout: "piped",
      stderr: "null",
    });
    const { stdout, success } = await cmd.output();
    if (!success) return null;
    const out = new TextDecoder().decode(stdout).trim();
    return out || null;
  } catch {
    return null;
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

function renderRow(row: PendingRow): void {
  console.log(colors.bold("─".repeat(72)));
  console.log(`Proposed:    ${colors.yellow(row.concept_slug_proposed)}`);
  const simStr = row.payload.similarity != null
    ? row.payload.similarity.toFixed(3)
    : "n/a";
  console.log(
    `Nearest:     ${
      colors.cyan(row.nearest.slug ?? "(none)")
    }  (similarity ${simStr})`,
  );
  console.log(`Model:       ${row.model_slug}`);
  console.log(`AL concept:  ${row.payload.al_concept}`);
  console.log(
    `Affects:     ${row.payload.shortcoming_ids.length} shortcomings`,
  );
  console.log();
  console.log(colors.bold("Proposed-side sample descriptions:"));
  if (row.payload.sample_descriptions.length === 0) {
    console.log(colors.gray("  (none)"));
  } else {
    for (const d of row.payload.sample_descriptions.slice(0, 3)) {
      console.log(colors.gray(`  - ${truncate(d, 200)}`));
    }
  }
  console.log();
  console.log(
    colors.bold(
      `Existing '${row.nearest.slug ?? "?"}' sample descriptions:`,
    ),
  );
  if (row.nearest.sample_descriptions.length === 0) {
    console.log(colors.gray("  (none)"));
  } else {
    for (const d of row.nearest.sample_descriptions.slice(0, 3)) {
      console.log(colors.gray(`  - ${truncate(d, 200)}`));
    }
  }
  console.log(colors.bold("─".repeat(72)));
}

export interface PostDeps {
  url: string;
  privKey: Uint8Array;
  keyId: number;
  envelopeJson: string;
  actor: string;
}

/**
 * D7.4 — Injectable POST function. Production callers leave `postFn`
 * undefined so it falls through to {@link postWithRetry}; tests pass a
 * stub to capture (url, body) without spinning up a real fetch loop.
 */
export interface PostOpts {
  postFn?: (url: string, body: unknown) => Promise<Response>;
}

export async function postDecision(
  deps: PostDeps,
  kind: "merge" | "create",
  row: PendingRow,
  reason: string | undefined,
  opts: PostOpts = {},
): Promise<void> {
  const payload = {
    pending_review_id: row.id,
    decision: kind,
    actor_id: deps.actor,
    reason: reason ?? null,
    envelope_json: deps.envelopeJson,
    ts: Date.now(),
  };
  const sig = await signPayload(payload, deps.privKey, deps.keyId);
  const post = opts.postFn ?? postWithRetry;
  const resp = await post(
    `${deps.url}/api/v1/admin/lifecycle/cluster-review/decide`,
    { version: 1, payload, signature: sig },
  );
  if (!resp.ok) {
    throw new Error(`decide failed: ${resp.status} ${await resp.text()}`);
  }
}

export async function postSplit(
  deps: PostDeps,
  row: PendingRow,
  newSlugs: string[],
  reason: string,
  opts: PostOpts = {},
): Promise<void> {
  const payload = {
    pending_review_id: row.id,
    decision: "split" as const,
    actor_id: deps.actor,
    reason,
    envelope_json: deps.envelopeJson,
    ts: Date.now(),
    new_slugs: newSlugs,
  };
  const sig = await signPayload(payload, deps.privKey, deps.keyId);
  const post = opts.postFn ?? postWithRetry;
  const resp = await post(
    `${deps.url}/api/v1/admin/lifecycle/cluster-review/decide`,
    { version: 1, payload, signature: sig },
  );
  if (!resp.ok) {
    throw new Error(`split failed: ${resp.status} ${await resp.text()}`);
  }
}

interface ClusterReviewFlags {
  actor?: string;
  limit: number;
}

async function handleClusterReview(flags: ClusterReviewFlags): Promise<void> {
  const cwd = Deno.cwd();
  const config = await loadAdminConfig(cwd, {});
  const adminPriv = await readPrivateKey(config.adminKeyPath);
  const adminKeyId = config.adminKeyId;
  const actor = flags.actor ?? (await gitUserEmail()) ?? "operator-unknown";
  const envelope = JSON.stringify(await collectEnvelope({}));

  console.log(colors.cyan(`[INFO] actor: ${actor}`));

  const fetchPayload = { scope: "list" as const, ts: Date.now() };
  const fetchSig = await signPayload(fetchPayload, adminPriv, adminKeyId);
  const queue = await fetchQueue(config.url, {
    version: 1,
    payload: fetchPayload,
    signature: fetchSig,
  });

  if (queue.length === 0) {
    console.log(colors.green("[OK] queue empty — nothing to review"));
    return;
  }

  console.log(
    colors.bold(
      `\n${queue.length} pending entr${queue.length === 1 ? "y" : "ies"}\n`,
    ),
  );

  const deps: PostDeps = {
    url: config.url,
    privKey: adminPriv,
    keyId: adminKeyId,
    envelopeJson: envelope,
    actor,
  };

  let processed = 0;
  for (const row of queue) {
    if (processed >= flags.limit) break;
    renderRow(row);
    const choice = (await Select.prompt({
      message: `Decision for '${row.concept_slug_proposed}'`,
      options: [
        {
          name: `M  Merge into '${row.nearest.slug ?? "?"}'`,
          value: "merge",
        },
        {
          name: `C  Create new concept '${row.concept_slug_proposed}'`,
          value: "create",
        },
        {
          name: `S  Split existing '${row.nearest.slug ?? "?"}' (advanced)`,
          value: "split",
        },
        { name: "N  Skip / decide later", value: "skip" },
      ],
    })) as "merge" | "create" | "split" | "skip";

    if (choice === "skip") {
      console.log(colors.gray("[SKIP] left pending"));
      processed++;
      continue;
    }

    let reason: string | undefined;
    if (choice !== "merge") {
      reason = await Input.prompt({
        message: "Reason (logged to event)",
        default: "",
      });
    }

    try {
      if (choice === "merge") {
        await postDecision(deps, "merge", row, reason);
        console.log(
          colors.green(
            `[MERGE] ${row.concept_slug_proposed} → ${row.nearest.slug ?? "?"}`,
          ),
        );
      } else if (choice === "create") {
        await postDecision(deps, "create", row, reason);
        console.log(colors.cyan(`[CREATE] ${row.concept_slug_proposed}`));
      } else {
        const newCountStr = await Input.prompt({
          message: "How many new concept rows from the split?",
          default: "2",
        });
        const newCount = parseInt(newCountStr, 10);
        if (!Number.isFinite(newCount) || newCount < 2) {
          console.log(
            colors.yellow("[ABORT] split needs >=2 children — skipped"),
          );
          processed++;
          continue;
        }
        const newSlugs: string[] = [];
        for (let i = 0; i < newCount; i++) {
          newSlugs.push(
            await Input.prompt({ message: `New concept slug #${i + 1}` }),
          );
        }
        const confirmed = await Confirm.prompt({
          message: `Split '${row.nearest.slug ?? "?"}' into [${
            newSlugs.join(", ")
          }] — confirm?`,
          default: false,
        });
        if (!confirmed) {
          console.log(colors.yellow("[ABORT] split cancelled"));
          processed++;
          continue;
        }
        await postSplit(deps, row, newSlugs, reason ?? "");
        console.log(
          colors.cyan(
            `[SPLIT] ${row.nearest.slug ?? "?"} → ${newSlugs.length} new`,
          ),
        );
      }
    } catch (e) {
      console.error(
        colors.red(
          `[ERR] decision failed: ${e instanceof Error ? e.message : e}`,
        ),
      );
    }
    processed++;
  }
  console.log(colors.bold(`\n[DONE] processed ${processed}`));
}

export function registerClusterReviewCommand(parent: Command): void {
  parent.command(
    "cluster-review",
    new Command()
      .description(
        "Interactive triage of the cluster review queue (0.70-0.85 similarity band)",
      )
      .option(
        "--actor <id:string>",
        "actor identifier (defaults to git user.email)",
      )
      .option(
        "--limit <n:integer>",
        "process at most N entries",
        { default: 999 },
      )
      .action((flags) =>
        handleClusterReview(flags as unknown as ClusterReviewFlags)
      ),
  );
}
