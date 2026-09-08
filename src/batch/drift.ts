/**
 * D13 suspended-run integrity (spec sections 4.2, 4.6): recompute every
 * frozen input `advance` relies on and compare it against `state.json`'s
 * `frozen` block, refusing (never mutating) on any mismatch.
 *
 * `freezeInputs` is the write side of the same digests: `submit` (Task 11)
 * calls it once, after writing `prompt-inputs.json`, to build the `frozen`
 * block `checkDrift` later checks against. The two functions therefore MUST
 * agree on exactly how each digest is computed: a template digest, in
 * particular, hashes ONE file's CRLF-normalized content (unlike
 * `promptTemplateDigest` in `src/ingest/capture.ts`, which concatenates a
 * fixed five), because `checkDrift` needs to name which SPECIFIC template
 * moved, not just that "a" template did.
 *
 * @module src/batch/drift
 */
import { join } from "@std/path";
import { canonicalJSON } from "../../shared/canonical.ts";
import { settingsHashOf, sha256Hex } from "../../shared/settings-hash.ts";
import { computeTaskSetHash } from "../ingest/catalog/task-set-hash.ts";
import { gitFacts } from "../ingest/capture.ts";
import { harnessFingerprint } from "../utils/harness-fingerprint.ts";
import type { FrozenPromptInputs } from "../parallel/shared/prompt-inputs.ts";
import type { TaskManifest } from "../tasks/interfaces.ts";
import type { BatchRunState, ContainerEnvironmentSet } from "./state.ts";
import { RUN_FILES } from "./paths.ts";

export interface DriftReport {
  ok: boolean;
  changed: Array<{ input: string; frozen: string; current: string }>;
}

/** sha256 over the raw bytes of the file at `path` (not its decoded text). */
async function sha256OfFile(path: string): Promise<string> {
  const bytes = await Deno.readFile(path);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest).map((b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * sha256 of ONE template's CRLF-normalized content, or a literal
 * `<missing>` marker when the file does not exist, the same
 * missing-file policy as `promptTemplateDigest`, applied per file instead
 * of to a fixed concatenation, so a template that legitimately doesn't
 * exist on this deployment digests stably instead of throwing.
 */
async function templateDigestFor(
  cwd: string,
  templateDir: string,
  name: string,
): Promise<string> {
  let text: string;
  try {
    text = await Deno.readTextFile(join(cwd, templateDir, name));
  } catch {
    text = "<missing>";
  }
  return await sha256Hex(text.replace(/\r\n/g, "\n"));
}

/**
 * Recomputes every D13 frozen input and compares it against
 * `state.frozen`. `opts.environment`, when given, is compared too (spec
 * 4.6: only enforced "before any compile wave"; the `evaluate` step
 * passes the containers about to run against, and every other call omits it).
 * Never mutates `state`; the caller decides what to do with a non-`ok`
 * report (refuse, exit 4, per spec 4.5's "any phase, D13 drift").
 */
export async function checkDrift(
  dir: string,
  state: BatchRunState,
  opts: {
    cwd: string;
    /**
     * Where the run's prompt templates live, relative to `cwd`
     * (`benchmark.templateDir`, default `templates`). It must be the SAME
     * directory `renderLLMRequest` renders from, or a wave-2 render reads
     * a template this check never looked at.
     */
    templateDir: string;
    environment?: ContainerEnvironmentSet;
  },
): Promise<DriftReport> {
  const changed: DriftReport["changed"] = [];

  const taskSetHash = await computeTaskSetHash(opts.cwd);
  if (taskSetHash !== state.frozen.taskSetHash) {
    changed.push({
      input: "taskSetHash",
      frozen: state.frozen.taskSetHash,
      current: taskSetHash,
    });
  }

  for (
    const [name, frozenDigest] of Object.entries(state.frozen.templateDigests)
  ) {
    const current = await templateDigestFor(opts.cwd, opts.templateDir, name);
    if (current !== frozenDigest) {
      changed.push({
        input: `templateDigests.${name}`,
        frozen: frozenDigest,
        current,
      });
    }
  }

  const fingerprint = await harnessFingerprint(opts.cwd);
  if (fingerprint !== state.frozen.harnessFingerprint) {
    changed.push({
      input: "harnessFingerprint",
      frozen: state.frozen.harnessFingerprint,
      current: fingerprint,
    });
  }

  const promptInputsDigest = await sha256OfFile(
    join(dir, RUN_FILES.promptInputs),
  );
  if (promptInputsDigest !== state.frozen.promptInputsDigest) {
    changed.push({
      input: "promptInputsDigest",
      frozen: state.frozen.promptInputsDigest,
      current: promptInputsDigest,
    });
  }

  const git = await gitFacts(opts.cwd);
  const currentSha = git.sha ?? "";
  if (currentSha !== state.frozen.gitSha) {
    changed.push({
      input: "gitSha",
      frozen: state.frozen.gitSha,
      current: currentSha,
    });
  }
  const currentClean = !git.dirty;
  if (currentClean !== state.frozen.gitClean) {
    changed.push({
      input: "gitClean",
      frozen: String(state.frozen.gitClean),
      current: String(currentClean),
    });
  }

  if (opts.environment !== undefined) {
    const frozenJson = canonicalJSON(state.frozen.environment);
    const currentJson = canonicalJSON(opts.environment);
    if (frozenJson !== currentJson) {
      changed.push({
        input: "environment",
        frozen: frozenJson,
        current: currentJson,
      });
    }
  }

  return { ok: changed.length === 0, changed };
}

/**
 * Builds the `frozen` digests block `submit` (Task 11) persists into
 * `state.json` at submission time, over the SAME template set `checkDrift`
 * later re-checks: every distinct `manifest.prompt_template` among
 * `taskIds` (wave 2's fix prompt is built in code, not from a template
 * file, `buildFixPrompt` in `src/llm/prompt-building.ts`, so only wave 1
 * templates are ever "referenced").
 *
 * `promptInputsPath` must already exist (the caller writes
 * `prompt-inputs.json` before calling this): both `promptInputsDigest`
 * (its raw bytes) and `settingsHash` (over the file's own `settings`
 * field, via `settingsHashOf`) are read from it rather than recomputed
 * independently, so the two can never silently disagree with what was
 * actually frozen to disk.
 *
 * `tasksGlob` is left as an empty placeholder: nothing passed to this
 * function carries the operator's original `--tasks` glob, and `checkDrift`
 * never compares it (only `taskIds`, `templateDigests` and the other
 * recomputable digests are drift-checked). `submit` overwrites it with the
 * real value it already has in hand before persisting `state.json`.
 */
export async function freezeInputs(
  cwd: string,
  templateDir: string,
  taskIds: string[],
  manifests: Map<string, TaskManifest>,
  promptInputsPath: string,
  environment: ContainerEnvironmentSet,
): Promise<BatchRunState["frozen"]> {
  const taskSetHash = await computeTaskSetHash(cwd);
  const harnessFp = await harnessFingerprint(cwd);

  const templateNames = new Set<string>();
  for (const taskId of taskIds) {
    const manifest = manifests.get(taskId);
    if (manifest) templateNames.add(manifest.prompt_template);
  }
  const templateDigests: Record<string, string> = {};
  for (const name of [...templateNames].sort()) {
    templateDigests[name] = await templateDigestFor(cwd, templateDir, name);
  }

  const promptInputsDigest = await sha256OfFile(promptInputsPath);
  const promptInputsRaw = JSON.parse(
    await Deno.readTextFile(promptInputsPath),
  ) as FrozenPromptInputs;
  const settingsHash = await settingsHashOf(promptInputsRaw.settings);

  const git = await gitFacts(cwd);

  return {
    settingsHash,
    taskSetHash,
    harnessFingerprint: harnessFp,
    templateDigests,
    promptInputsDigest,
    gitSha: git.sha ?? "",
    gitClean: !git.dirty,
    environment,
    tasksGlob: "",
    taskIds: [...taskIds],
  };
}
