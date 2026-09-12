// Resolve and preflight an OpenRouter upstream pin (spec 2026-09-11 upstream
// lock, D2). The pin is the `tag` from the endpoints listing; OpenRouter's
// `provider.order` accepts exactly that string and, with fallbacks off,
// confines routing to it. Responses echo the upstream's display name, not
// the tag, so the resolved `providerName` is what verification compares.
import { CentralGaugeError } from "../errors.ts";
import { extractUpstreamIdentity } from "./mappers/openrouter.ts";

export interface UpstreamEndpoint {
  slug: string;
  providerName: string;
  quantization: string | null;
  contextLength: number | null;
  maxCompletionTokens: number | null;
  outputPerMtoken: number | null;
  status: number | null;
}

export interface ResolvedUpstreamPin {
  upstreamPin: string;
  providerName: string;
  quantization: string | null;
  preflight: "passed" | "skipped";
}

export interface UpstreamPinDeps {
  fetchFn?: typeof fetch;
  apiKey: string;
  sleep?: (ms: number) => Promise<void>;
}

export type UpstreamPinErrorCode =
  | "UPSTREAM_PIN_UNKNOWN"
  | "UPSTREAM_PIN_CAPABILITY"
  | "UPSTREAM_PIN_UNAVAILABLE"
  | "UPSTREAM_PIN_MISMATCH";

/**
 * Raised when a configured OpenRouter upstream pin cannot be resolved or
 * verified: an unknown slug (also covers a 404 from the endpoints listing
 * or the preflight call itself), an endpoint too small for the run's output
 * cap or prompt, a preflight that never got a successful response after
 * retries, or a preflight served by a different upstream than the one
 * pinned.
 */
export class UpstreamPinError extends CentralGaugeError {
  constructor(
    message: string,
    public override readonly code: UpstreamPinErrorCode,
    context?: Record<string, unknown>,
  ) {
    super(message, code, context);
    this.name = "UpstreamPinError";
  }
}

const BASE = "https://openrouter.ai/api/v1";
/** Above OpenRouter's documented 16-token minimum on some upstreams. */
const PREFLIGHT_MAX_TOKENS = 32;
const PREFLIGHT_RETRIES = 3;
const PREFLIGHT_BACKOFF_MS = [5_000, 15_000, 40_000];

/** Raw shape of one entry in OpenRouter's `GET /models/{id}/endpoints` listing. */
interface RawEndpoint {
  tag?: unknown;
  provider_name?: unknown;
  quantization?: unknown;
  context_length?: unknown;
  max_completion_tokens?: unknown;
  pricing?: { completion?: unknown };
  status?: unknown;
}

export async function fetchUpstreams(
  apiModelId: string,
  deps: UpstreamPinDeps,
): Promise<UpstreamEndpoint[]> {
  const fetchFn = deps.fetchFn ?? fetch;
  const r = await fetchFn(`${BASE}/models/${apiModelId}/endpoints`, {
    headers: { Authorization: `Bearer ${deps.apiKey}` },
  });
  if (!r.ok) {
    throw new UpstreamPinError(
      `endpoints listing for ${apiModelId} failed: HTTP ${r.status}`,
      "UPSTREAM_PIN_UNKNOWN",
      { apiModelId, status: r.status },
    );
  }
  const j = await r.json() as { data?: { endpoints?: RawEndpoint[] } };
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return (j.data?.endpoints ?? [])
    .filter((e) =>
      typeof e.tag === "string" && typeof e.provider_name === "string"
    )
    .map((e) => ({
      slug: e.tag as string,
      providerName: e.provider_name as string,
      quantization:
        typeof e.quantization === "string" && e.quantization !== "unknown"
          ? e.quantization
          : null,
      contextLength: num(e.context_length),
      maxCompletionTokens: num(e.max_completion_tokens),
      outputPerMtoken: typeof e.pricing?.completion === "string"
        ? Math.round(Number(e.pricing.completion) * 1e6 * 1e6) / 1e6
        : null,
      status: num(e.status),
    }));
}

export async function resolveUpstreamPin(
  input: {
    apiModelId: string;
    pin: string;
    maxTokens: number;
    longestPromptTokens: number;
    skipPreflight: boolean;
  },
  deps: UpstreamPinDeps,
): Promise<ResolvedUpstreamPin> {
  const endpoints = await fetchUpstreams(input.apiModelId, deps);
  const ep = endpoints.find((e) => e.slug === input.pin);
  if (!ep) {
    const listing = endpoints
      .map((e) => `${e.slug} (${e.providerName}, ${e.quantization ?? "?"})`)
      .join(", ");
    throw new UpstreamPinError(
      `upstream pin "${input.pin}" is not an endpoint of ${input.apiModelId}. Available: ${listing}`,
      "UPSTREAM_PIN_UNKNOWN",
      {
        apiModelId: input.apiModelId,
        pin: input.pin,
        available: endpoints.map((e) => e.slug),
      },
    );
  }
  if (
    ep.maxCompletionTokens !== null && ep.maxCompletionTokens < input.maxTokens
  ) {
    throw new UpstreamPinError(
      `upstream ${ep.slug} allows max_completion_tokens ${ep.maxCompletionTokens}, below the run's cap of ${input.maxTokens}`,
      "UPSTREAM_PIN_CAPABILITY",
      {
        pin: ep.slug,
        maxCompletionTokens: ep.maxCompletionTokens,
        maxTokens: input.maxTokens,
      },
    );
  }
  const need = input.longestPromptTokens + input.maxTokens;
  if (ep.contextLength !== null && ep.contextLength < need) {
    throw new UpstreamPinError(
      `upstream ${ep.slug} context_length ${ep.contextLength} is below prompt plus cap (${need})`,
      "UPSTREAM_PIN_CAPABILITY",
      { pin: ep.slug, contextLength: ep.contextLength, need },
    );
  }

  const base = {
    upstreamPin: ep.slug,
    providerName: ep.providerName,
    quantization: ep.quantization,
  };
  if (input.skipPreflight) return { ...base, preflight: "skipped" };

  const fetchFn = deps.fetchFn ?? fetch;
  const sleep = deps.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastMessage = "";
  for (let attempt = 0; attempt <= PREFLIGHT_RETRIES; attempt++) {
    const r = await fetchFn(`${BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${deps.apiKey}`,
        "Content-Type": "application/json",
        "X-OpenRouter-Metadata": "enabled",
      },
      body: JSON.stringify({
        model: input.apiModelId,
        messages: [{ role: "user", content: "Reply with the single word: ok" }],
        max_tokens: PREFLIGHT_MAX_TOKENS,
        provider: { order: [ep.slug], allow_fallbacks: false },
      }),
    });
    const body = await r.json().catch(() => ({})) as {
      error?: { message?: string };
    };
    if (r.status === 200) {
      const id = extractUpstreamIdentity(body);
      const served = id === undefined
        ? undefined
        : "conflict" in id
        ? id.providerField
        : id.servedUpstream;
      if (served !== ep.providerName) {
        throw new UpstreamPinError(
          `preflight for ${ep.slug} was served by ${
            served ?? "an unidentified upstream"
          }, expected ${ep.providerName}`,
          "UPSTREAM_PIN_MISMATCH",
          { pin: ep.slug, expected: ep.providerName, served: served ?? null },
        );
      }
      return { ...base, preflight: "passed" };
    }
    if (r.status === 404) {
      throw new UpstreamPinError(
        `preflight for ${ep.slug}: OpenRouter found no endpoint (${
          body.error?.message ?? "404"
        })`,
        "UPSTREAM_PIN_UNKNOWN",
        { pin: ep.slug, status: 404 },
      );
    }
    lastMessage = body.error?.message ?? `HTTP ${r.status}`;
    if (r.status === 429 || r.status >= 500) {
      if (attempt < PREFLIGHT_RETRIES) {
        await sleep(PREFLIGHT_BACKOFF_MS[attempt]!);
      }
      continue;
    }
    break;
  }
  throw new UpstreamPinError(
    `preflight for ${ep.slug} did not succeed: ${lastMessage}. The pinned upstream is unavailable right now; retry later or pass --skip-upstream-preflight for a known transient outage.`,
    "UPSTREAM_PIN_UNAVAILABLE",
    { pin: ep.slug, lastMessage },
  );
}
