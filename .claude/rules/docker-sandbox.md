# Docker Sandbox for Agent Execution

## Overview

CentralGauge runs AI agents (Claude Code) in isolated Windows Docker containers for reproducible benchmarking. The sandbox provides:

- Isolated execution environment
- MCP tool access via HTTP transport
- Path translation between container and host
- Automatic cleanup after execution

## Architecture

```
Host Machine                           Docker Container (Sandbox)
+---------------------------+          +---------------------------+
| CentralGauge CLI          |          | Windows Server Core 2025  |
| - agents run --sandbox    |          | - Node.js 20              |
|                           |          | - Git for Windows (bash)  |
| MCP HTTP Server           |          | - Claude Code CLI (npm)   |
| (port 3100)               |          | - entrypoint.ps1          |
|                           |          |                           |
| Path Translation:         |          | Agent workspace:          |
| C:\workspace → host path  | <-HTTP-> | C:\workspace              |
+---------------------------+          +---------------------------+
              |
              v
+---------------------------+
| BC Container (Cronus27)   |
| - AL Compiler             |
| - Test Runner             |
+---------------------------+
```

## Key Components

### 1. MCP HTTP Server

Located in `mcp/al-tools-server.ts`. Provides AL tools via HTTP JSON-RPC:

```bash
deno run --allow-all mcp/al-tools-server.ts \
  --http \
  --port 3100 \
  --workspace-map "C:\\workspace=/host/path/to/workspace"
```

**Critical: Workspace Mapping**

The `--workspace-map` argument translates container paths to host paths. Without this, MCP tool calls fail with "pipe is being closed (os error 232)".

Format: `CONTAINER_PATH=HOST_PATH`

### 2. Windows Container Image

Built from `docker/agent-sandbox/Dockerfile.windows`:

- Base: `mcr.microsoft.com/windows/servercore:ltsc2025`
- Includes: Node.js 20, PortableGit, jq, ripgrep, Claude Code CLI
- Entrypoint: `docker/agent-sandbox/entrypoint.ps1`

Build command:
```bash
cd docker/agent-sandbox
docker build -f Dockerfile.windows -t centralgauge/agent-sandbox:windows-latest .
```

### 3. Entrypoint Script

`docker/agent-sandbox/entrypoint.ps1` handles:

1. Loading prompt from `AGENT_PROMPT_FILE`
2. Waiting for MCP server to be ready
3. Creating `.mcp.json` config for Claude Code
4. Running Claude Code with `--dangerously-skip-permissions --print`
5. Cleanup on exit

### 4. Sandbox Provider

`src/sandbox/windows-provider.ts` manages container lifecycle:

- `create()` - Spawn container with mounted workspace
- `execStream()` - Execute commands with streamed output
- `destroy()` - Cleanup container

### 5. Agent Executor Integration

`src/agents/executor.ts` orchestrates sandbox execution:

1. Starts MCP HTTP server with workspace mapping
2. Creates container via WindowsSandboxProvider
3. Writes prompt to workspace file
4. Executes entrypoint and streams output
5. Detects success patterns in output
6. Cleans up MCP server and container

## Required Environment Variables

### Container Environment

| Variable | Description | Required |
|----------|-------------|----------|
| `ANTHROPIC_API_KEY` | Claude API key | Yes |
| `AGENT_PROMPT_FILE` | Path to prompt file in container | Yes |
| `MCP_SERVER_URL` | MCP server URL (e.g., `http://host.docker.internal:3100`) | Yes |
| `AGENT_MAX_TURNS` | Maximum agent turns | No (default: 500) |
| `AGENT_TIMEOUT_MS` | Timeout in milliseconds | No (default: 300000) |
| `CLAUDE_CODE_GIT_BASH_PATH` | Path to bash.exe in container | No (default: `C:\Git\bin\bash.exe`) |

### Host Environment

The `.env` file must contain API keys. The CLI loads this automatically via `EnvLoader.loadEnvironment()`.

For manual testing, source the file first:
```bash
source .env
```

## MCP Configuration

Claude Code discovers MCP servers via `.mcp.json` in the workspace:

```json
{
  "mcpServers": {
    "al-tools": {
      "type": "http",
      "url": "http://host.docker.internal:3100/mcp"
    }
  }
}
```

**Important:** URL must end with `/mcp` for JSON-RPC endpoint.

The entrypoint creates this file automatically based on `MCP_SERVER_URL`.

## Success Detection

The executor detects success from container output patterns:

**For tasks requiring tests:**
- `"all tests passed"`
- `"tests passed!"`
- `"X/X passed"` (where both numbers match)
- `"task completed successfully"`

**For compile-only tasks:**
- `"compilation successful"`
- `"compilation: **success**"`
- `"task completed successfully"`

## Manual Testing Setup

When debugging outside the executor:

```bash
# 1. Source environment
source .env

# 2. Start MCP server with workspace mapping
deno run --allow-all mcp/al-tools-server.ts \
  --http --port 3100 \
  --workspace-map "C:\\workspace=U:\\Git\\CentralGauge\\results\\test-workspace"

# 3. Create workspace and prompt
mkdir -p results/test-workspace
echo "Your prompt here" > results/test-workspace/.agent-prompt.txt

# 4. Create container
docker run -d --name test-container \
  -e "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY" \
  -e "AGENT_PROMPT_FILE=C:\\workspace\\.agent-prompt.txt" \
  -e "MCP_SERVER_URL=http://host.docker.internal:3100" \
  -e "AGENT_MAX_TURNS=10" \
  -e "CLAUDE_CODE_GIT_BASH_PATH=C:\\Git\\bin\\bash.exe" \
  -v "U:/Git/CentralGauge/results/test-workspace:C:/workspace" \
  centralgauge/agent-sandbox:windows-latest \
  powershell -Command "while (\$true) { Start-Sleep -Seconds 60 }"

# 5. Run entrypoint
docker exec test-container powershell -File 'C:\entrypoint.ps1' 2>&1

# 6. Cleanup
docker rm -f test-container
pkill -f "al-tools-server"
```

## Common Issues

### 1. "pipe is being closed (os error 232)"

**Cause:** MCP server started without workspace mapping.

**Fix:** Start MCP server with `--workspace-map` matching the container mount:
```bash
--workspace-map "C:\\workspace=/host/path"
```

### 2. Container times out with no Claude Code output

**Causes:**
- `ANTHROPIC_API_KEY` not set or empty
- API connectivity issues from container
- Prompt too complex for max turns

**Debug:**
```bash
# Check API key in container
docker exec CONTAINER powershell -Command "Get-ChildItem Env:" | grep ANTHROPIC

# Test simple prompt first
echo "Say hello" > workspace/.agent-prompt.txt
```

### 3. "MCP server not available" errors

**Cause:** MCP server not running or wrong port.

**Fix:** Verify server is running:
```bash
curl http://localhost:3100/health
```

### 4. Files not found during compilation

**Cause:** Files created in subdirectory instead of workspace root.

**Fix:** Ensure prompt instructs agent to create files directly in `C:\workspace`, not subdirectories.

### 5. DNS resolution failures in container

**Fix:** Configure Docker daemon with DNS:
```json
// C:\ProgramData\Docker\config\daemon.json
{
  "dns": ["1.1.1.1", "8.8.8.8"]
}
```

## Source Files

| File | Purpose |
|------|---------|
| `docker/agent-sandbox/Dockerfile.windows` | Container image definition |
| `docker/agent-sandbox/entrypoint.ps1` | Container startup script |
| `mcp/al-tools-server.ts` | MCP HTTP server with path translation |
| `src/sandbox/windows-provider.ts` | Container lifecycle management |
| `src/sandbox/types.ts` | Sandbox interfaces |
| `src/agents/executor.ts` | Agent execution with sandbox support |

## Related Documentation

- `prereq-apps.md` - Task dependencies and prereq handling
- `dockerstatus.md` - Implementation status and debugging notes
