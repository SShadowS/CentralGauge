# CentralGauge Codebase Structure

## Root Directory
```
CentralGauge/
├── cli/              # CLI application
├── src/              # Core library code
├── tasks/            # Benchmark task definitions (YAML)
├── tests/            # Test files
├── mcp/              # MCP server implementations
├── agents/           # Agent configurations
├── fixtures/         # Test fixtures
├── results/          # Benchmark results (SQLite DB)
├── reports-output/   # Generated HTML reports
├── main.ts           # Entry point
└── deno.json         # Deno configuration
```

## CLI Structure (`cli/`)
```
cli/
├── centralgauge.ts   # Main CLI entry point
├── commands/         # Cliffy command handlers
│   ├── bench-command.ts       # Run benchmarks
│   ├── report-command.ts      # File-based reports
│   ├── report-db-command.ts   # Database-based reports
│   ├── stats-import-command.ts # Import results to DB
│   └── ...
├── helpers/          # Shared CLI utilities
│   ├── task-loader.ts         # Load task manifests
│   ├── report-generator.ts    # HTML report generation
│   └── ...
├── services/         # CLI services
└── types/            # CLI-specific types
```

## Source Structure (`src/`)
```
src/
├── agents/           # Agent execution logic
├── compiler/         # AL compilation utilities
├── config/           # Configuration management
├── container/        # BC container providers
│   ├── interface.ts           # ContainerProvider interface
│   ├── bc-container-provider.ts # Real BC container
│   ├── docker-container-provider.ts
│   └── mock-provider.ts       # For testing
├── llm/              # LLM adapters
│   ├── interface.ts           # LLMAdapter interface
│   ├── anthropic-adapter.ts
│   ├── openai-adapter.ts
│   └── ...
├── parallel/         # Parallel execution orchestration
├── prompts/          # Prompt templates
├── stats/            # Statistics and storage
│   ├── hasher.ts              # Hash generation for tasks
│   ├── sqlite-storage.ts      # Database storage
│   ├── schema.ts              # Database schema
│   └── importer.ts            # Import logic
├── tasks/            # Task execution
├── templates/        # Report templates
├── utils/            # General utilities
└── verify/           # Verification logic
```

## Test Structure (`tests/`)
```
tests/
├── unit/             # Unit tests
├── integration/      # Integration tests
├── e2e/              # End-to-end tests
├── al/               # AL test files for benchmarks
│   ├── easy/         # Easy task tests
│   ├── medium/       # Medium task tests
│   ├── hard/         # Hard task tests
│   └── dependencies/ # Prereq apps for tasks
└── utils/            # Test helpers
```

## Task Definitions (`tasks/`)
```
tasks/
├── easy/             # Easy difficulty tasks
├── medium/           # Medium difficulty tasks
└── hard/             # Hard difficulty tasks
```
Each task is a YAML file with task ID, description, and requirements.
