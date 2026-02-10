# CentralGauge Benchmark Update: Why the Numbers Changed

Shortly after Claude Opus 4.6 launched, I published the first CentralGauge benchmark results comparing 8 LLMs on AL code generation for Microsoft Dynamics 365 Business Central (BC). Those initial numbers told an interesting story, but they weren't the full picture.

Since then, I've made significant fixes to the benchmark infrastructure, task definitions, and test harness. The scores have shifted. Some models improved substantially. Some tasks that appeared impossible turned out to be broken on my end. And results that seemed inconsistent are now stable and reproducible.

This post covers what changed and why the updated results are more trustworthy.

---

## Code Extraction Was Silently Corrupting Model Output

The most impactful bugs were in the code extraction pipeline. Models were generating valid AL code, but the harness was mangling it before compilation.

**Missing sanitization step.** After extracting code from an LLM response, the `cleanCode()` function was never being called. This meant markdown code fences (three backticks, sometimes with an `al` language tag) remained embedded in the generated AL source and caused compilation failures. The model did its job correctly; the pipeline threw away the result.

**Greedy regex on self-correction.** When models self-correct mid-response, they sometimes output multiple code blocks. The extraction used a greedy regex that captured everything from the first `BEGIN-CODE` marker to the last `END-CODE` marker, including explanation text between blocks. The fix was straightforward: switch to a non-greedy match and take the last (most corrected) block.

**Missing fences on fix prompts.** CentralGauge gives models a second attempt after compilation failure by feeding back the errors. The fix prompt lacked the structured `BEGIN-CODE`/`END-CODE` delimiters that the initial generation prompt used. Without them, some models (especially Gemini) prepended explanatory prose that leaked into the extracted code. After adding fences and a "code only, no explanations" instruction, Gemini's second-attempt recovery improved dramatically in my validation tests.

The net effect: more models now produce compilable code on both attempts because the extractor no longer injects invalid characters or captures stale blocks.

---

## Tasks That Were Impossible to Solve

In the initial run, 11 tasks had a 0% pass rate across all 8 models and all 3 runs. That's a strong signal that the problem lies with the task, not the models.

I audited each one and found issues like:

- test harness bugs that triggered runtime errors regardless of the generated code
- missing support files (report layouts) that the BC runtime requires
- incorrect test policies that blocked valid operations at compile time
- assertions that tested the wrong error codes, or didn't account for BC's transaction rollback behavior

These weren't subtle issues. They were infrastructure failures that made it structurally impossible for any model to pass, regardless of the quality of its generated code.

---

## Vague Specifications Made Scores Noisy

Beyond the completely broken tasks, a larger set had ambiguous descriptions or tests that didn't properly verify what the task asked for. That made scores noisy: a model might pass on one run and fail on the next depending on arbitrary choices.

The most common issue was function signatures in the task specification not matching what the tests actually called. Models had to guess parameter names and types, turning the task into a lottery. I realigned 8 task descriptions so the spec matches the test exactly.

Other fixes included:

- removing ambiguous phrasing that left models unsure which AL pattern to use
- correcting task specs that contained invalid AL syntax
- hardening tests to accept multiple valid implementation approaches

In one case, a task jumped from 31% to 90% simply by handling valid model behaviors (UI popups, error patterns, HTTP calls) that the tests weren't prepared for. The models were already doing the right thing.

---

## Updated Rankings

After all fixes, here are the current results across 56 tasks (17 Easy, 16 Medium, 23 Hard), 3 runs each.

- `pass@1`: probability a task passes in a single randomly sampled run
- `pass@3`: probability a task passes at least once across the 3 runs
- `Consistency`: fraction of tasks where all 3 runs have the same outcome (all pass or all fail)

| Rank | Model | pass@1 | pass@3 | Consistency | Cost/run |
|------|-------|--------|--------|-------------|----------|
| 1 | Claude Opus 4.6 | **70.2%** | **76.8%** | 87.5% | $3.85 |
| 2 | Claude Opus 4.5 (50K thinking) | 66.7% | 71.4% | 92.9% | $3.27 |
| 3 | Claude Sonnet 4.5 | 64.9% | 66.1% | **98.2%** | $1.63 |
| 4 | GPT-5.2 (thinking=high) | 59.5% | 62.5% | 92.9% | $1.28 |
| 5 | Gemini 3 Pro | 54.2% | 58.9% | 89.3% | $1.12 |
| 6 | Grok Code Fast 1 | 53.0% | 60.7% | 83.9% | $1.63 |
| 7 | DeepSeek V3.2 | 45.8% | 53.6% | 80.4% | $1.07 |
| 8 | Qwen3 Coder Next | 32.1% | 37.5% | 91.1% | $1.10 |

The ranking order is broadly similar to the initial run, but the absolute scores have changed as previously unsolvable tasks became solvable and noisy tasks stabilized.

Key observations:

- **Sonnet 4.5 at 98.2% consistency** is the standout metric. It gives nearly identical results every run, with only a 1.2 percentage point gap between pass@1 and pass@3.
- **Gemini 3 Pro's self-correction gap** remains the most striking anomaly: only 3.75% of first-attempt failures are recovered on the second attempt, compared to 24-31% for other models. The `BEGIN-CODE`/`END-CODE` fence fix helped, but Gemini's tendency to rewrite entire responses (rather than making targeted fixes) remains a structural limitation.
- **Cost efficiency** favors GPT-5.2 and Gemini 3 Pro at roughly $0.037-0.038 per passed task, while Opus 4.6 costs $0.098 per passed task for its +5-16pp accuracy advantage.

---

## What's Next

The benchmark continues to evolve. Current priorities:

- **Continued task auditing.** I'm still identifying tasks with edge-case issues, particularly around BC runtime behaviors like transaction rollbacks and UI handlers.
- **More models.** I plan to add models as they become available, particularly from providers I haven't yet covered.
- **Agent benchmarks.** CentralGauge now supports running AI agents (like Claude Code) in isolated Docker containers. That gives them access to the AL compiler and test runner as tools rather than static prompts. Early results suggest agents substantially outperform single-shot generation on harder tasks.
- **Scale improvements.** Multi-container support, task-level parallelism, and parallelized compilation now make full benchmark runs significantly faster.

The full benchmark results, task definitions, and source code are available on [GitHub](https://github.com/SShadowS/CentralGauge).

If you have feedback, spot issues, or want to contribute, please open an issue or submit a pull request. The goal is a transparent, reproducible benchmark that drives progress in AL code generation for BC.