# CentralGauge Project Overview

## Purpose
CentralGauge is an open-source benchmark for evaluating LLMs on AL (Application Language) code generation, debugging, and refactoring for Microsoft Dynamics 365 Business Central. The system provides two-attempt task execution with automated compilation and testing inside isolated BC containers.

## Tech Stack
- **Runtime**: Deno 1.44+ with TypeScript 5 (strict mode)
- **CLI Framework**: Cliffy Command (jsr:@cliffy/command@1.0.0-rc.8)
- **Container**: bccontainerhelper + Windows NanoServer LCOW
- **Manifest Format**: YAML 1.2 for task definitions
- **Database**: SQLite (@db/sqlite) for stats storage
- **Reports**: JSON (machine-readable) and HTML (human-readable)
- **LLM SDKs**: Anthropic, OpenAI, Google GenAI, OpenRouter

## Key Dependencies
- `@anthropic-ai/sdk` - Anthropic Claude API
- `@anthropic-ai/claude-agent-sdk` - Claude Agent SDK
- `@openai/openai` - OpenAI API
- `@google/genai` - Google Gemini API
- `@openrouter/sdk` - OpenRouter API
- `@cliffy/prompt` - Interactive CLI prompts
- `@std/yaml` - YAML parsing
- `@std/fmt` - Colored output (chalk-style)

## Environment
- Developed on Windows with Git Bash
- Uses Windows paths in tool calls (e.g., `U:\Git\CentralGauge\src\file.ts`)
- Local BC Container: `Cronus27` with credentials `sshadows` / `1234`
