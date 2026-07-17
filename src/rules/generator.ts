/**
 * Generates markdown rules files from model shortcomings JSON
 * @module src/rules/generator
 */

import type {
  ModelShortcomingEntry,
  ModelShortcomingsFile,
} from "../verify/types.ts";
import { LLMAdapterRegistry } from "../llm/registry.ts";
import { resolveAnalyzerModelDefault } from "../config/mod.ts";

/**
 * Options for generating rules markdown
 */
export interface RulesGeneratorOptions {
  /** Minimum occurrences to include (default: 1) */
  minOccurrences?: number;
}

/**
 * Options for generating optimized rules via LLM summarization
 */
export interface OptimizedRulesOptions extends RulesGeneratorOptions {
  /** LLM provider for summarization (default: derived from lifecycle.analyzer_model) */
  llmProvider?: string | undefined;
  /** LLM model for summarization (default: `lifecycle.analyzer_model` config chain) */
  llmModel?: string | undefined;
}

/**
 * Convert alConcept slug to a human-readable title
 */
function formatCategoryTitle(alConcept: string): string {
  return alConcept
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Convert concept slug to a human-readable title
 */
function formatConceptTitle(concept: string): string {
  return concept
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Format code block with proper escaping
 */
function formatCodeBlock(code: string, language = "al"): string {
  const trimmed = code.trim();
  if (!trimmed || trimmed === "// Generated code not found") {
    return "";
  }
  return `\`\`\`${language}\n${trimmed}\n\`\`\``;
}

/**
 * Generate a single rule entry
 */
function generateRuleEntry(entry: ModelShortcomingEntry): string {
  const lines: string[] = [];

  // Rule title
  lines.push(`### ${formatConceptTitle(entry.concept)}`);
  lines.push("");

  // Error codes
  if (entry.errorCodes.length > 0) {
    lines.push(`**Error codes**: ${entry.errorCodes.join(", ")}`);
    lines.push("");
  }

  // Description
  lines.push(entry.description);
  lines.push("");

  // Incorrect pattern
  const incorrectBlock = formatCodeBlock(entry.incorrectPattern);
  if (incorrectBlock) {
    lines.push("**Incorrect:**");
    lines.push(incorrectBlock);
    lines.push("");
  }

  // Correct pattern
  const correctBlock = formatCodeBlock(entry.correctPattern);
  if (correctBlock) {
    lines.push("**Correct:**");
    lines.push(correctBlock);
    lines.push("");
  }

  lines.push("---");
  lines.push("");

  return lines.join("\n");
}

/**
 * Check if a shortcoming is actionable (not just a code generation failure)
 * Filters out entries that describe the model failing to generate any code,
 * which could be caused by various issues (API errors, timeouts, etc.)
 */
export function isActionableShortcoming(entry: ModelShortcomingEntry): boolean {
  const nonActionablePhrases = [
    "failed to generate any code",
    "generated code not found",
    "produced no code",
    "empty or invalid response",
    "failed to produce",
  ];

  const descLower = entry.description.toLowerCase();
  const incorrectLower = entry.incorrectPattern.toLowerCase();

  // Skip if description indicates generation failure
  for (const phrase of nonActionablePhrases) {
    if (descLower.includes(phrase)) return false;
  }

  // Skip if incorrect pattern is just a placeholder comment
  if (
    incorrectLower.includes("generated code not found") &&
    entry.incorrectPattern.length < 50
  ) {
    return false;
  }

  return true;
}

/**
 * Group shortcomings by alConcept category
 */
function groupByCategory(
  entries: ModelShortcomingEntry[],
): Map<string, ModelShortcomingEntry[]> {
  const grouped = new Map<string, ModelShortcomingEntry[]>();

  for (const entry of entries) {
    const category = entry.alConcept || "other";
    const existing = grouped.get(category) || [];
    existing.push(entry);
    grouped.set(category, existing);
  }

  return grouped;
}

/**
 * Generate markdown rules from model shortcomings file
 */
export function generateRulesMarkdown(
  data: ModelShortcomingsFile,
  options: RulesGeneratorOptions = {},
): string {
  const { minOccurrences = 1 } = options;

  // Filter by minimum occurrences and actionability
  const filtered = data.shortcomings
    .filter((s) => s.occurrences >= minOccurrences)
    .filter(isActionableShortcoming);

  if (filtered.length === 0) {
    return `# AL Code Generation Rules for ${data.model}\n\nNo shortcomings found with minimum ${minOccurrences} occurrences.\n`;
  }

  // Group by category
  const grouped = groupByCategory(filtered);
  const categories = Array.from(grouped.keys()).sort();

  const lines: string[] = [];

  // Header
  lines.push(`# AL Code Generation Rules for ${data.model}`);
  lines.push("");
  lines.push(
    `> Auto-generated from benchmark shortcomings on ${
      new Date(data.lastUpdated).toLocaleDateString()
    }.`,
  );
  lines.push(
    `> ${filtered.length} rules covering ${categories.length} categories.`,
  );
  lines.push("");

  // Table of contents
  lines.push("## Categories");
  lines.push("");
  for (const category of categories) {
    const count = grouped.get(category)!.length;
    const anchor = category.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    lines.push(
      `- [${formatCategoryTitle(category)}](#${anchor}) (${count} rules)`,
    );
  }
  lines.push("");

  // Rules by category
  for (const category of categories) {
    const entries = grouped.get(category)!;
    const anchor = category.toLowerCase().replace(/[^a-z0-9]+/g, "-");

    lines.push(`## ${formatCategoryTitle(category)} {#${anchor}}`);
    lines.push("");

    for (const entry of entries) {
      lines.push(generateRuleEntry(entry));
    }
  }

  return lines.join("\n");
}

/**
 * Load shortcomings JSON from file
 */
export async function loadShortcomingsFile(
  path: string,
): Promise<ModelShortcomingsFile> {
  const content = await Deno.readTextFile(path);
  const data = JSON.parse(content) as ModelShortcomingsFile;

  // Basic validation
  if (!data.model || !Array.isArray(data.shortcomings)) {
    throw new Error(`Invalid shortcomings file format: ${path}`);
  }

  return data;
}

/**
 * Generate output path from input path
 * input.json -> input.rules.md
 */
export function getDefaultOutputPath(inputPath: string): string {
  return inputPath.replace(/\.json$/i, ".rules.md");
}

/**
 * Build the LLM prompt for rules summarization
 */
function buildOptimizationPrompt(
  shortcomings: ModelShortcomingEntry[],
): string {
  const jsonData = JSON.stringify(shortcomings, null, 2);

  return `You are condensing AL programming rules for injection into another LLM's system prompt.

Given these model shortcomings from a Business Central AL code benchmark, produce a minimal set of rules that will help an LLM avoid these mistakes.

Requirements:
- Each rule must be ONE line with inline code examples using backticks
- Use positive framing: "Use X" not "Don't use Y"
- Group related rules under short category headers (## Header)
- No explanations - just the rule and code
- Deduplicate and merge similar rules
- Output plain markdown, no TOC, no metadata, no intro text
- Start directly with the first category header

Example format:
## Collections
- Use \`Clear(MyList)\` function; the \`.Clear()\` method doesn't exist in AL

## FlowFields
- Call \`CalcFields(FieldName)\` before reading FlowField values; direct access returns 0

Input shortcomings:
${jsonData}`;
}

/**
 * Resolve the (provider, model) pair to use for the summarization LLM call.
 *
 * - Both supplied: used verbatim, no config lookup.
 * - `llmModel` supplied but `llmProvider` isn't: the model is already
 *   decided, so `llmProvider` just defaults to `"anthropic"` (matching this
 *   CLI's historical bare-model-id convention, e.g. `--llm gpt-5-codex`) —
 *   NOT resolved from the config chain. Resolving provider from
 *   `lifecycle.analyzer_model` here would silently pair an explicit model
 *   with an unrelated provider (e.g. an openrouter default provider next to
 *   an OpenAI model id) whenever the config's provider differs.
 * - `llmModel` unset (regardless of `llmProvider`): BOTH are resolved
 *   together from the `lifecycle.analyzer_model` config chain
 *   (`.centralgauge.yml` -> built-in default `anthropic/claude-opus-4-6`),
 *   vendor-prefixed like every other model slug in this repo (see
 *   CLAUDE.md "Slug rule").
 *
 * Exported standalone so the fallback logic is unit-testable without
 * invoking an LLM adapter.
 */
export async function resolveGeneratorModel(
  options: Pick<OptimizedRulesOptions, "llmProvider" | "llmModel">,
): Promise<{ provider: string; model: string }> {
  if (options.llmModel !== undefined) {
    return {
      provider: options.llmProvider ?? "anthropic",
      model: options.llmModel,
    };
  }
  const defaultSlug = await resolveAnalyzerModelDefault();
  const slash = defaultSlug.indexOf("/");
  const defaultProvider = slash === -1
    ? "anthropic"
    : defaultSlug.slice(0, slash);
  const defaultModel = slash === -1
    ? defaultSlug
    : defaultSlug.slice(slash + 1);
  return {
    provider: options.llmProvider ?? defaultProvider,
    model: defaultModel,
  };
}

/**
 * Generate optimized rules via LLM summarization
 * Produces concise, actionable rules suitable for system prompt injection
 */
export async function generateOptimizedRules(
  data: ModelShortcomingsFile,
  options: OptimizedRulesOptions = {},
): Promise<string> {
  const { minOccurrences = 1 } = options;

  // Filter by minimum occurrences and actionability
  const filtered = data.shortcomings
    .filter((s) => s.occurrences >= minOccurrences)
    .filter(isActionableShortcoming);

  if (filtered.length === 0) {
    return `# AL Rules for ${data.model}\n\nNo actionable shortcomings found.\n`;
  }

  const { provider: llmProvider, model: llmModel } =
    await resolveGeneratorModel(options);

  // Build the prompt
  const prompt = buildOptimizationPrompt(filtered);

  // Get LLM adapter
  const adapter = LLMAdapterRegistry.create(llmProvider, {
    provider: llmProvider,
    model: llmModel,
  });

  // Call the LLM
  const response = await adapter.generateCode(
    { prompt, temperature: 0.3, maxTokens: 4000 },
    {
      taskId: "rules-generation",
      attempt: 1,
      description:
        `Summarize ${filtered.length} AL shortcomings into injection-ready rules`,
    },
  );

  // Add header with model name
  const header = `# AL Rules for ${data.model}\n\n`;

  return header + response.code.trim() + "\n";
}
