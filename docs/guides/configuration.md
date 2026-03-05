# Configuration

CentralGauge uses a layered configuration system that merges settings from multiple sources.

## Configuration Sources (Priority Order)

1. **CLI arguments** (highest priority)
2. **Environment variables**
3. `.centralgauge.yml` in current directory
4. `.centralgauge.yml` in home directory
5. **Built-in defaults** (lowest priority)

Higher-priority sources override lower-priority ones.

## Configuration File

### Creating a Configuration File

Generate a sample configuration file:

```bash
deno run --allow-all cli/centralgauge.ts config init
```

This creates `.centralgauge.yml` in your current directory.

### Full Configuration Reference

```yaml
# .centralgauge.yml

# Default models for different scenarios
defaultModels:
  benchmark: [sonnet, gpt-4o] # Models for production benchmarks
  development: [mock] # Models for development/testing
  comparison: [flagship] # Models for side-by-side comparison

# LLM provider settings
llm:
  temperature: 0.1 # Lower = more deterministic
  maxTokens: 4000 # Maximum response length
  timeout: 30000 # Request timeout in milliseconds

# Benchmark execution settings
benchmark:
  attempts: 2 # Number of attempts per task
  outputDir: results # Directory for benchmark results
  templateDir: templates # Directory for prompt templates

# Container settings
container:
  provider: bccontainer # Container provider (mock, bccontainer, docker)
  name: Cronus28 # Container name
  bcVersion: "24.0" # Business Central version
  memoryLimit: 8G # Container memory limit
  credentials:
    username: admin # Container authentication username
    password: admin # Container authentication password

# Debug settings
debug:
  enabled: false # Enable debug logging
  outputDir: debug # Debug output directory
  logLevel: basic # basic | detailed | verbose
  includeRawResponse: false # Include full API responses
  includeRequestHeaders: false # Include request headers
  maxFileSize: 100 # Max log file size in MB

# Named system prompts for model variants
systemPrompts:
  strict-al:
    content: |
      You are a strict AL code generator for Business Central.
      Only output valid AL code without explanations.
      Always use proper naming conventions.

  creative:
    content: |
      Think creatively about solutions while ensuring code compiles.
      Consider multiple approaches before choosing the best one.

# Named variant profiles for comparing same model with different configs
variantProfiles:
  conservative:
    description: "Low temperature for deterministic output"
    config:
      temperature: 0.1
      maxTokens: 4000

  creative:
    description: "Higher temperature for varied solutions"
    config:
      temperature: 0.8
      maxTokens: 8000
      systemPromptName: creative

  deep-thinking:
    description: "Extended reasoning for complex tasks"
    config:
      temperature: 0.2
      thinkingBudget: 50000

# Prompt injection configuration (advanced)
prompts:
  enabled: true
  injections:
    anthropic:
      default:
        prefix: ""
        suffix: "\n\nRemember to include proper error handling."
    openai:
      generation:
        prefix: "Important context: "
```

## Environment Variables

All settings can be overridden via environment variables using the `CENTRALGAUGE_` prefix:

### Model Settings

```bash
# Default models for scenarios
CENTRALGAUGE_BENCHMARK_MODELS=sonnet,gpt-4o
CENTRALGAUGE_DEV_MODELS=mock
CENTRALGAUGE_COMPARISON_MODELS=flagship
```

### LLM Settings

```bash
CENTRALGAUGE_TEMPERATURE=0.1
CENTRALGAUGE_MAX_TOKENS=4000
```

### Benchmark Settings

```bash
CENTRALGAUGE_ATTEMPTS=2
CENTRALGAUGE_OUTPUT_DIR=results
```

### Container Settings

```bash
CENTRALGAUGE_CONTAINER_PROVIDER=bccontainer
CENTRALGAUGE_CONTAINER_NAME=Cronus28
CENTRALGAUGE_CONTAINER_USERNAME=admin
CENTRALGAUGE_CONTAINER_PASSWORD=admin
```

### Debug Settings

```bash
CENTRALGAUGE_DEBUG=true
CENTRALGAUGE_DEBUG_OUTPUT_DIR=debug
CENTRALGAUGE_DEBUG_LOG_LEVEL=verbose
CENTRALGAUGE_DEBUG_INCLUDE_RAW=true
CENTRALGAUGE_DEBUG_INCLUDE_HEADERS=false
CENTRALGAUGE_DEBUG_MAX_FILE_SIZE=100
```

### API Keys

```bash
# Provider API keys (required)
ANTHROPIC_API_KEY=sk-ant-api03-...
OPENAI_API_KEY=sk-proj-...
GOOGLE_API_KEY=AIzaSy...
OPENROUTER_API_KEY=sk-or-v1-...

# Azure OpenAI
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
```

## CLI Overrides

Any configuration can be overridden via CLI arguments:

```bash
# Override temperature
deno task bench --llms sonnet --temperature 0.3

# Override output directory
deno task bench --llms sonnet --output my-results/

# Override attempts
deno task bench --llms sonnet --attempts 3

# Override container
deno task bench --llms sonnet --container MyContainer
```

## Container Configuration

### Using bccontainerhelper

The default and recommended provider for Windows:

```yaml
container:
  provider: bccontainer
  name: Cronus28
  bcVersion: "27.0"
  credentials:
    username: admin
    password: admin
```

### Using Docker Directly

For Linux or custom setups:

```yaml
container:
  provider: docker
  name: my-bc-container
```

### Using Mock Provider

For development and testing (no real container):

```yaml
container:
  provider: mock
  name: mock-container
```

## Variant Profiles

Define reusable model configurations:

```yaml
variantProfiles:
  conservative:
    description: "Low temperature for deterministic output"
    config:
      temperature: 0.1
      maxTokens: 4000

  extended-thinking:
    description: "Use extended thinking for complex tasks"
    config:
      thinkingBudget: 50000
      maxTokens: 16000
```

Use profiles in benchmarks:

```bash
deno task bench --llms "opus@profile=conservative,opus@profile=extended-thinking"
```

## System Prompts

Define named system prompts:

```yaml
systemPrompts:
  strict:
    content: |
      You are a strict AL code generator.
      Only output valid AL code in code blocks.
      No explanations or comments outside the code.
```

Use in benchmarks:

```bash
deno task bench --llms "sonnet@prompt=strict"
```

## Viewing Current Configuration

Display the effective configuration:

```bash
deno run --allow-all cli/centralgauge.ts config show
```

This shows the merged configuration from all sources.

## Configuration Validation

Validate your configuration file:

```bash
deno run --allow-all cli/centralgauge.ts config validate
```

## Best Practices

### Development vs Production

Use different configurations for development and production:

```yaml
# Development (in .centralgauge.yml)
defaultModels:
  development: [mock]

# Production (override via environment)
CENTRALGAUGE_BENCHMARK_MODELS=opus,gpt-5
```

### Secure Credentials

Never commit API keys to version control:

```bash
# Use .env file (git-ignored)
cp .env.example .env
echo ".env" >> .gitignore
```

### Container Credentials

Store container credentials securely:

```bash
# Environment variables (preferred)
CENTRALGAUGE_CONTAINER_USERNAME=admin
CENTRALGAUGE_CONTAINER_PASSWORD=$(cat /path/to/secure/password)
```

### Per-Project Configuration

Each project can have its own `.centralgauge.yml`:

```
my-project/
  .centralgauge.yml    # Project-specific settings
  tasks/               # Custom tasks
  templates/           # Custom templates
```

## Next Steps

- [Model Variants](./model-variants.md) - Advanced model configuration
- [Running Benchmarks](./running-benchmarks.md) - Benchmark execution
- [CLI Reference](../cli/commands.md) - All CLI options
