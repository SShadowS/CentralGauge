/**
 * Two-stage pre-registration of a confirmatory harness campaign (spec v2
 * section 7, round 2 finding 1, cross-plan ruling 5). Stage A (protocol,
 * inference contract, rules) is frozen before screening; stage B adds only
 * the stage-B keys and proves its ancestry by hashing its stage-A projection.
 */

import { join, relative } from "@std/path";
import { parse } from "@std/yaml";
import { z } from "zod";
import { canonicalJSON } from "../../shared/canonical.ts";
import { ValidationError } from "../errors.ts";
import {
  ContrastSchema,
  type Experiment,
  InteractionSchema,
} from "./config.ts";
import { hashFile, hashJson, sha256Hex } from "./hash.ts";
import { Sha256Hex } from "./identity.ts";
import { isOwnerApproval } from "./records.ts";
import { readYaml } from "./yaml.ts";

const Approval = z.string().refine(
  isOwnerApproval,
  "an OWNER-APPROVED: <words> (<ISO-8601 time>) line",
);
const Rule = z.discriminatedUnion("rule", [
  z.strictObject({ rule: z.literal("suppress_any_undefined") }),
  z.strictObject({
    rule: z.literal("min_defined_share"),
    share: z.number().gt(0.5).max(1),
  }),
]);
const FileRef = z.strictObject({ path: z.string().min(1), sha256: Sha256Hex });

export const PreregSchema = z.strictObject({
  v: z.literal(1),
  experiment: z.string().min(1),
  protocol: z.strictObject({
    arms: z.array(z.string().min(1)).min(2),
    contrasts: z.array(ContrastSchema).min(1),
    interaction: InteractionSchema.nullable(),
  }),
  approval: Approval,
  population: z.string().trim().min(1),
  primary_metric: z.literal("cost_per_solved_task"),
  confirmatory: z.boolean(),
  family: z.array(z.string().min(1)),
  alpha: z.number().gt(0).lt(1),
  test: z.strictObject({
    sides: z.literal("two"),
    p_value: z.literal("percentile_bootstrap_plus_one"),
    adjustment: z.literal("holm"),
    direction: z.literal("sign_of_delta"),
  }),
  intervals: z.strictObject({
    reported: z.literal("per_contrast_unadjusted"),
    beside: z.literal("bonferroni_same_draws"),
  }),
  bootstrap: z.strictObject({
    unit: z.literal("task"),
    resamples: z.number().int().min(1000),
    seed: z.number().int().min(0).max(0xffffffff),
    level: z.number().gt(0).lt(1),
  }),
  zero_solve: Rule,
  missing_pairs: z.literal("per_contrast_matched"),
  held_out: z.strictObject({
    count: z.number().int().min(0),
    rule: z.string().min(1),
    /** M8's start seal and the ids M8-15a designated there (stage A follows the seal). */
    seal: z.string().regex(/^harness-v2-screen-[a-z0-9-]+$/),
    tasks: z.array(z.string().regex(/^HX-\d{3}$/)),
    in_family: z.literal(false),
  }).refine(
    (h) => h.tasks.length === h.count,
    "held_out.tasks must list count ids",
  ),
  measures: z.strictObject({
    fingerprint: Sha256Hex,
    unknown_symbol_codes: z.array(z.string().regex(/^AL\d{4}$/)).min(1),
    ruleset_sha256: Sha256Hex,
    canary_codes: z.array(z.string()).min(1),
    workflow_execution: z.literal("used_execution"),
    effort_execution: z.literal("every_attempt"),
  }),
  exploratory_metrics: z.array(z.string().min(1)).min(1),
  simulation: z.strictObject({
    script_sha256: Sha256Hex,
    // Every simulation argument is numeric except power_gate (M11-09b), an enum.
    args: z.record(z.string(), z.union([z.number(), z.string()])).superRefine(
      (args, ctx) => {
        for (const [k, v] of Object.entries(args)) {
          const ok = k === "power_gate"
            ? v === "fitted" || v === "stress"
            : typeof v === "number";
          if (!ok) {
            ctx.addIssue({
              code: "custom",
              path: [k],
              message: k === "power_gate"
                ? 'power_gate must be "fitted" or "stress"'
                : "simulation args are numeric",
            });
          }
        }
      },
    ),
  }),
  design_rule: z.string().trim().min(1),
  // Stage B keys: empty in stage A.
  stage_a: z.strictObject({ sha256: Sha256Hex }).nullable(),
  experiment_hash: Sha256Hex.nullable(),
  selection: z.strictObject({
    path: z.string().min(1),
    sha256: Sha256Hex,
    selected: z.array(z.string()).min(1),
    held_out: z.array(z.string()),
  }).nullable(),
  design: z.strictObject({
    tasks: z.number().int().positive(),
    repeats: z.number().int().positive(),
  }).nullable(),
  power_simulation: z.strictObject({
    inputs: z.array(FileRef).min(1),
    output: FileRef,
  }).nullable(),
  compiler_identity: z.string().min(1).nullable(),
  stage_b_approval: Approval.nullable(),
  amendments: z.array(z.strictObject({
    key: z.enum(["design", "family", "confirmatory"]),
    from: z.json(),
    to: z.json(),
    reason: z.string().trim().min(1),
    approval: Approval,
  })),
}).superRefine((p, ctx) => {
  const inter = p.protocol.interaction?.status === "confirmatory";
  if (p.family.includes("interaction") !== (inter && p.confirmatory)) {
    ctx.addIssue({
      code: "custom",
      message: "interaction is in the family exactly when it is confirmatory",
      path: ["family"],
    });
  }
  if (p.confirmatory && p.family.length === 0) {
    ctx.addIssue({
      code: "custom",
      message: "a confirmatory pre-registration needs a family",
      path: ["family"],
    });
  }
});
export type Prereg = z.output<typeof PreregSchema>;

export const STAGE_B_KEYS = [
  "stage_a",
  "experiment_hash",
  "selection",
  "design",
  "power_simulation",
  "compiler_identity",
  "stage_b_approval",
] as const;

/** The stage-A document a stage-B file claims to extend: amendments reverted, stage-B keys emptied. */
export function stageAOf(doc: Prereg): Prereg {
  const a: Record<string, unknown> = { ...doc };
  for (const am of [...doc.amendments].reverse()) a[am.key] = am.from;
  for (const k of STAGE_B_KEYS) a[k] = null;
  a["amendments"] = [];
  return a as Prereg;
}

export function protocolSha(doc: Prereg): Promise<string> {
  return hashJson({ preregistration_stage_a: stageAOf(doc) });
}

export function familyProblems(doc: Prereg, e: Experiment): string[] {
  const out: string[] = [];
  if (e.primary_metric !== doc.primary_metric) {
    out.push(
      `experiment primary_metric ${e.primary_metric} does not match the pre-registration's primary_metric ${doc.primary_metric}`,
    );
  }
  const ids = (e.contrasts ?? []).map((c) => c.id);
  const fam = doc.family.filter((id) => id !== "interaction");
  const amended = doc.amendments.some((a) => a.key === "family");
  let i = 0;
  for (const id of ids) if (fam[i] === id) i++;
  if (i !== fam.length) {
    out.push(
      `family ${doc.family.join(",")} is not in contrast order ${
        ids.join(",")
      }`,
    );
  }
  if (!amended && doc.confirmatory && fam.length !== ids.length) {
    out.push("family must hold every contrast unless amended");
  }
  if (new Set(doc.family).size !== doc.family.length) {
    out.push("duplicate family member");
  }
  const status = e.interaction?.status ?? null;
  const pre = doc.protocol.interaction?.status ?? null;
  if (status !== pre) {
    out.push(
      `interaction status ${status} does not match the pre-registration (${pre})`,
    );
  }
  // The schema rule again: callers may pass a spread copy that was never parsed.
  if (
    doc.family.includes("interaction") !==
      (pre === "confirmatory" && doc.confirmatory)
  ) {
    out.push("interaction is in the family exactly when it is confirmatory");
  }
  return out;
}

export const STAGE_A_TAG = "harness-v2-prereg-a";

/**
 * What the owner approved, read OUTSIDE the editable document (round 2
 * finding 1): the decision file's protocol hash, whether the stage-A tag
 * still resolves to the tag object the decision recorded, and the protocol
 * hash of the stage-A file committed at that tag.
 */
export interface StageAAnchor {
  approved_protocol_sha256: string;
  /** null when the tag or the file at the tag is missing or does not parse. */
  tag_protocol_sha256: string | null;
  tag_moved: boolean;
}

export interface PreregContext {
  experiment: Experiment;
  experimentHash: string;
  /** Task ids of the campaign task set. */
  taskIds: string[];
  /** The referenced files as read by the caller (sha256 by hashFile). */
  selection: { sha256: string; json: unknown } | null;
  simulation: { sha256: string; json: unknown } | null;
  anchor: StageAAnchor;
  /** null: no stage-B decision was supplied or it did not parse (never campaign-ready). */
  stageB: StageBAnchor | null;
}

export const STAGE_B_TAG = "harness-v2-prereg-b";

/**
 * What the owner approved at stage B, read OUTSIDE the editable document
 * (round 3 finding 1): the decision file's hash of the approved stage-B bytes
 * and its approved amendment keys, the bytes of the current file and of the
 * file committed at harness-v2-prereg-b, and whether that tag moved. Hashes
 * are sha256 of the file text with CRLF normalized to LF.
 */
export interface StageBAnchor {
  approved_sha256: string;
  file_sha256: string;
  tag_file_sha256: string | null;
  tag_moved: boolean;
  approved_amendments: string[];
}

/** Structural equality: object key order is irrelevant, array order is not. */
const same = (a: unknown, b: unknown) => {
  try {
    return canonicalJSON(a) === canonicalJSON(b);
  } catch {
    return false; // undefined or non-finite values never compare equal
  }
};
const sorted = (xs: string[]) => [...xs].sort();
const textSha = (t: string) =>
  sha256Hex(new TextEncoder().encode(t.replaceAll("\r\n", "\n")));

export async function preregProblems(
  doc: Prereg,
  c: PreregContext,
): Promise<string[]> {
  const out: string[] = [];
  for (const k of STAGE_B_KEYS) {
    if (doc[k] === null) out.push(`stage B is not frozen: ${k}`);
  }
  if (out.length > 0) return out;
  const mine = await protocolSha(doc);
  if (doc.stage_a!.sha256 !== mine) {
    out.push("stage B does not descend from stage A (projection hash differs)");
  }
  // The external anchor: the document's own stage_a value is never trusted alone.
  if (mine !== c.anchor.approved_protocol_sha256) {
    out.push(
      `stage A of this document (${
        mine.slice(0, 12)
      }) differs from the approved stage A (${
        c.anchor.approved_protocol_sha256.slice(0, 12)
      }, decision file)`,
    );
  }
  if (c.anchor.tag_moved) {
    out.push(
      `${STAGE_A_TAG} no longer resolves to the tag object recorded in the decision file`,
    );
  }
  if (c.anchor.tag_protocol_sha256 !== c.anchor.approved_protocol_sha256) {
    out.push(
      `stage A at ${STAGE_A_TAG} (${
        c.anchor.tag_protocol_sha256?.slice(0, 12) ?? "missing"
      }) differs from the approved stage A`,
    );
  }
  // Stage-B anchor: the bytes and every amendment must be externally approved;
  // approval text inside the document authorizes nothing (round 3 finding 1).
  const b = c.stageB;
  const bOk = b !== null && !b.tag_moved &&
    b.file_sha256 === b.approved_sha256 &&
    b.tag_file_sha256 === b.approved_sha256;
  if (b === null) {
    out.push("stage B is not externally approved (no stage-B decision file)");
  } else {
    if (b.file_sha256 !== b.approved_sha256) {
      out.push(
        "stage-B file differs from the externally approved stage-B bytes (decision file)",
      );
    }
    if (b.tag_moved) {
      out.push(
        `${STAGE_B_TAG} no longer resolves to the tag object recorded in the stage-B decision file`,
      );
    }
    if (b.tag_file_sha256 !== b.approved_sha256) {
      out.push(
        `stage B at ${STAGE_B_TAG} (${
          b.tag_file_sha256?.slice(0, 12) ?? "missing"
        }) differs from the approved stage-B bytes`,
      );
    }
  }
  const authorized = (key: string) =>
    bOk && b!.approved_amendments.includes(key);
  for (const am of doc.amendments) {
    if (!same((doc as Record<string, unknown>)[am.key], am.to)) {
      out.push(`amendment of ${am.key} does not match its value`);
    }
    if (!authorized(am.key)) {
      out.push(
        `amendment of ${am.key} is not externally approved (stage-B decision file)`,
      );
    }
  }
  const e = c.experiment;
  if (!same(sorted(doc.protocol.arms), sorted([e.baseline, ...e.variants]))) {
    out.push("protocol arms differ from the experiment");
  }
  if (!same(doc.protocol.contrasts, e.contrasts ?? [])) {
    out.push("protocol contrasts differ from the experiment");
  }
  if (!same(doc.protocol.interaction, e.interaction ?? null)) {
    out.push("protocol interaction differs from the experiment");
  }
  out.push(...familyProblems(doc, e));
  if (doc.experiment_hash !== c.experimentHash) {
    out.push(
      `experiment_hash ${doc.experiment_hash} differs from the experiment (${c.experimentHash})`,
    );
  }
  const d = doc.design!;
  if (d.repeats !== e.repeats) {
    out.push(
      `design repeats ${d.repeats} differ from the experiment's ${e.repeats}`,
    );
  }
  const s = doc.selection!;
  if (d.tasks !== s.selected.length) {
    out.push(
      `design tasks ${d.tasks} differ from the ${s.selected.length} selected tasks`,
    );
  }
  if (s.held_out.length !== doc.held_out.count) {
    out.push(
      `held-out count ${s.held_out.length} differs from the frozen ${doc.held_out.count}`,
    );
  }
  if (!same(sorted(s.held_out), sorted(doc.held_out.tasks))) {
    out.push(
      `held-out tasks ${sorted(s.held_out).join(",")} differ from stage A's ${
        sorted(doc.held_out.tasks).join(",")
      }`,
    );
  }
  if (!same(sorted(c.taskIds), sorted([...s.selected, ...s.held_out]))) {
    out.push("campaign task set differs from selected + held-out");
  }
  const sel = c.selection?.json as {
    status?: string;
    held_out?: string[];
    selection?: { n?: number; selected?: string[] };
  } | undefined;
  // Appendix section 8: status, held_out, selection.selected and selection.n.
  if (
    !c.selection || c.selection.sha256 !== s.sha256 || sel?.status !== "ok" ||
    !same(sorted(sel.selection?.selected ?? []), sorted(s.selected)) ||
    !same(sorted(sel.held_out ?? []), sorted(s.held_out))
  ) {
    out.push(`selection ${s.path} does not match the pre-registration`);
  }
  // A committed "ok" selection has no shortfalls, so its requested n is the selected count.
  if (c.selection && sel?.selection?.n !== s.selected.length) {
    out.push(
      `selection.n ${sel?.selection?.n} differs from ${s.selected.length} selected tasks`,
    );
  }
  const sim = c.simulation?.json as {
    script_sha256?: string;
    args?: unknown;
    zero_solve?: unknown;
    decision?: { design?: unknown };
  } | undefined;
  if (
    !c.simulation || c.simulation.sha256 !== doc.power_simulation!.output.sha256
  ) out.push("simulation output does not match the pre-registration");
  else {
    if (
      sim?.script_sha256 !== doc.simulation.script_sha256 ||
      !same(sim?.args, doc.simulation.args)
    ) out.push("simulation was not run with the frozen script and arguments");
    if (!same(sim?.zero_solve, doc.zero_solve)) {
      out.push("simulation used another zero-solve rule than the frozen one");
    }
    // The waiver needs an externally approved design amendment, never one only written in the document.
    const waived = doc.amendments.some((a) => a.key === "design") &&
      authorized("design");
    if (!waived && !same(sim?.decision?.design, d)) {
      out.push("design differs from the simulation decision");
    }
  }
  return out;
}

async function readJsonAt(
  root: string,
  rel: string,
): Promise<{ sha256: string; json: unknown } | null> {
  const p = join(root, rel);
  try {
    return {
      sha256: await hashFile(root, p),
      json: JSON.parse(await Deno.readTextFile(p)),
    };
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}

/** The value of the single `key: value` line matching `re`; null when absent, repeated or malformed. */
function anchorLine(text: string, key: string, re: string): string | null {
  if ([...text.matchAll(new RegExp(`^${key}:`, "gm"))].length !== 1) {
    return null;
  }
  return new RegExp(`^${key}:[ \\t]*(${re})[ \\t\\r]*$`, "m").exec(text)?.[1] ??
    null;
}

/**
 * A valid approval line exists and none names the other stage: approvals are
 * stage-specific (appendix section 10 has no structured stage field).
 */
const hasApproval = (text: string, stage: "A" | "B") => {
  const lines = text.split(/\r?\n/).filter(isOwnerApproval);
  // "stage B" and the hyphenated "stage-B" name a stage alike.
  const other = new RegExp(
    `\\bstage[\\s-]+${stage === "A" ? "B" : "A"}\\b`,
    "i",
  );
  return lines.length > 0 && !lines.some((l) => other.test(l));
};

/** The anchor lines of a stage-A decision file; null when any is missing. */
export function parseStageADecision(
  text: string,
): { protocol_sha256: string; tag: string; tag_object: string } | null {
  const line = (k: string, re: string) => anchorLine(text, k, re);
  const protocol_sha256 = line("protocol_sha256", "[0-9a-f]{64}");
  // Presence and format only: appendix section 10 defines no comparison for file_sha256.
  const file_sha256 = line("file_sha256", "[0-9a-f]{64}");
  const tag = line("tag", "[A-Za-z0-9._/-]+");
  const tag_object = line("tag_object", "[0-9a-f]{40}");
  if (
    !protocol_sha256 || !file_sha256 || !tag || !tag_object ||
    !hasApproval(text, "A")
  ) return null;
  return { protocol_sha256, tag, tag_object };
}

/** The anchor lines of a stage-B decision file; null when any required one is missing. */
export function parseStageBDecision(
  text: string,
): {
  stage_b_sha256: string;
  tag: string;
  tag_object: string;
  amendments: string[];
} | null {
  const line = (k: string, re: string) => anchorLine(text, k, re);
  const stage_b_sha256 = line("stage_b_sha256", "[0-9a-f]{64}");
  const tag = line("tag", "[A-Za-z0-9._/-]+");
  const tag_object = line("tag_object", "[0-9a-f]{40}");
  if (!stage_b_sha256 || !tag || !tag_object || !hasApproval(text, "B")) {
    return null;
  }
  const amendments = [
    ...text.matchAll(
      /^amendment:[ \t]*(design|family|confirmatory)[ \t\r]*$/gm,
    ),
  ].map((m) => m[1]!);
  return { stage_b_sha256, tag, tag_object, amendments };
}

/** Variables that redirect git to another repository, object store or index. */
const GIT_REDIRECTS = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CEILING_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_GRAFT_FILE",
  "GIT_SHALLOW_FILE",
  "GIT_REPLACE_REF_BASE",
  "GIT_NAMESPACE",
]);

function isolatedGitEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(Deno.env.toObject())) {
    const u = k.toUpperCase();
    if (!GIT_REDIRECTS.has(u) && !u.startsWith("GIT_CONFIG_")) env[k] = v;
  }
  env["GIT_NO_REPLACE_OBJECTS"] = "1";
  env["GIT_CONFIG_NOSYSTEM"] = "1";
  // No user config (protocol allowances, promisor helpers) and no lazy fetch of missing objects.
  env["GIT_CONFIG_GLOBAL"] = Deno.build.os === "windows" ? "NUL" : "/dev/null";
  env["GIT_NO_LAZY_FETCH"] = "1";
  return env;
}

async function gitOut(
  repoRoot: string,
  args: string[],
): Promise<string | null> {
  const r = await new Deno.Command("git", {
    args,
    cwd: repoRoot,
    env: isolatedGitEnv(),
    clearEnv: true,
    stdout: "piped",
    stderr: "null",
  }).output();
  return r.success ? new TextDecoder().decode(r.stdout) : null;
}

/**
 * The tag object id when `refs/tags/<tag>` is an annotated tag whose message
 * holds `<key>: <expected>`; null when the tag is missing. A lightweight tag
 * or another annotation hash is refused (review finding 2).
 */
async function annotatedTagObject(
  repoRoot: string,
  tag: string,
  key: string,
  expected: string,
  decisionObject: string,
): Promise<string | null> {
  const ref = `refs/tags/${tag}`;
  const object = (await gitOut(repoRoot, ["rev-parse", "--verify", ref]))
    ?.trim() ?? null;
  // A missing or moved tag is reported as tag_moved; only the recorded object is vetted.
  if (object === null || object !== decisionObject) return object;
  // The resolved id, not the name, from here on: the ref cannot move between reads.
  if ((await gitOut(repoRoot, ["cat-file", "-t", object]))?.trim() !== "tag") {
    throw new ValidationError(
      `${ref} is not an annotated tag (a lightweight tag does not anchor the approval)`,
      [ref],
    );
  }
  const body = await gitOut(repoRoot, ["cat-file", "tag", object]) ?? "";
  const message = body.replaceAll("\r\n", "\n").split("\n\n").slice(1).join(
    "\n\n",
  );
  // Every line with the key counts, malformed ones included.
  const keyed = [...message.matchAll(new RegExp(`^${key}:`, "gm"))].length;
  if (keyed > 1) {
    throw new ValidationError(
      `${ref} annotation must hold exactly one ${key} line (found ${keyed})`,
      [ref],
    );
  }
  const found = [
    ...message.matchAll(
      new RegExp(`^${key}:[ \\t]*([0-9a-f]{64})[ \\t]*$`, "gm"),
    ),
  ].map((m) => m[1]!);
  if (found[0] !== expected) {
    throw new ValidationError(
      `${ref} annotation ${key} ${
        found[0]?.slice(0, 12) ?? "(missing)"
      } differs from the decision file (${expected.slice(0, 12)})`,
      [ref],
    );
  }
  return object;
}

/** Reads the approved stage A from the decision file and the tag, never from the working file. */
export async function loadStageAAnchor(
  repoRoot: string,
  harnessRoot: string,
  rel: string,
  decisionPath: string,
): Promise<{ anchor: StageAAnchor; decision_sha256: string }> {
  const text = await Deno.readTextFile(decisionPath);
  const d = parseStageADecision(text);
  if (!d || d.tag !== STAGE_A_TAG) {
    throw new ValidationError(
      `${decisionPath}: not a stage-A decision (protocol_sha256, tag ${STAGE_A_TAG}, tag_object, OWNER-APPROVED lines)`,
      [decisionPath],
    );
  }
  const object = await annotatedTagObject(
    repoRoot,
    STAGE_A_TAG,
    "protocol_sha256",
    d.protocol_sha256,
    d.tag_object,
  );
  const repoRel = relative(repoRoot, join(harnessRoot, rel)).replaceAll(
    "\\",
    "/",
  );
  const atTag = object === null ? null : await gitOut(repoRoot, [
    "show",
    `${object}^{commit}:${repoRel}`,
  ]);
  let tagSha: string | null = null;
  if (atTag !== null) {
    const r = PreregSchema.safeParse(parse(atTag));
    tagSha = r.success ? await protocolSha(r.data) : null;
  }
  return {
    anchor: {
      approved_protocol_sha256: d.protocol_sha256,
      tag_protocol_sha256: tagSha,
      tag_moved: object !== d.tag_object,
    },
    decision_sha256: await sha256Hex(new TextEncoder().encode(text)),
  };
}

/** Reads the approved stage-B bytes and amendment keys from the decision file and the tag. */
export async function loadStageBAnchor(
  repoRoot: string,
  harnessRoot: string,
  rel: string,
  decisionPath: string,
): Promise<{ anchor: StageBAnchor; decision_sha256: string }> {
  const text = await Deno.readTextFile(decisionPath);
  const d = parseStageBDecision(text);
  if (!d || d.tag !== STAGE_B_TAG) {
    throw new ValidationError(
      `${decisionPath}: not a stage-B decision (stage_b_sha256, tag ${STAGE_B_TAG}, tag_object, OWNER-APPROVED lines)`,
      [decisionPath],
    );
  }
  const object = await annotatedTagObject(
    repoRoot,
    STAGE_B_TAG,
    "stage_b_sha256",
    d.stage_b_sha256,
    d.tag_object,
  );
  const repoRel = relative(repoRoot, join(harnessRoot, rel)).replaceAll(
    "\\",
    "/",
  );
  const atTag = object === null ? null : await gitOut(repoRoot, [
    "show",
    `${object}^{commit}:${repoRel}`,
  ]);
  return {
    anchor: {
      approved_sha256: d.stage_b_sha256,
      file_sha256: await textSha(
        await Deno.readTextFile(join(harnessRoot, rel)),
      ),
      tag_file_sha256: atTag === null ? null : await textSha(atTag),
      tag_moved: object !== d.tag_object,
      approved_amendments: d.amendments,
    },
    decision_sha256: await sha256Hex(new TextEncoder().encode(text)),
  };
}

export async function verifyPrereg(
  repoRoot: string,
  harnessRoot: string,
  experiment: Experiment,
  experimentHash: string,
  taskIds: string[],
  decisionPath: string,
  stageBDecisionPath: string,
): Promise<
  {
    doc: Prereg;
    sha256: string;
    protocol_sha256: string;
    decision_sha256: string;
    stage_b_decision_sha256: string;
    problems: string[];
  }
> {
  const rel = experiment.preregistration!;
  const path = join(harnessRoot, rel);
  try {
    await Deno.stat(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      throw new ValidationError(`preregistration not found: ${rel}`, [rel]);
    }
    throw err;
  }
  const doc = await readYaml(path, PreregSchema);
  const { anchor, decision_sha256 } = await loadStageAAnchor(
    repoRoot,
    harnessRoot,
    rel,
    decisionPath,
  );
  const b = await loadStageBAnchor(
    repoRoot,
    harnessRoot,
    rel,
    stageBDecisionPath,
  );
  const problems = await preregProblems(doc, {
    experiment,
    experimentHash,
    taskIds,
    selection: doc.selection
      ? await readJsonAt(repoRoot, doc.selection.path)
      : null,
    simulation: doc.power_simulation
      ? await readJsonAt(repoRoot, doc.power_simulation.output.path)
      : null,
    anchor,
    stageB: b.anchor,
  });
  return {
    doc,
    sha256: await hashFile(harnessRoot, path),
    protocol_sha256: await protocolSha(doc),
    decision_sha256,
    stage_b_decision_sha256: b.decision_sha256,
    problems,
  };
}
