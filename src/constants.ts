/**
 * Shared Constants
 *
 * Centralized constants to eliminate magic numbers across the codebase.
 * Import specific constants as needed rather than importing the entire module.
 */

// =============================================================================
// LLM Configuration Defaults
// =============================================================================

/**
 * Default temperature for LLM requests.
 * Low value (0.1) favors deterministic, focused outputs for code generation.
 */
export const DEFAULT_TEMPERATURE = 0.1;

/**
 * Default maximum output tokens for LLM responses.
 * 64000 tokens accommodates large thinking/reasoning budgets (Anthropic requires
 * max_tokens > thinkingBudget since thinking tokens count against the limit).
 */
export const DEFAULT_MAX_TOKENS = 64000;

/**
 * Largest `max_tokens` that may safely be sent on a NON-streaming request.
 *
 * The Anthropic SDK refuses a non-streaming request whose budget could exceed
 * a 10-minute run ("Streaming is required for operations that may take longer
 * than 10 minutes"), which in practice trips above ~21,333 tokens. The bench
 * is unaffected because it always streams (`LLMWorkPool` routes on
 * `isStreamingAdapter`), but the small-budget utility callers that still use
 * `generateCode` directly — `src/verify/analyzer.ts`, `src/rules/generator.ts`
 * — sit under this ceiling and must stay there.
 *
 * If you raise a budget at one of those sites past this value, switch that
 * site to the streaming API instead. Raising it silently reintroduces a bug
 * that took a live API call to find, in a corner nobody benchmarks.
 */
export const NONSTREAMING_SAFE_MAX_TOKENS = 21333;

/**
 * Default max tokens for Gemini models, consistent with the global default.
 */
export const GEMINI_DEFAULT_MAX_TOKENS = 64000;

/**
 * Default timeout for LLM API requests in milliseconds.
 * 30 seconds is sufficient for most requests while avoiding indefinite hangs.
 */
export const DEFAULT_API_TIMEOUT_MS = 30000;

/**
 * Empty-response retry defaults.
 *
 * Some providers (notably reasoning models like DeepSeek v4 pro, Gemini 3 Pro
 * thinking, GPT-5.x with high reasoning effort) intermittently return a
 * 200 OK with empty content + `finishReason="stop"`. The model thought hard,
 * emitted no visible tokens, and considers itself done. Cross-run analysis
 * shows the same (model, task) pair often succeeds on a fresh call: the
 * empty is a transient artifact of reasoning-budget exhaustion, sampler
 * dead-ends, or provider-side flake, not a permanent capability gap.
 *
 * 2 retries with linear backoff and small jitter recovers most of these
 * without the bench falling through to attempt 2's fix-up template (which
 * is fed an empty `previousCode` and is rarely productive).
 */
export const DEFAULT_EMPTY_RETRY_MAX_RETRIES = 2;
export const DEFAULT_EMPTY_RETRY_BASE_DELAY_MS = 1000;
export const DEFAULT_EMPTY_RETRY_JITTER_MS = 250;

/**
 * Extended timeout for local models which may be slower.
 */
export const LOCAL_MODEL_TIMEOUT_MS = 60000;

/**
 * Timeout for streaming chunk reception in milliseconds.
 * If no chunk arrives within this time, the stream is aborted.
 * Set higher than API timeout since some chunks can take longer during reasoning.
 */
export const STREAM_CHUNK_TIMEOUT_MS = 120000; // 2 minutes

// =============================================================================
// Timeout Values (Milliseconds)
// =============================================================================

/** One second in milliseconds */
export const ONE_SECOND_MS = 1000;

/** One minute in milliseconds */
export const ONE_MINUTE_MS = 60000;

/** Five minutes in milliseconds - used for long operations */
export const FIVE_MINUTES_MS = 300000;

/** Default retry delay for transient errors */
export const DEFAULT_RETRY_DELAY_MS = 1000;

/** Container ready check interval */
export const CONTAINER_READY_WAIT_MS = 5000;

/** Default BC container name */
export const DEFAULT_CONTAINER_NAME = "Cronus28";

// =============================================================================
// BC Platform & App Manifest Versions
// =============================================================================

// FALLBACKS ONLY - not the source of truth.
//
// The policy is "newest platform and runtime the supplied containers support",
// which a constant cannot express: these numbers freeze whichever BC version
// the containers happened to be on when this file was last edited. Point the
// bench at a BC29 container and a constant would keep emitting platform
// 28.0.0.0 / runtime 17.0, an app.json that forbids every API added since.
//
// `src/container/bc-platform-version.ts` reads the real values from the
// container (its own Microsoft symbol-package manifest states both outright),
// and every generated app.json goes through that. These remain only as the
// last-resort answer when no container can be inspected, and a caller that
// lands on them logs the fact rather than pretending it measured something.

/** Fallback BC platform version. Prefer `resolvePlatformVersions()`. */
export const BC_PLATFORM_VERSION = "28.0.0.0";

/** Fallback BC application version. Prefer `resolvePlatformVersions()`. */
export const BC_APPLICATION_VERSION = "28.0.0.0";

/** Fallback AL runtime version. Prefer `resolvePlatformVersions()`. */
export const BC_RUNTIME_VERSION = "17.0";

/**
 * Test Toolkit dependencies required for running AL tests.
 * These are Microsoft-published apps that must be present in the BC container.
 */
export const TEST_TOOLKIT_DEPENDENCIES = [
  {
    id: "dd0be2ea-f733-4d65-bb34-a28f4624fb14",
    name: "Library Assert",
    publisher: "Microsoft",
    version: BC_PLATFORM_VERSION,
  },
  {
    id: "e7320ebb-08b3-4406-b1ec-b4927d3e280b",
    name: "Any",
    publisher: "Microsoft",
    version: BC_PLATFORM_VERSION,
  },
  {
    id: "5d86850b-0d76-4eca-bd7b-951ad998e997",
    name: "Tests-TestLibraries",
    publisher: "Microsoft",
    version: BC_PLATFORM_VERSION,
  },
] as const;

// =============================================================================
// AL App ID Ranges
// =============================================================================

/**
 * ID range for prerequisite app objects.
 * Range: 69000-69999
 */
export const PREREQ_APP_ID_RANGE = {
  start: 69000,
  end: 69999,
} as const;

/**
 * ID range for benchmark-generated app objects.
 * Range: 70000-74999 (authoring band)
 *
 * 75000-79999 is a deliberate BUFFER and must stay unassigned. Another product
 * on these shared Cronus containers (LethAL) publishes fixture apps occupying
 * 79000-79450. Object ids only collide per (object type, id), so an overlap is
 * not automatically fatal, but the two suites previously coincided at 71000 and
 * 71010 and survived only because the object types happened to differ. That was
 * luck, not design. Keeping authored ids at or below 74999 makes convergence
 * structurally impossible instead of merely unlikely.
 *
 * Highest id actually assigned as of 2026-08-20 is 72000, so the band is not
 * tight. Revisit only if authoring genuinely approaches 74999.
 *
 * Note this is the AUTHORING convention, not the manifest range. Generated
 * app.json files still declare a wider `idRanges` (70000-79999 for solution
 * drafts, 70000-89999 for the bench candidate app, which must also span the
 * test-codeunit band). Narrowing those would change what compiles at bench time
 * and could turn a model's off-spec id choice into a compile error, so it is
 * intentionally left alone.
 */
export const BENCHMARK_APP_ID_RANGE = {
  start: 70000,
  end: 74999,
} as const;

/**
 * Reserved buffer between CentralGauge's authored objects and LethAL's fixture
 * apps on the shared containers. Never assign task object ids from this range.
 * See BENCHMARK_APP_ID_RANGE above.
 */
export const BENCHMARK_APP_ID_BUFFER = {
  start: 75000,
  end: 79999,
} as const;

/**
 * ID range for test codeunits.
 * Range: 80000-89999
 */
export const TEST_CODEUNIT_ID_RANGE = {
  start: 80000,
  end: 89999,
} as const;

/**
 * ID range for the SOAP test harness app (`infra/cg-test-harness`).
 * Range: 50500-50599, matching its own app.json idRanges.
 *
 * The harness is published Global scope and stays resident on a container
 * between runs, so this range is occupied permanently rather than per-task.
 */
export const HARNESS_APP_ID_RANGE = {
  start: 50500,
  end: 50599,
} as const;

/**
 * ID range for tracked spike apps under `spikes/`.
 * Range: 90000-90099
 *
 * Called out because it is easy to assume everything at or above 90000 is free.
 * It is not: `spikes/xrec` occupies 90000-90099.
 */
export const SPIKE_APP_ID_RANGE = {
  start: 90000,
  end: 90099,
} as const;

/**
 * Default test codeunit ID when not specified.
 */
export const DEFAULT_TEST_CODEUNIT_ID = 80001;

// =============================================================================
// Output Formatting
// =============================================================================

/**
 * Maximum characters for output preview/sampling.
 * Used for log truncation and error message samples.
 */
export const OUTPUT_PREVIEW_MAX_LENGTH = 2000;

/**
 * Maximum characters for previous code context in fix attempts.
 */
export const PREVIOUS_CODE_TRUNCATION_LENGTH = 4000;

// =============================================================================
// Code Extraction Confidence Thresholds
// =============================================================================

/**
 * Confidence thresholds for code extraction heuristics.
 * Higher values indicate more certain matches.
 */
export const CONFIDENCE_THRESHOLDS = {
  /** Minimum threshold to accept extracted code */
  accept: 0.5,
  /** Custom delimiters (e.g., ```al) found */
  customDelimiters: 0.95,
  /** Code block with matching language tag */
  codeBlockMatch: 0.9,
  /** Language indicator found in response */
  languageMatch: 0.8,
  /** Pattern-based extraction */
  patternMatch: 0.7,
  /** Language mismatch but valid code structure */
  languageMismatch: 0.6,
  /** Fallback extraction with language match */
  fallbackMatch: 0.3,
  /** Fallback extraction without language match */
  fallbackMismatch: 0.1,
} as const;

// =============================================================================
// Scoring Constants
// =============================================================================

/**
 * Score multiplier for second attempt success.
 * First attempt success = 1.0, second attempt = 0.75
 */
export const SECOND_ATTEMPT_SCORE_MULTIPLIER = 0.75;

/**
 * Penalty factor for models that never pass a task during deduplication.
 */
export const NEVER_PASSING_PENALTY_FACTOR = 0.5;
