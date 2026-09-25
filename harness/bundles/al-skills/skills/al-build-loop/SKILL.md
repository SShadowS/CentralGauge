---
name: al-build-loop
description: Compile and test Business Central AL apps with the cg-al tool. Use whenever you change AL code and need to know whether it builds and whether tests pass.
---

# AL build loop with cg-al

`cg-al` is the only way to build and run AL here. `compile`, `test` and `symbols`
each send at most one small request to a Business Central build server: app names, test
codeunit numbers or nothing, never files. The server reads the workspace itself.

## Usage

```
cg-al compile [App ...] | cg-al test [codeunit ...] | cg-al symbols | cg-al --version
```

- `cg-al compile` compiles every app in the workspace. `cg-al compile App1 App2` compiles the
  named app folders and the apps they depend on.
- `cg-al test` runs every runnable test codeunit of the Test app. `cg-al test <number> ...`
  runs only those codeunits; each argument must be a codeunit number.
- `cg-al symbols` asks the server for symbol information about the workspace.
- `cg-al --version` prints `{"cg_al":"1"}` and exits 0. It sends no request, so it says
  nothing about the server.

Run one cg-al command at a time; a second request while one is running is refused.

## Output of compile, test and symbols

Each prints one line of JSON:
`{"op": ..., "client": {"script_ms": ..., "status": ...}, "result": ...}`.
`client.status` is the HTTP status (0 when the server did not answer) and `result`
is what the server returned: `result.ok` says whether the operation succeeded, and
the rest holds compiler diagnostics per app or per-test outcomes. When the server
did not answer, `result` only holds an `error`.

Two cases print something else:

- The tool's own credentials are missing: `{"op": ..., "error": ...}`, exit 2.
- Bad arguments (an unknown operation, a test argument that is not a number): a usage
  message on stderr, no JSON, exit 64.

## Exit codes of compile, test and symbols

| Code | Meaning                                                                                                                                                                                                                                                                             | What to do                                              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 0    | HTTP 200 and `result.ok`                                                                                                                                                                                                                                                            | Move on.                                                |
| 1    | Your code or your request: HTTP 200 but not ok (compile errors, failing tests, violations), or a request the server refused (400 bad JSON, unknown app or codeunit that is not a runnable test; 404; 413 too large; 422 workspace over the limits; 429 a second concurrent request) | Read `result`, fix, run again.                          |
| 2    | The environment: no response, the tool's credentials unavailable, or any other HTTP status (408 and 5xx among them)                                                                                                                                                                 | Retry once. If it repeats, say so; it is not your code. |
| 3    | 401 unauthorized                                                                                                                                                                                                                                                                    | Stop and report it; you cannot fix it.                  |
| 64   | Usage error                                                                                                                                                                                                                                                                         | Fix the arguments.                                      |

## Loop

1. Make the smallest change that moves the task forward.
2. `cg-al compile` the app you changed. Fix every error before testing; warnings can wait.
   Read the diagnostics in full: the first error often causes the ones after it.
3. `cg-al test` the codeunits that cover the change, then the whole suite before you finish.
4. When a test fails, read its message and the code under test before editing. Do not
   change a test to make it pass unless the task asks you to change that test.
5. Finish only after a clean compile of every app and a passing full test run.

An error in an app that others depend on surfaces as missing symbols in every
app built on it: fix the base app first.
