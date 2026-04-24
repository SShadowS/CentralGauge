# config Command

The `config` command manages CentralGauge configuration.

## Synopsis

```bash
centralgauge config <subcommand>
```

## Subcommands

### config init

Creates a sample configuration file in the current directory.

```bash
centralgauge config init
```

This creates `.centralgauge.yml` with documented defaults and examples.

**Output:**

```
Created .centralgauge.yml with sample configuration.
Edit this file to customize CentralGauge settings.
```

### config show

Displays the effective configuration after merging all sources.

```bash
centralgauge config show
```

Shows merged configuration from:

1. CLI arguments
2. Environment variables
3. Local config file
4. Home directory config
5. Built-in defaults

**Example output:**

```yaml
# Effective Configuration

defaultModels:
  benchmark:
    - sonnet
    - gpt-4o
  development:
    - mock

llm:
  temperature: 0.1
  maxTokens: 4000
  timeout: 30000

container:
  provider: bccontainer
  name: Cronus28
  bcVersion: "27.0"

# Sources:
# - .centralgauge.yml (local)
# - Environment variables
# - Built-in defaults
```

### config validate

Validates the configuration file.

```bash
centralgauge config validate
```

Checks:

- YAML syntax
- Required fields
- Valid values
- File paths exist

**Example output:**

```
Validating .centralgauge.yml...

[OK] YAML syntax valid
[OK] All required fields present
[WARN] Container 'TestContainer' not found (may need to create)
[OK] Template directory exists

Configuration is valid with 1 warning(s).
```

## Configuration File

### Default Location

CentralGauge looks for configuration in:

1. `.centralgauge.yml` (current directory)
2. `~/.centralgauge.yml` (home directory)

### Sample Configuration

```yaml
# Default models for different scenarios
defaultModels:
  benchmark: [sonnet, gpt-4o]
  development: [mock]
  comparison: [flagship]

# LLM provider settings
llm:
  temperature: 0.1
  maxTokens: 4000
  timeout: 30000

# Benchmark settings
benchmark:
  attempts: 2
  outputDir: results
  templateDir: templates

# Container settings
container:
  provider: bccontainer
  name: Cronus28
  bcVersion: "27.0"
  credentials:
    username: admin
    password: admin

# System prompts for variants
systemPrompts:
  strict-al:
    content: |
      You are a strict AL code generator.
      Only output valid AL code.

# Variant profiles
variantProfiles:
  conservative:
    config:
      temperature: 0.1
      maxTokens: 4000

# Ingest credentials (usually kept only in ~/.centralgauge.yml, never committed)
ingest:
  url: https://centralgauge.sshadows.workers.dev
  key_path: ~/.centralgauge/keys/production-ingest.ed25519
  key_id: 1
  machine_id: production-ingest
  admin_key_path: ~/.centralgauge/keys/production-admin.ed25519
  admin_key_id: 2
```

### Ingest Configuration

The `ingest:` block holds the credentials used by `bench` (auto-ingest),
`centralgauge ingest`, and `centralgauge sync-catalog` to POST to the
scoreboard API.

| Field            | Required              | Description                                             |
| ---------------- | --------------------- | ------------------------------------------------------- |
| `url`            | yes                   | Scoreboard worker URL                                   |
| `key_path`       | yes                   | Path to 32-byte Ed25519 private-key file (ingest scope) |
| `key_id`         | yes                   | `machine_keys.id` assigned at seed time                 |
| `machine_id`     | yes                   | Human-readable label stored with each run               |
| `admin_key_path` | only for sync-catalog | Admin-scope private key for catalog writes              |
| `admin_key_id`   | only for sync-catalog | Admin-scope key id                                      |

Keep the `ingest:` block in `~/.centralgauge.yml` (home directory) so secrets
never land in the repo. The project-root `.centralgauge.yml` is for shared
defaults only — it is committed to git. Fields from the home file fall
through into the merged config whenever the cwd file does not override them.

See the [Production Ingest guide](../guides/production-ingest.md) for the
full setup walkthrough (key generation, admin seeding, first-bench flow).

## Environment Variables

Configuration can be overridden via environment variables:

```bash
CENTRALGAUGE_TEMPERATURE=0.2
CENTRALGAUGE_MAX_TOKENS=8000
CENTRALGAUGE_CONTAINER_NAME=MyContainer
CENTRALGAUGE_DEBUG=true
```

## Priority Order

Configuration sources (highest priority first):

1. **CLI arguments** - `--temperature 0.3`
2. **Environment variables** - `CENTRALGAUGE_TEMPERATURE=0.3`
3. **Local config** - `.centralgauge.yml`
4. **Home config** - `~/.centralgauge.yml`
5. **Defaults** - Built-in values

## See Also

- [Configuration Guide](../guides/configuration.md) - Full configuration reference
- [Model Variants](../guides/model-variants.md) - Variant configuration
- [Running Benchmarks](../guides/running-benchmarks.md) - Using configuration
