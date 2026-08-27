/**
 * Build the B4 (over-strictness) evidence record from the stored bench corpus.
 *
 * B4 asks whether a task's oracle accepts a SECOND valid implementation, or
 * whether it has silently pinned one. The evidence for that is two independent
 * solutions, from families other than the authoring family, both passing the
 * oracle prompt-only.
 *
 * The backfill plan budgeted ~400 model calls for this. Most of it was already
 * paid for: 237 stored bench runs contain exactly those solutions, so this
 * script recovers what is already known and leaves only the genuine gaps to be
 * bought.
 *
 * Two rules keep the evidence honest:
 *
 *   - **Attempt 1 only.** An attempt-2 pass followed a repair prompt carrying
 *     the oracle's own failure output, so the solution is not independent of
 *     the oracle - which is the single thing B4 is trying to measure.
 *   - **Evidence expires.** A pass proves the oracle accepted that solution AS
 *     IT STOOD THEN. Editing the oracle afterwards invalidates it, so a task
 *     whose oracle moved after its newest qualifying pass is `stale`, not
 *     `pass`.
 *
 * Writes docs/reasoning-suite/b4-evidence.json, which scripts/gate-records.ts
 * reads to populate the B4 gate.
 *
 * Usage: deno run --allow-all scripts/b4-evidence.ts
 */

const REPO = new URL("..", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);
const DOCS = `${REPO}/docs/reasoning-suite`;

/**
 * The authoring family is excluded by the gate's own rule. Every task in this
 * suite was authored with Claude's help, so anthropic passes are never counted.
 * That is the conservative reading: if a task turns out to be human-authored,
 * its anthropic passes become admissible and the evidence only improves.
 */
const AUTHORING_FAMILY = "anthropic";

function family(model: string): string | null {
  if (model === "mock") return null;
  if (model.startsWith("claude")) return "anthropic";
  if (model.startsWith("gpt-") || model.startsWith("openai/")) return "openai";
  if (model.startsWith("gemini")) return "google";
  for (
    const [prefix, fam] of [
      ["deepseek/", "deepseek"],
      ["minimax/", "minimax"],
      ["moonshotai/", "moonshot"],
      ["qwen/", "qwen"],
      ["x-ai/", "xai"],
      ["z-ai/", "zai"],
    ] as const
  ) {
    if (model.startsWith(prefix)) return fam;
  }
  return "other";
}

async function run(cmd: [string, ...string[]]): Promise<string> {
  try {
    const [exe, ...args] = cmd;
    const p = new Deno.Command(exe, {
      args,
      cwd: REPO,
      stdout: "piped",
      stderr: "null",
    });
    return new TextDecoder().decode((await p.output()).stdout).trim();
  } catch {
    return "";
  }
}

interface Pass {
  model: string;
  when: string;
}

/** Only the fields this script reads; the stored records carry far more. */
interface StoredAttempt {
  attemptNumber?: number;
  success?: boolean;
  llmResponse?: { model?: string };
}

interface StoredResult {
  taskId?: string;
  executedAt?: string;
  attempts?: StoredAttempt[];
}

async function main() {
  // The task FILENAME carries a slug suffix the id does not, so the id has to
  // come from the manifest itself. Matching on filename silently yields zero
  // overlap with the results corpus.
  const inscope = new Map<string, string>(); // id -> tier
  for (const tier of ["hard", "medium"]) {
    for await (const e of Deno.readDir(`${REPO}/tasks/${tier}`)) {
      if (!e.isFile || !e.name.endsWith(".yml")) continue;
      const txt = await Deno.readTextFile(`${REPO}/tasks/${tier}/${e.name}`);
      const m = txt.match(/^id:\s*["']?([A-Za-z0-9-]+)/m);
      inscope.set(m?.[1] ?? e.name.slice(0, -4), tier);
    }
  }

  const attempt1 = new Map<string, Map<string, Pass>>();
  const everSolved = new Map<string, Set<string>>();
  for await (const e of Deno.readDir(`${REPO}/results`)) {
    if (!e.isFile || !/^benchmark-results-.*\.json$/.test(e.name)) continue;
    let doc: { results?: StoredResult[] };
    try {
      doc = JSON.parse(await Deno.readTextFile(`${REPO}/results/${e.name}`));
    } catch {
      continue;
    }
    for (const r of doc.results ?? []) {
      const id = r.taskId;
      if (!id || !inscope.has(id)) continue;
      const when = r.executedAt ?? "";
      for (const a of r.attempts ?? []) {
        if (!a.success) continue;
        const fam = family(a.llmResponse?.model ?? "");
        if (!fam) continue;
        if (!everSolved.has(id)) everSolved.set(id, new Set());
        everSolved.get(id)!.add(fam);
        if (a.attemptNumber !== 1) continue;
        if (!attempt1.has(id)) attempt1.set(id, new Map());
        const cur = attempt1.get(id)!.get(fam);
        if (cur === undefined || when > cur.when) {
          attempt1.get(id)!.set(fam, {
            model: a.llmResponse?.model ?? "",
            when,
          });
        }
      }
    }
  }

  // Uncommitted oracle edits count as "changed now": git log alone would call
  // a working-tree edit unchanged and wrongly keep the evidence green.
  const dirty = new Set<string>();
  for (
    const ln of (await run(["git", "status", "--porcelain", "--", "tests/al"]))
      .split("\n")
  ) {
    const m = ln.trim().match(/tests\/al\/\S+\/([^/\s]+)\.Test\.al$/);
    const name = m?.[1];
    if (name !== undefined) dirty.add(name);
  }

  const oracle = new Map<string, string>();
  for (const tier of ["hard", "medium"]) {
    for await (const e of Deno.readDir(`${REPO}/tests/al/${tier}`)) {
      if (e.isFile && e.name.endsWith(".Test.al")) {
        oracle.set(
          e.name.replace(".Test.al", ""),
          `tests/al/${tier}/${e.name}`,
        );
      }
    }
  }

  const tasks: Record<string, unknown> = {};
  const counts: Record<string, number> = {};
  for (const [id, tier] of [...inscope].sort()) {
    const outside = new Map(
      [...(attempt1.get(id) ?? new Map<string, Pass>())].filter(
        ([f]) => f !== AUTHORING_FAMILY,
      ),
    );
    const path = oracle.get(id);
    const changedAt = dirty.has(id)
      ? "uncommitted"
      : path
      ? (await run(["git", "log", "-1", "--format=%cI", "--", path])) || null
      : null;
    const newest = [...outside.values()].map((v) => v.when).sort().pop() ?? "";
    const stale = outside.size > 0 && changedAt !== null &&
      (changedAt === "uncommitted" || changedAt > newest);

    let status: string, detail: string;
    if (outside.size >= 2 && !stale) {
      status = "pass";
      detail =
        `${outside.size} independent non-authoring families passed prompt-only: ` +
        [...outside].sort().map(([f, v]) => `${f}=${v.model}`).join(", ");
    } else if (outside.size >= 2 && stale) {
      status = "stale";
      detail =
        `${outside.size} families passed, but the oracle changed after the newest pass ` +
        `(${changedAt} vs ${newest.slice(0, 10)}) - re-run required`;
    } else if (!everSolved.has(id)) {
      status = "not_runnable";
      detail =
        "no model has ever solved this task on any attempt, so a model failure cannot " +
        "distinguish an over-strict oracle from a task the model could not do; the second " +
        "implementation must be author-written";
    } else {
      status = "absent";
      detail =
        `${outside.size} of 2 required non-authoring solutions on record`;
    }
    counts[status] = (counts[status] ?? 0) + 1;
    tasks[id] = {
      status,
      tier,
      detail,
      outsideFamilies: Object.fromEntries([...outside].sort()),
      oracleChangedAt: changedAt,
      everSolved: [...(everSolved.get(id) ?? [])].sort(),
    };
  }

  const out = {
    schemaVersion: 1,
    what:
      "B4 over-strictness evidence. A task passes when TWO independent solutions from " +
      "families OTHER than the authoring family both passed the oracle prompt-only " +
      "(attempt 1). Attempt-2 passes are excluded: the model saw the oracle's failure " +
      "output, so the solution is not independent of the oracle. Evidence goes STALE " +
      "when the oracle is edited after the newest qualifying pass.",
    authoringFamilyAssumed: AUTHORING_FAMILY,
    counts,
    tasks,
  };
  await Deno.writeTextFile(
    `${DOCS}/b4-evidence.json`,
    JSON.stringify(out, null, 2) + "\n",
  );
  console.log("[b4-evidence]", JSON.stringify(counts));
  console.log(`[b4-evidence] -> ${DOCS}/b4-evidence.json`);
}

if (import.meta.main) await main();
