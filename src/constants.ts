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

/** BC platform version for app.json manifests */
export const BC_PLATFORM_VERSION = "28.0.0.0";

/** BC application version for app.json manifests */
export const BC_APPLICATION_VERSION = "28.0.0.0";

/** AL runtime version for app.json manifests */
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
 * Range: 70000-79999
 */
export const BENCHMARK_APP_ID_RANGE = {
  start: 70000,
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
