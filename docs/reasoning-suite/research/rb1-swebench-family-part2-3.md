# SWE-bench Family report (2/3): Automated successors + SWE-smith

## 3. Automated successors

### 3.1 SWE-bench Multimodal (arXiv:2410.03859, JS + images)
Source: https://arxiv.org/html/2410.03859v1

Five-stage funnel with explicit numbers:

| Stage | Mechanism | Auto/Human | Count |
|---|---|---|---|
| 1 | 17 user-facing JS repos (5k+ stars, 500+ PRs), manual selection | Human | 134,866 PRs |
| 2 | Filter for image/video links in issue or test patch | Auto | 1,478 |
| 3 | Env setup (Node.js + headless Chrome); ~10 h manual labor PER REPO | Human-heavy | 679 |
| 4 | Flakiness screen: run validation 10x per instance, drop inconsistent | Auto | 643 |
| 5 | Manual validation, remove impossible tasks | Human | **619** (24 removed) |

- Tests include **pixel-level visual testing** (69 instances): Puppeteer screenshots + Pixelmatch with tolerance thresholds for anti-aliasing.
- Annotators also verified image relevance (80% of images convey info beyond text; 83.5% judged necessary to solve) and estimated difficulty.
- **Contamination defense**: dev split (102 instances, 5 repos) public; **test split (517, 12 repos) has gold patches and evaluation withheld**; leaderboard runs only via cloud tool sb-cli (https://github.com/SWE-bench/sb-cli). First of the family to hold out the oracle. Also checked for (and found no) pre/post-cutoff performance discontinuity.

### 3.2 SWE-bench-Live (Microsoft, arXiv:2505.23419, NeurIPS 2025 D&B)
Sources: https://arxiv.org/html/2505.23419v1, https://github.com/microsoft/SWE-bench-Live

- Repo funnel: 8,577 Python repos >1k stars -> 3,316 after activity filters (>200 issues+PRs, >200 forks, >=60% Python) -> 2,609 after license check. Issues restricted to **created after 2024-01**.
- **RepoLaunch**: ReAct-style LLM agent replacing manual env setup. Five phases: locate CI/README/install docs -> pick Docker base image -> interactive trial-and-error setup loop (can search web) -> separate **verification agent** finds the right test command and bounces failures back -> commit container as instance-pinned image. Includes a "time machine" pip proxy filtering PyPI packages by release date to reproduce historical dependency state.
- Validation still execution-based: >=1 F2P required; **validation repeated multiple times, only instances consistent across all runs retained**.
- Initial release **1,319 instances / 93 repos**; **monthly** pipeline re-runs add fresh post-cutoff issues.
- Gaps: RepoLaunch success rate unpublished, no intermediate funnel counts after issue mining, no human spot-check of final instances. The LLM-assisted setup is checked only by execution, not review. Overfitting fingerprint: OpenHands+Claude 3.7 = 43.2% Verified vs **19.25%** Live; 22.96% on SWE-bench-overlapping repos vs 18.89% elsewhere.

### 3.3 SWE-rebench (arXiv:2505.20411)
Source: https://arxiv.org/html/2505.20411v1 — best answer to "how do you check the LLM-assisted validation itself":

- Funnel: 30k+ permissive-license Python repos -> ~450k issue-linked PRs -> attribute filters (merged, single issue, description >10 chars, modifies tests + non-test code, 1-15 files) -> ~153,400 candidates -> **21,336 validated tasks across 3,468 repos**.
- Env setup "agentless": Qwen2.5-72B extracts install recipe as structured JSON from README/setup files, iterative error-log-driven repair. Works for at least one task in only **31% of repositories** (published failure rate, unlike Live).
- Execution validation as usual (fail-before/pass-after, P2P stable, pip freeze recorded).
- **LLM quality judge calibrated against Verified's human labels**: fine-tuned Qwen2.5-72B predicts three binary flags; validated on held-out splits of OpenAI's annotations (413 examples each): task complexity 81% acc, **test-patch correctness only 67% acc / 0.65 F1**, issue clarity 79% acc. Agreement numbers published; scores exposed as filters, not silent deletes.
- Decontamination: per-task timestamps tracked vs model release dates; leaderboard marks potentially contaminated entries; 5 runs/model with SEM. They show some models' Verified scores look inflated vs fresh-task slices.

### 3.4 SWE-Gym (arXiv:2412.21139, training environments)
Source: https://arxiv.org/abs/2412.21139

- SWE-bench's extraction script over 358 Python repos -> 64,689 raw instances (SWE-Gym Raw, no envs) -> manual dependency configuration for the 11 highest-yield repos -> SWE-bench's execution-based validation script -> **2,438 validated instances**. Repos disjoint from SWE-bench test repos.
- Published cost of the manual path: **~200 human annotation hours + ~10k CPU-core-hours**; per-instance Docker images avg 2.6 GB (6 TB total). Canonical citation for why successors automated env setup.
- **SWE-Gym Lite** (230): SWE-bench-Lite-style filtering (single-file edits, drop poorly-described problems, oversized diffs).

### 3.5 SWE-bench Pro (Scale AI, arXiv:2509.16941)
Source: https://arxiv.org/pdf/2509.16941

- **1,865 problems, 41 repos, 3 subsets**: public 731 (11 copyleft/GPL repos), **held-out 858** (12 repos, private, kept to detect future overfitting), commercial 276 (18 purchased startup codebases; results public, code never).
- **Contamination by legal design**: GPL/copyleft = legal barrier to inclusion in commercial training corpora; commercial repos not public at all. Per-repo cap 50-100 instances (contrast Django's 850/2,294 in the original).
- **Complexity floor as filter**: trivial 1-10-line edits excluded; every problem >=10 changed lines; avg 107.4 LOC across 4.1 files (they note 161/500 of Verified are 1-2-line fixes).
- **Human augmentation** (generative, not just filtering): each task gets a rewritten **problem statement**, **requirements** list (grounded in the validation tests: what behavior, not how), and where relevant an **interface** spec (expected class/function names) to kill the false-negative mode where a correct solution fails because it picked different names.
- **Env + test validation, 3 steps**: (1) professional engineers hand-build Dockerfiles per repo; (2) automated check that gold tests **pass consistently across several runs** (flaky -> dropped); (3) **human review of every fail2pass test**: dropped if irrelevant to the task description or too broad; all-bad-tests -> instance dropped.
- **Ablation proving augmentation matters**: GPT-5 25.9% with statement+requirements+interface vs **8.4%** with problem statement only (Opus 4.1: 22.7% -> 8.2%). Without spec augmentation, verifier false negatives dominate.
- Post-release reality check: **OpenAI retracted its SWE-bench Pro recommendation July 2026** after an audit (model-based investigator agents + 5 human engineers): ~30% of the 731 public tasks defective; pipeline flagged 200 (27.4%), humans 249 (34.1%); categories: overly strict tests, underspecified prompts, low-coverage tests, misleading prompts; pass rates ran 23.3% -> 80.3% in 8 months toward a "~70% noise ceiling" (https://www.investing.com/news/stock-market-news/openai-retracts-swebench-pro-coding-benchmark-recommendation-93CH-4782526). Even human-verified-and-augmented shipped ~30% defects; independent post-release audit found what in-pipeline review missed.

## 4. SWE-smith (arXiv:2504.21798) — synthetic bug injection

Source: https://arxiv.org/html/2504.21798v2. **50,137 instances, 128 repos, total cost ~$1,360.** Validation philosophy is the inverse of SWE-bench: start from a codebase whose tests pass and only accept an injected bug if the existing suite *demonstrably* catches it.

### Generation strategies (yield = validated/attempted)

| Strategy | Mechanism | Yield | Instances | Cost/cand |
|---|---|---|---|---|
| LM Modify | Claude 3.5/3.7 or o3-mini inserts one of 9 bug classes into an existing function; no signature changes, no compile errors | 56.0% | 17,887 | $0.38 |
| LM Rewrite | Strip function body, LM re-implements from signature+docstring (natural bugs) | 35.0% | 4,173 | $3.93 |
| Procedural AST | 13 deterministic ast transforms (remove loop/conditional, flip operators, invert if/else, shuffle lines, drop exception handler) on complexity-filtered functions | 40.2% | 15,641 | $0 |
| PR Mirror | Take a real merged PR, LM-revert its change against current HEAD | 33.8% | 2,344 | $5.53 |
| Combine (file/module) | Merge 2-4 already-validated bug patches in one file or subdirectory | 96.9% | 10,092 | $0 |

Overall yield **50.1%**: about half of all candidate bugs rejected by the validation gate.

### How injected bugs are validated (fully automated, per candidate)
1. Apply candidate diff in the repo's Docker image.
2. Run full test suite, 2-minute timeout.
3. **Accept only if >=1 previously-passing test now fails** (those become F2P). Reject: no failures (bug invisible to suite = untestable task) or timeout.
4. P2P = rest of suite. Deterministic, execution-based. Median 6 F2P tests/instance.

Solvability is structural, not checked per-instance: the ground-truth fix is by construction the reverse diff of the injected bug, so a correct solution always exists; the gate verifies the *oracle can detect* the bug.

### Environments
**One Docker image per repository** (not per instance): 295 GB total vs est. 50-150 TB SWE-bench-style. Repo funnel: top-5,000 PyPI -> >=1k stars -> exclude the 12 SWE-bench test repos -> Python-parseable. Installation bootstrapped by running SWE-agent (up to 100 steps, avg $0.72/repo) to find install+test commands.

### Human involvement (small, enumerated)
~7 min/repo reviewing the install procedure, ~1 min/repo for a test-output parser; **~20 hours total, one author, 128 repos; 17 repos abandoned during review**. No human ever reviews individual bugs or issue texts.

### Issue text is LM-generated and ablated, not reviewed
Claude 3.5 Sonnet writes GitHub-issue-style text from the bug diff, one F2P test's source, and failing test output ($0.0254/issue). Checked by ablation: agents perform the same with LM-written vs real issue text (7.7% vs 7.8% resolved on Verified). Second-order finding: models trained on issue text embedding the test verbatim learn to skip writing reproduction scripts (66% more often) — prompt style leaks into learned behavior.

### Difficulty calibration
Qwen 2.5 32B rater fine-tuned on OpenAI's 1,699 Verified difficulty annotations (75.3% acc); SWE-smith avg 5.27-5.72 vs SWE-bench 5.01. Difficulty correlated weakly with downstream training outcome; reported rather than hidden.

# SWE-bench Family report (3/3): Failures, criticisms, mitigations, mechanism table

## 5. Known failures, criticisms, adopted mitigations

### 5.1 Solution leakage in issue text — SWE-bench+ (https://arxiv.org/abs/2410.06992)
Manual inspection of **251** SWE-Agent+GPT-4 "resolved" instances: **32.67%** (82) had the solution spelled out in the issue report or comments; **31.08%** (78) passed only because tests were too weak (12.75% outright incorrect fixes, 3.59% wrong file/function, 14.74% incomplete). Removing both drops SWE-Agent+GPT-4 from **12.47% -> 3.97%**, and to **0.55%** on their rebuilt SWE-bench+ (548 post-Oct-2023, leakage-screened instances). AutoCodeRover+GPT-4o: 18.83% -> 3.83%. Mitigations downstream: Pro rewrites problem statements from scratch (leakage removed by construction); SWE-smith generates issue text from the bug (no human thread to leak from); Live/rebench rely on recency (weaker — a fresh issue can still contain its own fix).

### 5.2 Weak tests / false positives — UTBoost (https://arxiv.org/abs/2506.09289)
LLM-driven test augmentation (UTGenerator) over SWE-bench: **36 instances with inadequate tests**, **345 leaderboard patches previously marked "resolved" that fail augmented tests**. Ranking impact: **40.9% of SWE-bench Lite entries affected (18 rank shifts)**, **24.4% of Verified entries (11 shifts)**. Confirms F2P/P2P is one-sided: proves the developer's tests pass, not that the issue is fixed. Mitigations: Pro's per-test human relevance/breadth review + interface pinning; Multimodal's pixel tests. Nobody in the family runs adversarial test augmentation as a standing pre-release gate.

### 5.3 Memorization — "The SWE-Bench Illusion" (https://arxiv.org/abs/2506.12286)
Probes given only issue text (no repo access): models name the buggy file path with up to **76%** accuracy on Verified vs **53%** on comparable non-SWE-bench repos; verbatim 5-gram reproduction of gold functions **35%** vs **18%**. The 23-point gap is a contamination fingerprint. Corroborated by Live's repo-overlap gap (22.96% vs 18.89%) and OpenAI's contamination rationale for retiring Verified. Mitigations by successor: recency windows + monthly refresh (Live), timestamp-vs-release tracking on leaderboard (rebench), private/held-out splits (Multimodal test split via sb-cli; Pro held-out 858 + commercial), copyleft/private sourcing (Pro).

### 5.4 Harness flakiness
Original harness verdicts varied by machine/env; fixed by the Docker harness built for Verified (2024). Every successor treats *determinism itself as a validation gate*: Multimodal 10x runs, Live multi-run consistency, Pro multi-run gold-test consistency, SWE-smith timeout-reject.

### 5.5 Meta-lesson from 2026 (Verified retired Feb 2026; Pro recommendation retracted Jul 2026)
Two independent one-time validation campaigns (Verified's 3-annotator pass, Pro's engineer-built review) both left 30-60% defect rates *in the region that matters* (the unsolved head) once frontier models approached the ceiling. Defect discovery is score-dependent: bad instances are invisible while nobody solves their neighbors, and dominate once everything solvable is solved. Implied requirement: **continuous re-audit of the unsolved residue** (OpenAI's method: model-based investigator agents + independent human engineers, cross-checked at 27.4% vs 34.1% flag rates), not just pre-release gating.

## 6. Cross-cutting mechanism table

| Mechanism | What it checks | Auto/Human | Rejects (published rate) | Pipeline position |
|---|---|---|---|---|
| Attribute filter (issue-linked + test-modifying merged PR) | Task has an oracle and a real problem statement | Auto | ~87% of 90k PRs (SWE-bench) | Mining |
| Execution filter (F2P>=1, envs build, gold patch validates) | Oracle actually detects the change; env reproducible | Auto | ~80% of 11.4k candidates; ~50% env failures | Pre-release, per instance |
| New-symbol test screen | Tests don't encode gold patch's arbitrary naming | Auto | Included above (SWE-bench) | Pre-release |
| 3-annotator rubric, 0-3 severity, conservative ensemble | Issue specificity; test fairness; env sanity | Human (93 devs) | 68.3% of 1,699 (Verified) | Post-hoc audit of released benchmark |
| Multi-run determinism gate (3-10 runs) | Flaky tests/envs | Auto | 5.3% at that stage (Multimodal); unpublished (Live, Pro) | Pre-release |
| Manual solvability check | Impossible/contradictory tasks | Human | 3.8% (24/643, Multimodal) | Pre-release, last gate |
| Agentic env construction | Env buildable without human | Auto (LLM), checked only by execution | rebench: works for just 31% of repos | Mining/setup |
| LLM quality judge calibrated on human labels | Issue clarity, test-patch correctness, difficulty | Auto, validated vs Verified annotations (67-81% acc) | Exposed as filterable scores, not hard rejects (rebench) | Pre-release, continuous |
| Injected-bug detection gate (suite must newly fail) | Synthetic task has a discriminating oracle | Auto | ~49.9% of candidates (SWE-smith) | Generation time |
| Human spec augmentation (requirements + interface) | Kills verifier false negatives from naming/API ambiguity | Human | Ablation: without it, scores drop 25.9% -> 8.4% (Pro) | Authoring |
| Per-F2P-test human relevance/breadth review | Test measures the described task, nothing else | Human | Rate unpublished; instance dropped if all tests bad (Pro) | Pre-release |
| Recency window + rolling refresh | Contamination | Auto | n/a (Live monthly; rebench continuous) | Continuous |
| Private/held-out splits | Contamination + leaderboard gaming + future overfitting detection | Structural | n/a | Release design |
| Copyleft/proprietary sourcing | Contamination via legal/access barrier | Structural | n/a (Pro) | Repo selection |
| Post-release adversarial audit (investigator agents + independent engineers) | Residual defects in unsolved head | Both | Verified: >=59.4% of audited hard subset flawed; Pro: ~30% of public split | Continuous / post-release |

### Key sources
- SWE-bench: https://arxiv.org/abs/2310.06770
- Verified: https://openai.com/index/introducing-swe-bench-verified/ - retirement: https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/
- Multimodal: https://arxiv.org/abs/2410.03859 - sb-cli: https://github.com/SWE-bench/sb-cli
- Live: https://arxiv.org/abs/2505.23419 - rebench: https://arxiv.org/abs/2505.20411 - SWE-Gym: https://arxiv.org/abs/2412.21139
- Pro: https://arxiv.org/abs/2509.16941 - SWE-smith: https://arxiv.org/abs/2504.21798
- SWE-bench+: https://arxiv.org/abs/2410.06992 - UTBoost: https://arxiv.org/abs/2506.09289 - Illusion: https://arxiv.org/abs/2506.12286
