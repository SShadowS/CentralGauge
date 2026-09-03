/**
 * Pure per-attempt capture helpers for the ingest envelope (taxonomy v2).
 *
 * Derives run-time signals from an {@link ExecutionAttempt} that the
 * existing `BenchResultItem` mapping does not carry: how the attempt
 * terminated, a stable per-test-case identifier vector, and content digests
 * for the prompt/candidate. No I/O beyond hashing.
 * @module src/ingest/capture
 */
import type { ExecutionAttempt } from "../tasks/interfaces.ts";
import { sha256Hex } from "../../site/src/lib/shared/taxonomy-schema.ts";
import { BCCH_PINNED_VERSION } from "../container/bcch-config.ts";
import { inspectContainer } from "../container/docker-inspect.ts";
import { harnessFingerprint } from "../utils/harness-fingerprint.ts";
import { RETRY_PATH_VERSION } from "../llm/prompt-building.ts";
import { PROMPT_POLICY_VERSION } from "./catalog/task-set-hash.ts";

/**
 * How a single attempt terminated, in precedence order:
 * an infra-exhausted attempt is reported as such regardless of what the LLM
 * response looks like; otherwise an unrecovered refusal wins over the raw
 * `finishReason`; otherwise `finishReason` decides.
 *
 * `"cancelled"` is reserved: no producer exists yet. Cancellation today
 * surfaces only as pool rejections before an `ExecutionAttempt` is
 * constructed, so nothing can classify an attempt as cancelled. The value is
 * kept in the union for the spec's vocabulary and Plan B's schema.
 */
export type TerminationKind =
  | "response"
  | "provider_error"
  | "cap_reached"
  | "refusal"
  | "infra_exhausted"
  | "cancelled";

export function terminationKind(a: ExecutionAttempt): TerminationKind {
  if (a.infraRetryExhaustionReason) return "infra_exhausted";
  const r = a.llmResponse;
  if (r.refusal && !r.refusal.recovered) return "refusal";
  switch (r.finishReason) {
    case "length":
      return "cap_reached";
    case "error":
      return "provider_error";
    case "content_filter":
      return "refusal";
    default:
      return "response";
  }
}

/**
 * Stable per-test-case id vector for one attempt's test results, in oracle
 * order. Each id is the first 16 hex chars of sha256(`${taskId}\n${name}`) -
 * stable across runs of the same task/test-name pair, distinct across tasks.
 */
export async function testVector(
  a: ExecutionAttempt,
  taskId: string,
): Promise<{ id: string; name: string; passed: boolean }[]> {
  const out: { id: string; name: string; passed: boolean }[] = [];
  for (const t of a.testResult?.results ?? []) {
    out.push({
      id: (await sha256Hex(`${taskId}\n${t.name}`)).slice(0, 16),
      name: t.name,
      passed: t.passed,
    });
  }
  return out;
}

export async function optionalSha(
  text: string | undefined,
): Promise<string | undefined> {
  return text === undefined ? undefined : await sha256Hex(text);
}

export { sha256Hex };

/**
 * Run-level (not per-attempt) capture: the environment a bench run executed
 * against, and a redacted snapshot of the LLM invocation config. Both are
 * pure/best-effort — a failure to read any one fact never aborts a run.
 */
export interface EnvironmentManifest {
  bc_artifact: string | null;
  container_image_digest: string | null;
  bcch_version: string;
  test_runner: "soap" | "legacy";
  host_os: string;
  centralgauge_sha: string | null;
  dirty_tree: boolean;
  harness_fingerprint: string;
  retry_path_version: string;
  prompt_policy_version: string;
  prompt_template_digest: string;
  culture: string | null;
}

async function gitFacts(
  cwd: string,
): Promise<{ sha: string | null; dirty: boolean }> {
  try {
    const shaOut = await new Deno.Command("git", {
      args: ["rev-parse", "HEAD"],
      cwd,
      stdout: "piped",
      stderr: "null",
    }).output();
    const statusOut = await new Deno.Command("git", {
      args: ["status", "--porcelain"],
      cwd,
      stdout: "piped",
      stderr: "null",
    }).output();
    const sha = new TextDecoder().decode(shaOut.stdout).trim();
    const st = new TextDecoder().decode(statusOut.stdout);
    return { sha: sha || null, dirty: st.trim().length > 0 };
  } catch {
    return { sha: null, dirty: false };
  }
}

/**
 * SHA-256 over every known prompt-template's normalized content, in a fixed
 * order. A missing template (e.g. not every deployment carries every
 * template file) hashes as a literal `<missing>` marker rather than being
 * skipped, so the digest still changes if a template later appears.
 */
export async function promptTemplateDigest(cwd: string): Promise<string> {
  const names = [
    "code-gen.md",
    "diagnose.md",
    "diagnose-objects.md",
    "diagnose-contract.md",
    "bugfix.md",
  ];
  let all = "";
  for (const n of names) {
    try {
      const text = await Deno.readTextFile(`${cwd}/templates/${n}`);
      all += `${n}\n${text.replace(/\r\n/g, "\n")}\n`;
    } catch {
      all += `${n}\n<missing>\n`;
    }
  }
  return sha256Hex(all);
}

/**
 * Build the run-level environment manifest for one bench run: BC artifact +
 * container image, the pinned bccontainerhelper version, which test runner
 * is active, host OS, repo identity, and the harness/retry-path/prompt
 * digests that decide whether a replay is comparable to the original run.
 *
 * Container facts (`bc_artifact`, `container_image_digest`) are best-effort —
 * an inspect failure (container stopped, docker unavailable) yields `null`
 * for both rather than throwing, since the manifest itself must never block
 * ingest.
 */
export async function buildEnvironmentManifest(opts: {
  containerName: string;
  cwd: string;
  inspect?: typeof inspectContainer;
}): Promise<EnvironmentManifest> {
  const inspect = opts.inspect ?? inspectContainer;
  let artifact: string | null = null;
  let image: string | null = null;
  try {
    const i = await inspect(opts.containerName);
    image = i?.imageDigest ?? null;
    // Strip a SAS/query string so the fact doesn't churn on every artifact
    // fetch (same reasoning as the compiler-cache key: CLAUDE.md's
    // "bccontainerhelper config quirks").
    artifact = i?.artifactUrl ? i.artifactUrl.replace(/\?.*$/, "") : null;
  } catch {
    // container facts are best-effort; the manifest is still worth building.
  }
  const git = await gitFacts(opts.cwd);
  return {
    bc_artifact: artifact,
    container_image_digest: image,
    bcch_version: BCCH_PINNED_VERSION,
    test_runner: Deno.env.get("CENTRALGAUGE_SOAP_TEST_RUNNER") === "0"
      ? "legacy"
      : "soap",
    host_os: `${Deno.build.os}-${Deno.build.arch}`,
    centralgauge_sha: git.sha,
    dirty_tree: git.dirty,
    harness_fingerprint: await harnessFingerprint(opts.cwd),
    retry_path_version: RETRY_PATH_VERSION,
    prompt_policy_version: PROMPT_POLICY_VERSION,
    prompt_template_digest: await promptTemplateDigest(opts.cwd),
    culture: Deno.env.get("CENTRALGAUGE_BC_CULTURE") ?? null,
  };
}

/**
 * Redacted snapshot of the LLM invocation config for one variant. Never
 * carries a full `baseUrl` (which may embed an API key or SAS token as a
 * query string) — only the endpoint host survives.
 */
export function invocationSnapshot(cfg: {
  provider: string;
  model: string;
  apiModelId: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  reasoning?: unknown;
}): Record<string, unknown> {
  let host: string | null = null;
  try {
    host = cfg.baseUrl ? new URL(cfg.baseUrl).host : null;
  } catch {
    host = null;
  }
  return {
    provider: cfg.provider,
    requested_model: cfg.model,
    api_model_id: cfg.apiModelId,
    endpoint_host: host,
    max_tokens: cfg.maxTokens ?? null,
    temperature: cfg.temperature ?? null,
    reasoning: cfg.reasoning === undefined
      ? null
      : JSON.parse(JSON.stringify(cfg.reasoning)),
  };
}
