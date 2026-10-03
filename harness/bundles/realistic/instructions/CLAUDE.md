# Team conventions

This is our Business Central workspace. Everything you need is on this machine.

- The repository is at `C:\workspace`. It holds one folder per Business Central
  app, and each app folder has its own `app.json` (name, publisher, ID range,
  dependencies).
- The ticket you are working on is in `C:\task\prompt.md`. Read it in full
  before you change anything.
- We build and test only through `cg-al`. It compiles the apps and runs the
  tests on a Business Central server and prints the result as JSON:
  - `cg-al compile [App ...]` compiles the named apps, or all of them.
  - `cg-al test [codeunit ...]` publishes the apps and runs the named test
    codeunits, or all of them.
  - `cg-al symbols` lists the package names, publishers and versions installed
    on the server.

## How we work

1. Read the ticket. Note every behaviour it asks for and every name it gives.
2. Find the objects involved by searching first: search for object names,
   procedure names and event publishers, then open only the files you need.
3. Before you write a new procedure, look for an existing procedure, event or
   interface that already does the job and reuse it. The `al-reuse-lookup`
   skill and the `library-function-finder` agent help with this.
4. Make the smallest change that meets the ticket. Follow the patterns the app
   already uses rather than introducing a new style next to an old one.
5. Compile with `cg-al compile` and fix every error and new warning.
6. Run the tests with `cg-al test`: the affected codeunits while you iterate,
   all of them before you finish.
7. Ask `al-reviewer` to review the change before you call it done, and act on
   what it finds.

## Code navigation

If an LSP tool is available, use it first for symbols, definitions, references and diagnostics, and fall back to search when it has no answer.

## Delegation

- `al-test-writer`: when the change needs new or updated tests. Give it the
  behaviour to cover and the objects involved.
- `al-reviewer`: when the change is written and compiles. It checks our
  conventions, breaking changes for other apps, and missing tests.
- `library-function-finder`: when you are about to write a helper and suspect
  one of our apps, or a package the app already uses, has one.

## Rules

Team rules for AL conventions, testing, breaking changes and code navigation are in the rules folder next to this file and apply to every change.
