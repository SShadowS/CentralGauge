# CentralGauge Documentation

> Modern LLM benchmark for Microsoft Dynamics 365 Business Central AL code

CentralGauge is an open-source benchmark suite for evaluating large language models (LLMs) on their ability to generate, debug, and refactor AL (Application Language) code for Microsoft Dynamics 365 Business Central.

## Table of Contents

### Getting Started

- [Overview](./overview.md) - What CentralGauge is and why it exists
- [Installation](./installation.md) - System requirements and setup
- [Quick Start](./quick-start.md) - Run your first benchmark in minutes

### User Guides

- [Running Benchmarks](./guides/running-benchmarks.md) - LLM and Agent benchmark execution
- [Understanding Results](./guides/understanding-results.md) - Interpreting benchmark output
- [Configuration](./guides/configuration.md) - Customizing CentralGauge behavior
- [Model Variants](./guides/model-variants.md) - Comparing models with different settings

### Task Authoring

- [Task Format](./tasks/task-format.md) - YAML manifest structure
- [Writing Tests](./tasks/writing-tests.md) - Creating AL test codeunits
- [Task Categories](./tasks/categories.md) - Easy, Medium, Hard classifications
- [Task Creation Guide](./tasks/task-creation-prompt.md) - Comprehensive guide for authoring new tasks

### Architecture

- [System Architecture](./architecture/overview.md) - Component design and data flow
- [LLM Adapters](./architecture/llm-adapters.md) - Provider integrations
- [Container Providers](./architecture/containers.md) - BC container management
- [Agent System](./architecture/agents.md) - Autonomous agent execution

### CLI Reference

- [Command Reference](./cli/commands.md) - All CLI commands and options
- [bench Command](./cli/bench.md) - Running benchmarks
- [report Command](./cli/report.md) - Generating reports
- [config Command](./cli/config.md) - Configuration management
- [rules Command](./cli/rules.md) - Generating rules from shortcomings

### API Reference

- [Module Index](./api/index.md) - Code organization
- [Core Types](./api/types.md) - TypeScript interfaces

### Contributing

- [Development Setup](./contributing/development.md) - Local environment
- [Testing Patterns](./contributing/testing.md) - Writing tests
- [Code Style](./contributing/style.md) - Conventions and practices

---

## Quick Links

| Resource                                                                          | Description                |
| --------------------------------------------------------------------------------- | -------------------------- |
| [GitHub Repository](https://github.com/SShadowS/CentralGauge)                     | Source code and issues     |
| [Example Tasks](https://github.com/SShadowS/CentralGauge/tree/master/tasks)       | Benchmark task definitions |
| [Benchmark Results](https://github.com/SShadowS/CentralGauge/tree/master/results) | Sample benchmark outputs   |

## License

CentralGauge is released under the MIT License. See [LICENSE](https://github.com/SShadowS/CentralGauge/blob/master/LICENSE) for details.
