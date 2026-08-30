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
 *   deno run --allow-all scripts/attractor-probe.ts candidates.json
 *
 * where candidates.json is [{ "name": "...", "requirement": "..." }, ...].
 */

import { LLMAdapterRegistry } from "../src/llm/registry.ts";
import { EnvLoader } from "../src/utils/env-loader.ts";

interface Candidate {
  name: string;
  /** The requirement, phrased as a task description would phrase it. */
  requirement: string;
  /** Optional: what the WRONG implementation looks like, for the report. */
  expectedWrongForm?: string;
}

const PROMPT = (requirement: string) =>
  `You are a Business Central AL developer. Implement the following requirement.

${requirement}

Output ONLY AL code, no explanation. Write it the way you would write it in a real codebase.`;

async function main(): Promise<number> {
  await EnvLoader.loadEnvironment();
  const path = Deno.args[0];
  if (!path) {
    console.error("usage: attractor-probe.ts candidates.json [model ...]");
    return 1;
  }
  const candidates: Candidate[] = JSON.parse(await Deno.readTextFile(path));
  const models = Deno.args.slice(1).length > 0
    ? Deno.args.slice(1)
    : ["anthropic/claude-opus-5", "openai/gpt-5.5"];

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
          { prompt: PROMPT(c.requirement), maxTokens: 4000, temperature: 0 },
          {
            taskId: "attractor-probe",
            attempt: 1,
            description: c.requirement,
          },
        );
        const code = (res.code ?? "").trim();
        console.log(`\n--- ${slug} (${code.split("\n").length} lines)`);
        console.log(code.slice(0, 2400));
      } catch (err) {
        console.log(
          `\n--- ${slug}: ERROR ${err instanceof Error ? err.message : err}`,
        );
      } finally {
        LLMAdapterRegistry.release(adapter);
      }
    }
  }
  return 0;
}

if (import.meta.main) Deno.exit(await main());
