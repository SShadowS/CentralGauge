# Installation

## System Requirements

### Required

| Requirement       | Version         | Notes                      |
| ----------------- | --------------- | -------------------------- |
| Deno              | 1.44+           | Runtime for CentralGauge   |
| Windows           | 10/11 or Server | Required for BC containers |
| Docker Desktop    | Latest          | For container management   |
| bccontainerhelper | Latest          | PowerShell module for BC   |

### Optional

| Requirement        | Notes                        |
| ------------------ | ---------------------------- |
| Git Bash           | Recommended shell on Windows |
| jq                 | For inspecting JSON files    |
| Visual Studio Code | For AL development           |

## Step 1: Install Deno

### Windows (PowerShell)

```powershell
irm https://deno.land/install.ps1 | iex
```

### Windows (Scoop)

```bash
scoop install deno
```

### Linux/macOS

```bash
curl -fsSL https://deno.land/x/install/install.sh | sh
```

Verify installation:

```bash
deno --version
# deno 1.44.0 (release, x86_64-pc-windows-msvc)
# v8 12.4.254.13
# typescript 5.4.5
```

## Step 2: Install Docker Desktop

Download and install Docker Desktop from [docker.com](https://www.docker.com/products/docker-desktop/).

After installation, ensure Windows containers are enabled:

1. Right-click the Docker icon in the system tray
2. Select "Switch to Windows containers..."
3. Wait for Docker to restart

Verify Docker is running:

```bash
docker --version
# Docker version 24.0.0, build ...
```

## Step 3: Install bccontainerhelper

Open PowerShell as Administrator and run:

```powershell
Install-Module -Name bccontainerhelper -Force
```

Verify installation:

```powershell
Get-Module -ListAvailable bccontainerhelper
```

## Step 4: Clone CentralGauge

```bash
git clone https://github.com/SShadowS/CentralGauge.git
cd CentralGauge
```

## Step 5: Configure API Keys

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and add your API keys:

```bash
# Anthropic (Claude)
ANTHROPIC_API_KEY=sk-ant-api03-...

# OpenAI (GPT)
OPENAI_API_KEY=sk-proj-...

# Google (Gemini)
GOOGLE_API_KEY=AIzaSy...

# OpenRouter (optional, for 200+ models)
OPENROUTER_API_KEY=sk-or-v1-...

# Azure OpenAI (optional)
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
```

You only need to configure the providers you plan to use.

## Step 6: Create a BC Container

CentralGauge requires a Business Central container with the Test Toolkit installed. Create one using bccontainerhelper:

```powershell
# Create credential for container access
$cred = New-Object PSCredential 'admin', (ConvertTo-SecureString 'admin' -AsPlainText -Force)

# Create BC27 container with test toolkit
New-BcContainer `
    -containerName Cronus27 `
    -credential $cred `
    -artifactUrl (Get-BCArtifactUrl -country us -version 27) `
    -includeTestToolkit
```

This process takes 10-30 minutes depending on your internet connection and hardware.

Verify the container is running:

```powershell
docker ps
# CONTAINER ID   IMAGE                    STATUS         NAMES
# abc123...      mcr.microsoft.com/...    Up 2 hours     Cronus27
```

## Step 7: Configure CentralGauge

Create a configuration file (optional but recommended):

```bash
deno run --allow-all cli/centralgauge.ts config init
```

This creates `.centralgauge.yml` with sensible defaults. Edit it to match your container:

```yaml
container:
  provider: bccontainer
  name: Cronus27
  credentials:
    username: admin
    password: admin
```

## Step 8: Verify Installation

Run the built-in verification:

```bash
deno task start
```

You should see a splash screen showing:

- Environment variables loaded
- Configuration file found
- Available providers listed
- Container connection status

Run a quick test with the mock provider (no LLM API required):

```bash
deno task bench --llms mock --tasks tasks/easy/CG-AL-E001*.yml
```

## Troubleshooting

### "Container not found" Errors

Ensure your container is running:

```powershell
docker ps
docker start Cronus27
```

### "API key not set" Errors

Verify your `.env` file is loaded:

```bash
source .env  # Git Bash
echo $ANTHROPIC_API_KEY
```

### Docker Permission Errors

On Windows, ensure Docker Desktop is running and you have Windows containers enabled.

### bccontainerhelper Not Found

Ensure you installed it in an Administrator PowerShell session:

```powershell
Import-Module bccontainerhelper
```

### Rate Limit Errors

Add rate limiting configuration:

```yaml
# .centralgauge.yml
llm:
  timeout: 60000 # Increase timeout to 60s
```

## Next Steps

- [Quick Start](./quick-start.md) - Run your first benchmark
- [Configuration](./guides/configuration.md) - Customize settings
- [Running Benchmarks](./guides/running-benchmarks.md) - Full benchmark guide
