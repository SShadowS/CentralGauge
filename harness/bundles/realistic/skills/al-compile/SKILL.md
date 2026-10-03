---
name: al-compile
description: Compile the AL apps in the workspace with cg-al and read the result. Use after every AL change, before running tests.
---

# Compiling with cg-al

`cg-al` is the only way to build AL here. Each command sends one small request to
a Business Central build server: app names, test codeunit numbers or nothing,
never files. The server reads the workspace itself.

## Usage

```
cg-al compile [App ...] | cg-al test [codeunit ...] | cg-al symbols | cg-al --version
```

- `cg-al compile` compiles every app in the workspace.
- `cg-al compile App1 App2` compiles the named app folders and the apps they
  depend on. Use the folder name of the app, as it appears under `C:\workspace`.
- `cg-al --version` prints the tool version and exits 0. It sends no request, so
  it says nothing about the server.

Run one cg-al command at a time. A second request while one is running is
refused.

## Reading the output

`compile`, `test` and `symbols` print one line of JSON:
`{"op": ..., "client": {"script_ms": ..., "status": ...}, "result": ...}`.

- `client.status` is the HTTP status, 0 when the server did not answer.
- `result.ok` says whether the compile succeeded.
- `result.apps` has one entry per app it built: the app folder, its own `ok`,
  and its `diagnostics`, each with file, line, column, code, severity and
  message. A workspace the server refuses to build lists the reasons under
  `result.violations` instead.
- When the server refused the request or did not answer, `result` holds an
  `error` instead, and no `ok`. A fault on the server side holds an `infra`
  message instead.

Two cases print something else:

- The tool's own credentials are missing: `{"op": ..., "error": ...}`, exit 2.
- Bad arguments (an unknown operation, a test argument that is not a number): a
  usage message on stderr, no JSON, exit 64.

## Exit codes

| Code | Meaning                                                                                                                                                                                                                                                                                                                                                                         | What to do                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 0    | HTTP 200 and `result.ok`                                                                                                                                                                                                                                                                                                                                                        | Move on.                                                |
| 1    | Your code or your request: HTTP 200 but not ok (compile errors, failing tests, violations), or a request the server refused (400 bad JSON, unknown app or codeunit that is not a runnable test; 404; 413 too large; 422 workspace over the limits; 429 a second concurrent request; 409 your workspace changed while it was snapshotted, so run again once your edits are done) | Read `result`, fix, run again.                          |
| 2    | The environment: no response, the tool's credentials unavailable, or any other HTTP status (408 and 5xx among them)                                                                                                                                                                                                                                                             | Retry once. If it repeats, say so; it is not your code. |
| 3    | 401 unauthorized                                                                                                                                                                                                                                                                                                                                                                | Stop and report it; you cannot fix it.                  |
| 64   | Usage error                                                                                                                                                                                                                                                                                                                                                                     | Fix the arguments.                                      |

## Working through diagnostics

1. Compile the app you changed.
2. Read every diagnostic in full. The first error often causes the ones after
   it, so fix from the top and compile again.
3. When an app fails, the apps built on it are not compiled: each reports one
   diagnostic, code `CG0001`, `dependency <App> did not build`. Fix the
   failing app first.
4. Fix the warnings your change introduced, as the conventions rule asks.
5. Finish with a clean `cg-al compile` of all apps.
