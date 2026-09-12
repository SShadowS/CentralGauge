/**
 * Resolves configured OpenRouter upstream pins for a bench's variants
 * (spec 2026-09-11 D2), shared by the sync bench and `bench batch submit`.
 *
 * Both prechecks run this BEFORE any LLM call, so an unknown tag, an
 * endpoint too small for the run, or an unavailable upstream aborts the run
 * while it has cost nothing. The resolved map travels to the orchestrator
 * (which puts `provider.order` on every request) and to the ingest capture
 * (which records what the pin resolved to), so one resolution decides both
 * where the requests go and what the run reports.
 *
 * @module cli/commands/bench/upstream-precheck
 */
import * as colors from "@std/fmt/colors";
import type { CentralGaugeConfig } from "../../../src/config/config.ts";
import type { ModelVariant } from "../../../src/llm/variant-types.ts";
import { upstreamPinFor } from "../../../src/config/config.ts";
import {
  type ResolvedUpstreamPin,
  resolveUpstreamPin,
  type UpstreamPinDeps,
} from "../../../src/llm/upstream-pin.ts";

/**
 * Conservative bound on the longest rendered prompt in the suite, used for
 * the context-length capability check before any prompt is rendered. Raise
 * it if a template grows past it; the check is `context >= bound + maxTokens`.
 */
export const PROMPT_TOKENS_BOUND = 16_000;

/**
 * What one variant's pin resolved to, keyed by `ModelVariant.variantId`.
 *
 * Carries the whole resolution, not just the slug: `quantization` and
 * `preflight` are what the ingest capture records as `upstream_resolved`
 * and what the scores file's `# Upstream` block prints. Populating only the
 * slug here would force those two surfaces to invent or omit the rest.
 */
export type UpstreamPinMap = Map<string, {
  upstreamPin: string;
  providerName: string;
  quantization?: string | null;
  preflight?: "passed" | "skipped";
}>;

/**
 * Resolve every configured pin among `variants`. Non-OpenRouter variants and
 * OpenRouter variants with no configured pin are skipped, so an unpinned run
 * gets an empty map and makes no network call at all.
 *
 * Throws `UpstreamPinError` on the first variant that cannot be resolved;
 * callers print it and abort rather than benching against an unknown route.
 */
export async function resolveUpstreamPins(input: {
  variants: ModelVariant[];
  config: Pick<CentralGaugeConfig, "openrouter">;
  maxTokens: number;
  skipPreflight: boolean;
  apiKey: string;
  log: (line: string) => void;
  deps?: Partial<UpstreamPinDeps>;
}): Promise<UpstreamPinMap> {
  const out: UpstreamPinMap = new Map();
  for (const v of input.variants) {
    if (v.provider !== "openrouter") continue;
    const pin = upstreamPinFor(input.config, v.provider, v.model);
    if (pin === undefined) continue;
    const resolved = await resolveUpstreamPin(
      {
        apiModelId: v.model,
        pin,
        maxTokens: input.maxTokens,
        longestPromptTokens: PROMPT_TOKENS_BOUND,
        skipPreflight: input.skipPreflight,
      },
      { apiKey: input.apiKey, ...input.deps },
    );
    out.set(v.variantId, {
      upstreamPin: resolved.upstreamPin,
      providerName: resolved.providerName,
      quantization: resolved.quantization,
      preflight: resolved.preflight,
    });
    input.log(
      `${
        colors.cyan("[upstream]")
      } ${v.variantId} pinned to ${resolved.upstreamPin} (${resolved.providerName}` +
        `${
          resolved.quantization ? `, ${resolved.quantization}` : ""
        }), preflight ${resolved.preflight}`,
    );
  }
  return out;
}

/**
 * The `SubmitDeps.resolveUpstream` shape, bound to the same prompt bound and
 * skip flag the sync path uses. `submitRuns` decides WHICH pin to resolve
 * (it reads config itself); this only carries the how.
 */
export function submitResolver(
  input: {
    skipPreflight: boolean;
    apiKey: string;
    deps?: Partial<UpstreamPinDeps>;
  },
): (
  apiModelId: string,
  pin: string,
  maxTokens: number,
) => Promise<ResolvedUpstreamPin> {
  return (apiModelId: string, pin: string, maxTokens: number) =>
    resolveUpstreamPin(
      {
        apiModelId,
        pin,
        maxTokens,
        longestPromptTokens: PROMPT_TOKENS_BOUND,
        skipPreflight: input.skipPreflight,
      },
      { apiKey: input.apiKey, ...input.deps },
    );
}
