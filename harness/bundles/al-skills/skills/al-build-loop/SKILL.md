---
name: al-build-loop
description: Compile and test Business Central AL apps with the cg-al tool. Use whenever you change AL code and need to know whether it builds and whether tests pass.
---

# AL build loop with cg-al

`cg-al` is the only way to build and run AL here. It sends the workspace to a
Business Central server and prints one line of JSON.

## Commands

- `cg-al compile` compiles the apps in the workspace; `cg-al compile App1 App2` names app folders.
- `cg-al test` runs every test codeunit; `cg-al test 50100 50101` runs only those codeunit numbers.
- `cg-al symbols` asks the server for symbol information about the workspace.
- `cg-al --version` prints the tool version.

## Reading the output

The JSON has three parts: `op` (the command), `client` (`status` is the HTTP
status, `script_ms` the wall time) and `result` (what the server returned).
`result.ok` tells you whether the operation succeeded; the rest of `result`
holds the compiler diagnostics or the per-test outcomes. Read the diagnostics
in full: the first error often causes the ones after it.

## Exit codes

| Code | Meaning                                                                                                                                                                                | What to do                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 0    | Success                                                                                                                                                                                | Move on.                                                             |
| 1    | Your code or your request: compile errors, failing tests, an unknown app name, a codeunit that is not a runnable test, a workspace too large, or a second request while one is running | Read `result`, fix, run again. Never run two cg-al commands at once. |
| 2    | The environment failed (no response, timeout, server error)                                                                                                                            | Retry once. If it repeats, say so; it is not your code.              |
| 3    | Unauthorized                                                                                                                                                                           | Stop and report it; you cannot fix it.                               |
| 64   | Bad arguments                                                                                                                                                                          | Check the usage above.                                               |

## Loop

1. Make the smallest change that moves the task forward.
2. `cg-al compile` the app you changed. Fix every error before testing; warnings can wait.
3. `cg-al test` the codeunits that cover the change, then the whole suite before you finish.
4. When a test fails, read its message and the code under test before editing. Do not
   change a test to make it pass unless the task asks you to change that test.
5. Finish only after a clean compile of every app and a passing full test run.

Compile the app that others depend on first: an error in a base app surfaces as
missing symbols in every app built on it.
