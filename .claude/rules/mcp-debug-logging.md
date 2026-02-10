# MCP Debug Logging

## Overview

The MCP server (`mcp/al-tools-server.ts`) includes comprehensive debug logging for diagnosing sandbox mode issues. Logs are written to `sandbox-debug.log` in the project root.

## Log File Location

```
U:\Git\CentralGauge\sandbox-debug.log
```

## Log Points

| Context | Message | Data Logged |
|---------|---------|-------------|
| `al_verify_task` | "Called with params" | projectDir, taskId, containerName |
| `al_verify_task` | "Path translation" | original path, translated path |
| `al_verify_task` | "Project root resolved" | projectRoot from script location |
| `al_verify_task` | "Test file resolution" | success/error, testFile path |
| `al_verify_task` | "Test codeunit ID loaded" | testCodeunitId from task YAML |
| `al_verify` | "Starting verification" | projectDir, testFile, testCodeunitId |
| `al_verify` | "Project directory lookup" | inputDir, found projectDir |
| `al_verify` | "Verify directory created" | verifyDir path |
| `al_verify` | "Source files copied" | (confirmation) |
| `al_verify` | "Test file copy result" | testFile, targetDir, success, message |
| `al_verify` | "Project built from verify dir" | path, sourceFiles count, testFiles count, testFileNames |
| `al_verify` | "Compilation result" | success, artifactPath, errorCount |
| `al_verify` | "Running tests" | containerName, extensionId, testCodeunitId, artifactPath |
| `al_verify` | "Test execution result" | success, totalTests, passedTests, failedTests, results |
| `al_verify` | "WARNING: Zero tests detected!" | rawOutputLength, rawOutputSample (first 2000 chars) |

## Common Issues to Check

### Test File Not Found
Look for:
```
[al_verify_task] FAILED: Test file not found
```

### No Test Files in Build
Look for:
```
"testFiles": 0
```

### Test Codeunit ID Missing
Look for:
```
"testCodeunitId": null
```

### Zero Tests Detected
Look for:
```
[al_verify] WARNING: Zero tests detected!
```
The `rawOutputSample` will show the PowerShell output from `Run-TestsInBcContainer`.

## How to Enable Logging

Logging is always active. The MCP server writes to `sandbox-debug.log` automatically during `al_verify_task` and `al_verify` operations.

## Clearing the Log

```bash
rm sandbox-debug.log  # Or delete manually
```

## Viewing the Log

```bash
cat sandbox-debug.log
# Or for real-time monitoring:
tail -f sandbox-debug.log
```

## Source File

- `mcp/al-tools-server.ts` - Contains the `debugLog()` function and all log points
