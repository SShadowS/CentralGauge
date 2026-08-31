/**
 * Attractor probe - the cheap screening step the corrected wave-2 rule needs.
 *
 * Measured across the seven-model panel, the tasks that defeat frontier first
 * attempts are not broadly hard: they are ATTRACTORS. Mean modal share 85%,
 * mean 1.6 distinct failure sets, seven of twelve at 100% - independent models
 * from four vendors converge on the SAME wrong answer, and the oracle grades
 * exactly that.
 *
 * Both wave-2 pilots failed because their starters carried a defect no
 * frontier model would write, so there was nothing for the oracle to catch.
 * That is `hardening-pipeline.md` gate A1 - "drop any candidate whose wrong
 * form a model would not plausibly write fresh" - which a derived recipe
 * quietly dropped.
 *
 * This makes A1 empirical instead of a judgement call: state a requirement,
 * ask real models to implement it from scratch, and see whether they write the
 * wrong form. Costs cents. A candidate that models implement CORRECTLY has no
 * task in it, and should die here rather than after a build slot and a gate
 * run.
 *
 * Usage:
 *   deno run --allow-all scripts/attractor-probe.ts candidates.json [--out=cells.json] [model ...]
 *
 * where candidates.json is [{ "name": "...", "requirement": "..." }, ...].
 *
 * Every cell line reports output tokens, reasoning tokens, finish reason and
 * estimated cost, and flags an EMPTY cell explicitly: a starved or refused
 * cell otherwise reads as "the model wrote nothing" and silently corrupts the
 * hit rate. `--out=` writes the full untruncated cells as JSON so a judge can
 * read the whole answer, not the 2400-char console excerpt.
 */

import type { LLMAdapter, TokenUsage } from "../src/llm/types.ts";
import { LLMAdapterRegistry } from "../src/llm/registry.ts";
import { EnvLoader } from "../src/utils/env-loader.ts";

interface Candidate {
  name: string;
  /** The requirement, phrased as a task description would phrase it. */
  requirement: string;
  /** Optional: what the WRONG implementation looks like, for the report. */
  expectedWrongForm?: string;
}

export interface ProbeCell {
  name: string;
  model: string;
  code: string;
  lines: number;
  outputTokens: number;
  reasoningTokens: number;
  finishReason: string;
  servedModel?: string;
  costUsd: number;
  error?: string;
}

const PROMPT = (requirement: string) =>
  `You are a Business Central AL developer. Implement the following requirement.

${requirement}

Output ONLY AL code, no explanation. Write it the way you would write it in a real codebase.`;

function costOf(adapter: LLMAdapter, usage: TokenUsage): number {
  if (typeof usage.estimatedCost === "number") return usage.estimatedCost;
  try {
    return adapter.estimateUsageCost(usage);
  } catch {
    return 0;
  }
}

async function main(): Promise<number> {
  await EnvLoader.loadEnvironment();
  const positional = Deno.args.filter((a) => !a.startsWith("--"));
  const outPath = Deno.args.find((a) => a.startsWith("--out="))?.slice(
    "--out=".length,
  );
  const path = positional[0];
  if (!path) {
    console.error(
      "usage: attractor-probe.ts candidates.json [--out=cells.json] [model ...]",
    );
    return 1;
  }
  const candidates: Candidate[] = JSON.parse(await Deno.readTextFile(path));
  const models = positional.slice(1).length > 0
    ? positional.slice(1)
    : ["anthropic/claude-opus-5", "openai/gpt-5.5"];
  const maxTokens = Number(
    Deno.env.get("CENTRALGAUGE_PROBE_MAX_TOKENS") ?? 16000,
  );

  const cells: ProbeCell[] = [];
  let totalCost = 0;

  for (const c of candidates) {
    console.log(`\n${"=".repeat(72)}\n== ${c.name}`);
    if (c.expectedWrongForm) {
      console.log(`   looking for the wrong form: ${c.expectedWrongForm}`);
    }
    for (const slug of models) {
      const [provider, ...rest] = slug.split("/");
      const model = rest.join("/");
      const adapter = LLMAdapterRegistry.acquire(provider!, {
        provider: provider!,
        model,
      });
      try {
        const res = await adapter.generateCode(
          {
            // 4000 starved reasoning models: thinking tokens are drawn from the
            // same budget, so 5 of 12 gpt-5.5 cells came back with no visible
            // output at all and one Opus answer was truncated mid-identifier.
            // Same class of defect as bench's --max-tokens default. Override
            // with CENTRALGAUGE_PROBE_MAX_TOKENS.
            prompt: PROMPT(c.requirement),
            maxTokens,
            temperature: 0,
          },
          {
            taskId: "attractor-probe",
            attempt: 1,
            description: c.requirement,
          },
        );
        // Fall back to the raw response: the adapter's extractor returns ""
        // when the model answers without a fence, which silently loses the
        // cell. Three of twelve cells were lost that way on the first
        // undocumented-behaviour screen.
        const code = (res.code ?? "").trim() ||
          (res.response?.content ?? "").trim();
        const usage = res.response.usage;
        const cost = costOf(adapter, usage);
        totalCost += cost;
        const cell: ProbeCell = {
          name: c.name,
          model: slug,
          code,
          lines: code ? code.split("\n").length : 0,
          outputTokens: usage.completionTokens,
          reasoningTokens: usage.reasoningTokens ?? 0,
          finishReason: res.response.finishReason,
          costUsd: cost,
        };
        if (res.response.servedModel) {
          cell.servedModel = res.response.servedModel;
        }
        cells.push(cell);
        const served = cell.servedModel ? `, served=${cell.servedModel}` : "";
        const empty = code.length === 0 ? "   !! EMPTY CELL" : "";
        console.log(
          `\n--- ${slug} (${cell.lines} lines, out=${cell.outputTokens} tok, ` +
            `reasoning=${cell.reasoningTokens} tok, finish=${cell.finishReason}` +
            `${served}, $${cost.toFixed(4)})${empty}`,
        );
        console.log(code.slice(0, 2400));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        cells.push({
          name: c.name,
          model: slug,
          code: "",
          lines: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          finishReason: "error",
          costUsd: 0,
          error: message,
        });
        console.log(`\n--- ${slug}: ERROR ${message}   !! EMPTY CELL`);
      } finally {
        LLMAdapterRegistry.release(adapter);
      }
    }
  }

  const empties = cells.filter((c) => c.code.length === 0).length;
  console.log(
    `\n${
      "=".repeat(72)
    }\nTOTAL: ${cells.length} cells, ${empties} empty/error, ` +
      `estimated cost $${totalCost.toFixed(4)}`,
  );
  if (outPath) {
    await Deno.writeTextFile(outPath, JSON.stringify(cells, null, 1));
    console.log(`cells written to ${outPath}`);
  }
  return 0;
}

if (import.meta.main) Deno.exit(await main());
