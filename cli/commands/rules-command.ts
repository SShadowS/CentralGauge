/**
 * Rules generation command - converts model shortcomings JSON to markdown rules
 * @module cli/commands/rules
 */

import { Command } from "@cliffy/command";
import * as colors from "@std/fmt/colors";
import {
  generateOptimizedRules,
  getDefaultOutputPath,
  isActionableShortcoming,
  loadShortcomingsFile,
  resolveGeneratorModel,
} from "../../src/rules/mod.ts";

/**
 * Handle the rules generation command
 */
export async function handleRulesGenerate(
  inputPath: string,
  options: {
    output?: string | undefined;
    minOccurrences: number;
    llm?: string | undefined;
  },
): Promise<void> {
  try {
    // Load the shortcomings file
    console.log(colors.dim(`Loading ${inputPath}...`));
    const data = await loadShortcomingsFile(inputPath);

    // Count actionable shortcomings
    const filteredCount = data.shortcomings
      .filter((s) => s.occurrences >= options.minOccurrences)
      .filter(isActionableShortcoming).length;
    const skippedCount = data.shortcomings.length - filteredCount;

    if (filteredCount === 0) {
      console.log(colors.yellow(`[WARN] No actionable shortcomings found`));
      return;
    }

    // Resolve the model up front (T14/V11): --llm wins when given, else the
    // lifecycle.analyzer_model config chain applies. Resolving explicitly
    // here (rather than leaving it to generateOptimizedRules's own internal
    // fallback) lets the log line below show the model actually used
    // instead of "undefined" when --llm was omitted.
    const { provider: llmProvider, model: llmModel } =
      await resolveGeneratorModel({ llmModel: options.llm });

    // Generate optimized rules via LLM
    console.log(
      colors.dim(
        `Summarizing ${filteredCount} shortcomings with ${llmModel}...`,
      ),
    );
    const markdown = await generateOptimizedRules(data, {
      minOccurrences: options.minOccurrences,
      llmProvider,
      llmModel,
    });

    // Determine output path
    const outputPath = options.output || getDefaultOutputPath(inputPath);

    // Write the output
    await Deno.writeTextFile(outputPath, markdown);

    // Report success
    console.log(
      colors.green(`[OK] Generated optimized rules for ${data.model}`),
    );
    console.log(
      colors.dim(
        `     ${filteredCount} shortcomings condensed (${skippedCount} skipped)`,
      ),
    );
    console.log(colors.dim(`     Output: ${outputPath}`));
  } catch (error) {
    console.error(
      colors.red(`[ERROR] ${error instanceof Error ? error.message : error}`),
    );
    Deno.exit(1);
  }
}

/**
 * Register the rules command
 */
export function registerRulesCommand(cli: Command): void {
  cli
    .command(
      "rules <input:string>",
      "Generate optimized rules from shortcomings JSON via LLM summarization",
    )
    .description(
      "Convert model shortcomings JSON to concise, actionable rules optimized for LLM system prompt injection",
    )
    .option(
      "-o, --output <path:string>",
      "Output file path (default: {input}.rules.md)",
    )
    .option(
      "--llm <model:string>",
      "LLM model for summarization (default: lifecycle.analyzer_model config chain)",
    )
    .option(
      "--min-occurrences <n:number>",
      "Only include shortcomings with at least N occurrences",
      { default: 1 },
    )
    .example(
      "Basic usage",
      "centralgauge rules model-shortcomings/gpt-5.2-2025-12-11.json",
    )
    .example(
      "Custom output path",
      "centralgauge rules model-shortcomings/gpt-5.2.json -o .claude/rules/gpt-5.2.md",
    )
    .example(
      "Use different LLM",
      "centralgauge rules model-shortcomings/gpt-5.2.json --llm claude-sonnet-4-20250514",
    )
    .action(async (options, input: string) => {
      await handleRulesGenerate(input, {
        output: options.output,
        minOccurrences: options.minOccurrences,
        llm: options.llm,
      });
    });
}
