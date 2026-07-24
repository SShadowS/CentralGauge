# CentralGauge Project Overview

## Purpose
Open-source benchmark evaluating LLMs (and coding agents) on AL (Application
Language) code generation, debugging and refactoring for Microsoft Dynamics 365
Business Central. Two-attempt task execution with automated compilation and
testing inside isolated BC containers, plus a public scoreboard.

## Two halves of the repo
1. **Deno CLI + core library** (`cli/`, `src/`, `tasks/`, `tests/`, `mcp/`) —
   runs benchmarks against real BC containers.
2. **SvelteKit Cloudflare Worker scoreboard** (`site/`) — D1 + R2, deployed to
   https://ai.sshadows.dk (the workers.dev URL is internal-only, keep it out of
   public content). Bench results auto-ingest via `src/ingest/`.

## Tech Stack
- **Runtime**: Deno 2.x with TypeScript (all strict compiler options on)
- **CLI Framework**: Cliffy Command (`jsr:@cliffy/command@1.1.1`) — use it for
  argument parsing, never manual parseArgs
- **Validation**: zod v4
- **Container**: bccontainerhelper (pinned) + Windows BC containers
- **Manifests**: YAML 1.2 task definitions in `tasks/{easy,medium,hard}/`
- **Storage**: SQLite (`@db/sqlite`) locally, Cloudflare D1 + R2 in prod
- **Site**: SvelteKit + `adapter-cloudflare`, npm/vitest/Playwright toolchain
- **LLM SDKs**: `@anthropic-ai/sdk`, `@openai/openai`, `@google/genai`,
  `@openrouter/sdk`, plus `@anthropic-ai/claude-agent-sdk` for agent benches

## Environment
- Windows 11, Git Bash for shell commands, but Windows paths in tool calls
  (e.g. `U:\Git\CentralGauge\src\file.ts`)
- Local BC containers: `Cronus28`, `Cronus281`, `Cronus282`, `Cronus283`,
  `Cronus284`, `Cronus285` (credentials `sshadows` / `1234`). Use
  `--containers Cronus28,Cronus281` for parallel compile/test. Health check:
  `http://Cronus28/BC/?tenant=default`.
- `jq` available for JSON inspection.

## Where the real rules live
`CLAUDE.md` (root) is the authoritative operating manual and is always loaded.
Deep pattern docs sit in `.claude/rules/`: `error-handling.md`,
`registry-pattern.md`, `testing-patterns.md`, `async-generators.md`,
`prereq-apps.md`, `docker-sandbox.md`, `mcp-debug-logging.md`,
`detailed-error-output.md`, `soap-test-harness.md`,
`alert-drain-rebalance.md`.
See also `mem:codebase-structure`, `mem:suggested_commands`,
`mem:style-conventions`, `mem:task-completion`, `mem:bc-container-quirks`,
`mem:site-and-ingest`.
