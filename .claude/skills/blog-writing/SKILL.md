---
name: blog-writing
description: Style guide and conventions for writing CentralGauge blog posts. Use when creating or editing blog posts, devlogs, announcements, or any public-facing written content about CentralGauge benchmark results, updates, or findings. Ensures consistent voice, tone, and formatting across all posts.
---

# CentralGauge Blog Writing Style Guide

## Voice & Perspective

- **First person singular.** Always "I", never "we". CentralGauge is a single-person project.
- Write as the project author speaking directly to a technical audience.
- Example: "I audited each task and found..." not "We audited each task and found..."

## Tone

- **Professional but direct.** Not corporate, not casual. Think senior engineer writing a post-mortem.
- Be honest about mistakes and what was broken. Transparency builds credibility.
- Avoid hedging language ("perhaps", "it seems like", "it might be"). State findings directly.
- No hype or marketing speak. Let the data speak for itself.

## Formatting

- Use `---` horizontal rules to separate major sections.
- Bold key terms and task IDs on first mention in a section.
- Use tables for comparative data (rankings, before/after scores).
- Code references use backticks: `cleanCode()`, `Insert(true)`, `CG-AL-H002`.
- Keep paragraphs short (3-5 sentences max). Technical readers skim.

## Structure

1. **Title**: Descriptive, not clickbait. State what changed or what the post is about.
2. **Opening**: 2-3 paragraphs setting context. What was the situation, what changed, why does this post exist.
3. **Body sections**: Each with a clear heading. One topic per section.
4. **Data/Rankings**: Include tables when available. Show the numbers, don't just describe them.
5. **Closing**: What's next. Keep it brief, 1 short section.
6. **Sign-off**: End with a notable data point or cost figure in italics as a coda.

## Content Rules

- Always include specific task IDs (e.g., CG-AL-H002) when discussing fixes or results.
- When describing a bug fix, explain: what was broken, why it mattered, what the fix was.
- Attribute score changes to specific causes. Don't just say "scores improved."
- Include cost data when relevant. Benchmark economics matter to readers.
- Reference the GitHub repo at the end for readers who want to dig deeper.

## Things to Avoid

- Emojis. Never.
- "We" or "our team" or "the team." It's "I" and "my."
- Rhetorical questions as section headers.
- Filler phrases: "It's worth noting that", "Interestingly enough", "As you can see."
- Apologetic tone. Don't say "unfortunately" or "sadly." Just state what happened and what was fixed.
- Over-explaining what LLMs or Business Central are. The audience already knows.

## Project Links

- **GitHub**: https://github.com/SShadowS/CentralGauge (account: SShadowS)
- Always use this URL when linking to the repo in blog posts.

## Blog Location

- Blog posts live in `docs/blog/` as markdown files.
- Naming convention: `YYYY-MM-<slug>.md` (e.g., `2025-02-benchmark-update.md`).
