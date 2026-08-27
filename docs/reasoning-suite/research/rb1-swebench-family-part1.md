# SWE-bench Family: Task Construction & Validation Mechanisms (1/3)

## 1. SWE-bench (original, arXiv Oct 2023)

Source: https://arxiv.org/abs/2310.06770 (full text: https://arxiv.org/html/2310.06770v3)

### Mining pipeline (3 stages, all automated)

1. **Repo selection + scraping.** Top-100 most-downloaded PyPI packages (Aug 2023), license-checked, narrowed to 12 well-maintained Python repos with strong test coverage. ~**90,000 PRs** crawled. Final distribution heavily skewed: Django 850, SymPy 386, scikit-learn 229, Sphinx 187, Matplotlib 184, pytest 119, xarray 110, astropy 95, pylint 57, requests 44, seaborn 22, Flask 11.
2. **Attribute filtering** (metadata-only, automated): keep merged PRs that (a) resolve at least one GitHub issue AND (b) modify test files (proxy for "developer added a test verifying the fix"). ~90,000 -> **~11,407** candidates (~87% discarded).
3. **Execution filtering** (automated, expensive): build version-pinned conda env per repo version; check out base commit; apply the PR's *test patch* only; run tests and log; apply *gold patch*; re-run and diff logs. Requirements: at least one test flips fail->pass; no installation/runtime errors; discard instances whose tests reference symbols existing only in the gold patch (test would encode the developer's arbitrary naming, making the task unsolvable without the patch). ~11,407 -> **2,294** (~80% discarded here; authors state roughly 50% of candidates died specifically to installation/runtime failures).

### Test semantics

- **FAIL_TO_PASS (F2P)**: fail pre-patch, pass post-patch; proves resolution. Mean 9.1/instance (max 1,633).
- **PASS_TO_PASS (P2P)**: pass before and after; regression guard. Median ~51/instance.
- A patch "resolves" iff all F2P pass AND all P2P still pass.

### Validation properties

- Gold patch execution-validated per instance in the pinned env: automated, pre-release, one-shot.
- Env pinning = per repo-version conda spec. This was the weak point: harness flaky across machines, later replaced by Docker (see Verified).
- **No human review of issue quality or test fairness at all** in the original. That gap is what Verified, SWE-bench+, and UTBoost each later quantified.

## 2. SWE-bench Verified (OpenAI, Aug 2024)

Sources: https://openai.com/index/introducing-swe-bench-verified/ (mirror: https://github.com/irthomasthomas/undecidability/issues/933), https://www.swebench.com/verified.html

### Annotation campaign

- **93 professional Python developers**, annotating **1,699 random samples** of the 2,294-instance test set.
- **Each sample labeled by 3 separate annotators.**
- Two primary rubric criteria, each on a **0-3 severity scale** (0/1 = minor, 2/3 = severe = discard):
  1. **Underspecified issue text**: could a competent engineer produce the expected solution from the problem statement alone?
  2. **Unfair FAIL_TO_PASS tests**: would tests reject a perfectly valid solution (e.g., asserting an exact error-message string the issue never specifies)?
  Plus a catch-all "other major issues" flag (flaky env, broken setup) and a **difficulty estimate** (<15 min / 15 min-1 hr / 1-4 hr / >4 hr).
- **Ensembling**: conservative; a sample is filtered when the ensemble label on either criterion reaches severity >=2, designed so a severe flag from any of the 3 annotators removes the sample. Difficulty by majority vote, median tiebreak.
- **Flag rates**: **38.3%** flagged for underspecified problem statements, **61.1%** flagged for potentially unfair unit tests (severity >=1 flags). Overall **68.3% of annotated samples filtered** at severity >=2 on some criterion. Final **500** sampled from the surviving pool.
- Full raw annotations + rubric released publicly.

### Harness fix

OpenAI + SWE-bench authors rebuilt evaluation on **containerized Docker environments** because the original harness's env setup itself produced false verdicts.

### Measured effect

GPT-4o: 16% (original) -> **33.2%** (Verified). Roughly half the apparent "failure" on the original was task/harness defect, not model incapability.

### Verified's own demise (Feb 2026)

OpenAI stopped reporting Verified: https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/ (coverage: https://tessl.io/blog/openai-moves-beyond-swe-bench-verified-as-coding-benchmarks-saturate, https://www.latent.space/p/swe-bench-dead). In an audit of the ~27.6% hardest (frequently-unsolved) subset, **at least 59.4% of audited problems had flawed test cases rejecting functionally correct submissions**: the residual unsolved head is dominated by label noise, so frontier gains near the ceiling measured noise. Second reason: contamination (the 12 repos + release notes are in every pretraining corpus). Lesson: a single pre-release human pass decays; the *unsolved residue* needs re-auditing as scores climb, because defective instances concentrate there.
