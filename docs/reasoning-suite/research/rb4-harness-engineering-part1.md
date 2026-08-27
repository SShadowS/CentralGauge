# Harness Engineering in Major SWE Benchmarks (1/3)

How benchmarks guarantee a task means the same thing in every environment that runs it. Mechanisms, numbers, citations.

---

## 1. Environment pinning

### SWE-bench: from conda drift to per-instance Docker

- **The original harness was conda-based and non-reproducible.** The official June 27, 2024 containerization announcement states evaluation "remained sensitive to discrepancies originating from different platforms and user-specific configurations, leading to inconsistent results" (https://github.com/SWE-bench/SWE-bench/tree/main/docs/20240627_docker).
- **Fix: a three-layer Docker image hierarchy**, built by the harness itself: one **base** image -> ~60 **environment** images (Python env permutations, ~100 GB) -> one **instance** image per task (task-specific deps + repo at base commit). Storage/speed knob `cache_level`: `env` ~120 GB (~30 min for Lite on 16 cores), `instance` ~2,000 GB (~15 min) (https://www.swebench.com/SWE-bench/reference/harness/).
- **Validation at cutover was gold-solution replay**: 99.78% of full SWE-bench (2,289/2,294) and 100% of Lite (300/300) resolve correctly with the ground-truth patch under the Docker harness; the remaining 5 are the acknowledged irreducible flaky tail.
- **Distribution**: the harness now defaults to **pulling prebuilt Linux images from Docker Hub under the `swebench/` namespace** rather than rebuilding; ARM users pass `--namespace ''` to force local builds (https://www.swebench.com/SWE-bench/guides/docker_setup/).
- **Epoch AI's registry hardened this further**: `ghcr.io/epoch-research/swe-bench.eval.<arch>.<instance_id>`, MIT-licensed, **2,290/2,294 x86_64 images (99.8%), 500/500 Verified**, plus 1,819 best-effort UNTESTED arm64 images. Layer restructuring cut unique-layer size **684 GiB -> 67 GiB (10x)** for full SWE-bench, 189 -> 30 GiB (6x) for Verified; images carry only the `latest` tag. Result: full Verified run in ~62-70 min on one 32-core GitHub Actions VM (~8 s/sample) (https://epoch.ai/latest/swebench-docker, https://github.com/epoch-research/SWE-bench).
- **Why prebuilt images matter — rebuild drift is documented**: issue #484 (Oct 2025) shows gold patches failing on REBUILT environments for astropy and psf/requests instances: pytest 8 dropping nose-style `setup()`, NumPy 1.24 removing `np.int`/`np.float`/`np.bool`, `distutils.LooseVersion` deprecation, and tests calling the live httpbin.org getting 503s (https://github.com/SWE-bench/SWE-bench/issues/484). Same class earlier: #267 "5 Instances in Verified Fail for Gold Patch", #328, #372. Lesson: pinning the *Dockerfile* is not pinning the *environment*; only frozen images are.
- **Lifecycle**: image build + gold validation at dataset construction; images frozen thereafter; consumers pull, never rebuild. Fully automated once built.

### BigCodeBench

- Execution is deliberately "less constrained" (diverse library deps), so **Docker is the mandated sandbox**, with pre-built `bigcodebench/bigcodebench-evaluate` images (https://github.com/bigcode-project/bigcodebench, https://hub.docker.com/r/bigcodebench/bigcodebench-evaluate).
- Pinning is via the evaluate image + versioned dataset releases (`v0.1.0_hf` ... `v0.1.4`, 1,140 tasks each) (https://huggingface.co/datasets/bigcode/bigcodebench/blob/main/README.md).

### LiveCodeBench

- Contamination control is **temporal, not environmental**: problems continuously scraped from LeetCode/AtCoder/CodeForces with release dates; models scored only on post-cutoff windows (`--start_date`), e.g. DeepSeek results reported only on problems after Aug 2023 (https://arxiv.org/abs/2403.07974, https://github.com/livecodebench/livecodebench).
- Versioned by accretion: `release_v1` (400 problems, May 2023-Mar 2024) through `release_v6` (1,055 problems, to Apr 2025); an **ERRATA.md** tracks erroneous tests and problems "not amenable to autograding"; documented run-to-run variation from timeouts is <0.5 points, tunable via `--timeout`/`--num_process_evaluate`.

### SWE-bench-Live (automated environment pinning at scale)

- **RepoLaunch**, an LLM-agentic pipeline, builds a testable containerized environment for arbitrary GitHub repos; 1,890 tasks across 223 repos, **each with a dedicated Docker image**, refreshed monthly (https://github.com/microsoft/SWE-bench-Live, https://openreview.net/forum?id=OGWkr7gXka). The automated end of the spectrum vs. Verified's human curation.

---

## 2. Single-harness discipline

- **SWE-bench designates one canonical entry point** — `python -m swebench.harness.run_evaluation` — and the leaderboard enforces it procedurally: submissions are PRs to the experiments repo containing predictions, **execution logs, and (mandatory since 2024-07-29) reasoning traces/trajectories** (https://www.swebench.com/submit.html, https://github.com/swe-bench/experiments/blob/main/README.md, https://www.swebench.com/sb-cli/submit-to-leaderboard/). `sb-cli` runs evaluation remotely on the official images, removing the "my machine" variable entirely.
- **The "verified checkmark" is a rerun, not a promise**: submitters hand over run instructions and the SWE-bench team RE-EXECUTES the system on a random subset and checks results match. Human-in-the-loop, at submission time.
- **Pre-Docker, the multiple-harness trap was live**: third-party reimplementations (e.g. https://github.com/aorwall/SWE-bench-docker) existed precisely because the official conda harness was irreproducible; divergent verdicts across harnesses were the norm until official containerization subsumed them.
- **Even THE harness's verdict is only as good as its oracle**: UTBoost (https://arxiv.org/abs/2506.09289) generated augmented tests and found **36 instances with insufficient coverage; 345 leaderboard patches marked "resolved" that actually fail correct behavior; 18 and 11 ranking changes on Lite and Verified (affecting 40.9% and 24.4% of entries)**. For Verified, 26/500 instances got augmented tests, exposing **15.7% more incorrect patches** across all submissions (https://medium.com/@danieldkang/swe-bench-verified-is-flawed-despite-expert-review-utboost-exposes-gaps-in-test-coverage-4b75c6b940c6).
- **OpenAI's Feb 2026 retirement of Verified** doubles as the largest official-verdict discrepancy report: auditing the 27.6% hardest subset, **>=59.4% of audited problems have flawed tests that reject functionally correct solutions**; combined with training contamination, OpenAI stopped reporting Verified and recommends SWE-bench Pro (https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/, https://tessl.io/blog/openai-moves-beyond-swe-bench-verified-as-coding-benchmarks-saturate).
- **Scaffold != harness, and it dominates**: independent evals show the same model spanning **50.2%-55.4%** on SWE-bench Pro across three agent scaffolds; scaffold choice worth **11-15 points** (one model 62.3%->70.2% on Verified by scaffold alone) (https://futureagi.com/blog/coding-agent-harness-benchmark/, https://epoch.ai/blog/what-skills-does-swe-bench-verified-evaluate). Single-harness discipline pins the *verdict function*; serious leaderboards additionally pin or disclose the *scaffold* because it is the bigger score lever.
