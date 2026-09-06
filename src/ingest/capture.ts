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
import {
  BCCH_PINNED_VERSION,
  bcchUsePsSessionForBc28,
  bcchUsePwshForBc24,
} from "../container/bcch-config.ts";
import { inspectContainer } from "../container/docker-inspect.ts";
import { harnessFingerprint } from "../utils/harness-fingerprint.ts";
import { RETRY_PATH_VERSION } from "../llm/prompt-building.ts";
import { PROMPT_POLICY_VERSION } from "./catalog/task-set-hash.ts";
import { endpointFor, providerRouteFor } from "../llm/endpoint.ts";
import type { ContinuationConfig, EmptyRetryConfig } from "../llm/types.ts";
import type {
  FallbackPolicy,
  InvocationMode,
} from "../../shared/settings-hash.ts";

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
  /** `CENTRALGAUGE_BC_TENANT`, default `"default"`. Same read as `bc-container-provider.ts`. */
  tenant: string;
  /** `CENTRALGAUGE_BC_COMPANY`, default `"My Company"`. Same read as `bc-container-provider.ts`. */
  company: string;
  /** Resolved `usePsSessionForBc28` knob (`bcchUsePsSessionForBc28()`), not the raw env var. */
  bcch_use_pssession_bc28: boolean;
  /** Resolved `usePwshForBc24` knob (`bcchUsePwshForBc24()`), not the raw env var. */
  bcch_use_pwsh_bc24: boolean;
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
    // Reserved, like TerminationKind's "cancelled": no caller sets
    // CENTRALGAUGE_BC_CULTURE today, so this is always null in practice.
    // Kept for the spec's vocabulary and for whenever a culture override
    // gets wired through the container/task pipeline.
    culture: Deno.env.get("CENTRALGAUGE_BC_CULTURE") ?? null,
    // Same env reads + defaults as `bc-container-provider.ts`'s test-script
    // builder (CLAUDE.md's "SOAP Test Harness" env knobs) — kept in sync by
    // reading the literal defaults documented there rather than importing
    // that module, which pulls in container-process machinery this pure
    // capture module must not depend on.
    tenant: Deno.env.get("CENTRALGAUGE_BC_TENANT") ?? "default",
    company: Deno.env.get("CENTRALGAUGE_BC_COMPANY") ?? "My Company",
    // Resolved via the single source of truth in `bcch-config.ts` (GH #12) —
    // never re-parse the raw env vars here.
    bcch_use_pssession_bc28: bcchUsePsSessionForBc28(),
    bcch_use_pwsh_bc24: bcchUsePwshForBc24(),
  };
}

/**
 * Executor-resolved invocation record (D4, Task 11). Carries the seven
 * legacy redacted-snapshot fields plus the resolved invocation profile: the
 * transport (`endpoint`/`provider_route`), the retry policies actually in
 * effect for this run, and the prompt-profile digest that feeds
 * `buildCanonicalSettings`'s `extra_json` (see `shared/settings-hash.ts`).
 */
export interface InvocationRecord {
  provider: string;
  requested_model: string;
  api_model_id: string;
  endpoint_host: string | null;
  max_tokens: number | null;
  temperature: number | null;
  reasoning: unknown;
  mode: InvocationMode;
  endpoint: string;
  provider_route: string;
  fallback_policy: FallbackPolicy;
  continuation: { enabled: boolean; max: number };
  empty_retry: { enabled: boolean; max: number };
  infra_retries_per_attempt: number;
  max_attempts: number;
  prompt_profile_digest: string;
}

/**
 * Redacted snapshot of the LLM invocation config for one variant, PLUS the
 * executor-resolved invocation profile (mode, transport, retry policies).
 * Never carries a full `baseUrl` (which may embed an API key or SAS token as
 * a query string) — only the endpoint host survives.
 *
 * `baseUrl` is accepted for completeness but neither current caller can
 * supply it: it lives on the adapter-level `LLMConfig`, not on `ModelVariant`
 * (see `src/llm/types.ts`), so `endpoint_host` is `null` on every real
 * invocation snapshot today until that value gets threaded through.
 */
export function invocationSnapshot(cfg: {
  provider: string;
  model: string;
  apiModelId: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  reasoning?: unknown;
  mode: InvocationMode;
  fallbackPolicy: FallbackPolicy;
  continuation: ContinuationConfig;
  emptyRetry: EmptyRetryConfig;
  infraRetriesPerAttempt: number;
  maxAttempts: number;
  promptProfileDigest: string;
}): InvocationRecord {
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
    mode: cfg.mode,
    endpoint: endpointFor(cfg.provider, cfg.apiModelId),
    provider_route: providerRouteFor(cfg.provider, cfg.apiModelId),
    fallback_policy: cfg.fallbackPolicy,
    continuation: {
      enabled: cfg.continuation.enabled,
      max: cfg.continuation.maxContinuations,
    },
    empty_retry: {
      enabled: cfg.emptyRetry.enabled,
      max: cfg.emptyRetry.maxRetries,
    },
    infra_retries_per_attempt: cfg.infraRetriesPerAttempt,
    max_attempts: cfg.maxAttempts,
    prompt_profile_digest: cfg.promptProfileDigest,
  };
}

/**
 * Structural check for a schema-4 (typed) invocation record, as opposed to
 * a legacy `Record<string, unknown>` snapshot (schema <=3, or hand-built by
 * a caller like `centralgauge ingest`'s pre-assembled BenchResults path).
 * Used by `ingest-assembly.ts` to decide whether to build canonical
 * settings via `buildCanonicalSettings` or fall back to the legacy
 * three-key settings object, and by Plan B for the same distinction.
 */
export function isInvocationRecord(v: unknown): v is InvocationRecord {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (r["mode"] === "sync" || r["mode"] === "batch") &&
    typeof r["endpoint"] === "string" &&
    typeof r["provider_route"] === "string" &&
    (r["fallback_policy"] === "requested" ||
      r["fallback_policy"] === "unavailable") &&
    typeof r["infra_retries_per_attempt"] === "number" &&
    typeof r["max_attempts"] === "number" &&
    typeof r["prompt_profile_digest"] === "string" &&
    typeof (r["continuation"] as Record<string, unknown> | undefined)?.[
        "max"
      ] === "number" &&
    typeof (r["empty_retry"] as Record<string, unknown> | undefined)?.[
        "max"
      ] === "number";
}
