# CentralGauge Agent Sandbox Entrypoint
#
# This script configures and runs the Claude Code agent in headless mode.
# It sets up MCP server connectivity and handles cleanup on exit.
#
# Environment Variables:
#   MCP_SERVER_URL - URL of the MCP server (e.g., http://host.docker.internal:3100)
#   ANTHROPIC_API_KEY - API key for Anthropic (required)
#   AGENT_PROMPT_FILE - Path to file containing the prompt (preferred over AGENT_PROMPT)
#   AGENT_PROMPT - The prompt to execute (optional, can be passed as argument)
#   AGENT_MAX_TURNS - Maximum turns for the agent (default: 500)
#   AGENT_TIMEOUT_MS - Timeout in milliseconds (default: 300000)

param(
    [int]$MaxTurns = $(if ($env:AGENT_MAX_TURNS) { [int]$env:AGENT_MAX_TURNS } else { 500 }),
    [int]$TimeoutMs = $(if ($env:AGENT_TIMEOUT_MS) { [int]$env:AGENT_TIMEOUT_MS } else { 300000 })
)

# Load prompt from file if specified, otherwise use environment variable
$Prompt = ""
if ($env:AGENT_PROMPT_FILE -and (Test-Path $env:AGENT_PROMPT_FILE)) {
    $Prompt = Get-Content -Path $env:AGENT_PROMPT_FILE -Raw
    Write-Host "[Sandbox] Loaded prompt from file: $env:AGENT_PROMPT_FILE" -ForegroundColor Gray
} elseif ($env:AGENT_PROMPT) {
    $Prompt = $env:AGENT_PROMPT
}

# Error handling
$ErrorActionPreference = "Stop"

Write-Host "[Sandbox] CentralGauge Agent Sandbox starting..." -ForegroundColor Cyan
Write-Host "[Sandbox] Working directory: $(Get-Location)" -ForegroundColor Gray

# Load the API key from the read-only secrets mount when present (M6).
# The key is no longer passed via docker -e, which exposed it on the docker
# argv and in `docker inspect` output.
$secretsKeyFile = "C:\cg-secrets\api-key"
if (Test-Path $secretsKeyFile) {
    $env:ANTHROPIC_API_KEY = (Get-Content -Path $secretsKeyFile -Raw).Trim()
    Write-Host "[Sandbox] Loaded API key from secrets mount" -ForegroundColor Gray
}

# Check for required environment variables
if (-not $env:ANTHROPIC_API_KEY) {
    Write-Host "[Sandbox] ERROR: ANTHROPIC_API_KEY is required (secrets mount C:\cg-secrets\api-key or environment variable)" -ForegroundColor Red
    exit 1
}

if (-not $env:MCP_SERVER_URL) {
    Write-Host "[Sandbox] WARNING: MCP_SERVER_URL not set, using default http://host.docker.internal:3100" -ForegroundColor Yellow
    $env:MCP_SERVER_URL = "http://host.docker.internal:3100"
}

Write-Host "[Sandbox] MCP Server: $env:MCP_SERVER_URL" -ForegroundColor Gray

# Wait for MCP server to be available
$maxRetries = 30
$retryCount = 0
$mcpHealthUrl = "$($env:MCP_SERVER_URL)/health"

Write-Host "[Sandbox] Waiting for MCP server at $mcpHealthUrl..." -ForegroundColor Gray

while ($retryCount -lt $maxRetries) {
    try {
        $response = Invoke-WebRequest -Uri $mcpHealthUrl -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            Write-Host "[Sandbox] MCP server is ready" -ForegroundColor Green
            break
        }
    }
    catch {
        # Server not ready yet
    }

    $retryCount++
    if ($retryCount -ge $maxRetries) {
        Write-Host "[Sandbox] ERROR: MCP server not available after $maxRetries attempts" -ForegroundColor Red
        exit 1
    }

    Start-Sleep -Seconds 1
}

# Configure Claude Code MCP settings
# Create .mcp.json in workspace directory (project scope)
# URL must include the /mcp endpoint for JSON-RPC
$mcpUrl = "$($env:MCP_SERVER_URL)/mcp"
$alToolsServer = @{
    "type" = "http"
    "url" = $mcpUrl
}
# Per-run bearer token (M3) — the MCP server 401s every non-/health request
# without it
if ($env:MCP_AUTH_TOKEN) {
    $alToolsServer["headers"] = @{
        "Authorization" = "Bearer $($env:MCP_AUTH_TOKEN)"
    }
}
$mcpConfig = @{
    "mcpServers" = @{
        "al-tools" = $alToolsServer
    }
}

$mcpJsonPath = Join-Path (Get-Location) ".mcp.json"
$mcpConfig | ConvertTo-Json -Depth 10 | Set-Content -Path $mcpJsonPath
Write-Host "[Sandbox] MCP config written to $mcpJsonPath" -ForegroundColor Gray

# Create .claude/settings.json to enable project MCP servers
$claudeDir = Join-Path (Get-Location) ".claude"
New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null

$settings = @{
    "enableAllProjectMcpServers" = $true
}

$settingsPath = Join-Path $claudeDir "settings.json"
$settings | ConvertTo-Json -Depth 10 | Set-Content -Path $settingsPath
Write-Host "[Sandbox] Claude settings written to $settingsPath" -ForegroundColor Gray

# If no prompt provided, just keep container running (useful for debugging)
if (-not $Prompt) {
    Write-Host "[Sandbox] No prompt provided, container ready for interactive use" -ForegroundColor Yellow
    Write-Host "[Sandbox] Run 'claude' to start Claude Code interactively" -ForegroundColor Yellow

    # Keep container running
    while ($true) {
        Start-Sleep -Seconds 60
    }
}

# Run Claude Code in headless/print mode
Write-Host "[Sandbox] Running Claude Code with prompt..." -ForegroundColor Cyan
Write-Host "[Sandbox] Max turns: $MaxTurns, Timeout: ${TimeoutMs}ms" -ForegroundColor Gray

try {
    # Run Claude Code in headless mode
    # -p flag enables print/headless mode
    # --dangerously-skip-permissions allows autonomous operation

    # Find Claude Code CLI.js path directly
    # Note: Using node directly instead of wrapper scripts (.ps1/.cmd)
    # because PowerShell wrapper has issues with stdin piping
    $npmPrefix = npm config get prefix
    $cliJsPath = "$npmPrefix\node_modules\@anthropic-ai\claude-code\cli.js"

    if (-not (Test-Path $cliJsPath)) {
        Write-Host "[Sandbox] ERROR: Claude Code CLI not found at: $cliJsPath" -ForegroundColor Red
        Write-Host "[Sandbox] npm prefix: $npmPrefix" -ForegroundColor Yellow
        exit 1
    }

    Write-Host "[Sandbox] Running Claude Code from: $cliJsPath" -ForegroundColor Gray

    Write-Host "[Sandbox] Starting Claude Code agent..." -ForegroundColor Cyan
    Write-Host "[Sandbox] MCP config: $mcpJsonPath" -ForegroundColor Gray
    Write-Host "[Sandbox] MCP config contents:" -ForegroundColor Gray
    Get-Content $mcpJsonPath | Write-Host

    # Run task with MCP config
    Write-Host "[Sandbox] Running task..." -ForegroundColor Cyan
    Write-Host "[Sandbox] Prompt length: $($Prompt.Length) chars" -ForegroundColor Gray

    # Write prompt to temp file and pipe to Claude Code
    # This avoids all command-line escaping issues with complex multi-line prompts
    $promptTempFile = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllText($promptTempFile, $Prompt, [System.Text.Encoding]::UTF8)
    Write-Host "[Sandbox] Prompt written to: $promptTempFile" -ForegroundColor Gray

    try {
        # Pipe prompt from file to Claude Code with --print flag
        # Claude Code reads from stdin when prompt is piped
        # Use node directly to avoid PowerShell wrapper stdin issues
        Write-Host "[Sandbox] Piping prompt to Claude Code..." -ForegroundColor Gray

        # Debug: Log environment and timing
        Write-Host "[Sandbox] API key length: $($env:ANTHROPIC_API_KEY.Length)" -ForegroundColor DarkGray
        Write-Host "[Sandbox] Start time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff')" -ForegroundColor DarkGray

        # Direct execution - simpler approach without background job
        # The PowerShell job approach was causing issues with environment inheritance
        $cmdArgs = @(
            "--debug",
            "--dangerously-skip-permissions",
            "--mcp-config", $mcpJsonPath,
            "--max-turns", $MaxTurns,
            "--print"
        )
        Write-Host "[Sandbox] Command: node cli.js $($cmdArgs -join ' ')" -ForegroundColor DarkGray
        Write-Host "[Sandbox] Prompt file: $promptTempFile" -ForegroundColor DarkGray

        # Run Claude Code directly - pipe prompt from file
        # Don't capture output - let it stream directly
        Get-Content -Path $promptTempFile -Raw | & node $cliJsPath @cmdArgs
        $exitCode = $LASTEXITCODE

        Write-Host "[Sandbox] End time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff')" -ForegroundColor DarkGray
    }
    finally {
        # Clean up temp file
        if (Test-Path $promptTempFile) {
            Remove-Item $promptTempFile -Force -ErrorAction SilentlyContinue
        }
    }

    Write-Host "[Sandbox] Claude Code exited with code: $exitCode" -ForegroundColor $(if ($exitCode -eq 0) { "Green" } else { "Red" })
    exit $exitCode
}
catch {
    Write-Host "[Sandbox] ERROR: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
finally {
    # Cleanup
    if ($mcpJsonPath -and (Test-Path $mcpJsonPath)) {
        Remove-Item $mcpJsonPath -Force -ErrorAction SilentlyContinue
    }
    Write-Host "[Sandbox] Cleanup complete" -ForegroundColor Gray
}
