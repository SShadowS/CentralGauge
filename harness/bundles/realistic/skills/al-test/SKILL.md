---
name: al-test
description: Run the AL test codeunits with cg-al test and read the per-test outcomes. Use after a clean compile, while iterating on a change and before you finish.
---

# Running tests with cg-al

`cg-al test` publishes the apps to the Business Central server and runs test
codeunits of the test app. Exit codes and the shape of the JSON line are the
same as for compile; see the `al-compile` skill.

## Usage

- `cg-al test` runs every runnable test codeunit of the test app.
- `cg-al test <number> ...` runs only the named codeunits. Each argument must be
  a codeunit number, not a name.

A runnable test codeunit sits in the test app, has `Subtype = Test` and at least
one `[Test]` procedure, declares no `TestPage` variable, and, among other
checks, has an ID the server accepts for tests: take it from the test app's
range as the testing rule says, and use the next free one. Asking for any other
codeunit by number is refused with exit 1 and an `error` in `result`. A
test codeunit with a `TestPage` variable is skipped by a full run and listed
under `result.skipped_testpage`, so it never proves anything here.

## Reading the result

- `result.ok` is true only when at least one test ran and every test passed.
- `result.tests` has one row per test procedure: `codeunit`, `procedure`,
  `outcome` (`pass`, `fail` or `not_run`) and, when it did not pass,
  `failure` (`assertion`, `runtime_error` or `infra`).
- `result.messages` has one entry per procedure that failed with an error
  text, with its `codeunit`, `procedure` and `message`. A `not_run` row can
  have no message at all.
- When the apps could not be published, every row is `not_run` and
  `result.messages` holds one entry with `codeunit` 0 and `procedure`
  `(publish)` whose `message` says why.
- If the apps do not compile, the run stops there and `result.apps` holds the
  compiler diagnostics instead of test outcomes.
- A row that failed with `infra` is the environment, not your code: run again
  once, and say so if it repeats.

## Loop

1. Compile first. A test run on code that does not compile tells you nothing
   new.
2. Run the test codeunits that cover your change: `cg-al test <number>`. Find
   them by searching the test app for the objects and procedures you changed.
3. For each failing test, read its message, then read the test
   and the code under test before you edit anything.
4. Fix the code, or the test when the test is what is wrong. Never weaken an
   assertion to make it pass, and do not change an existing test unless the
   ticket asks for it.
5. Run the failing codeunit again until it passes.
6. Run all tests with `cg-al test` and check that nothing which passed before
   now fails.
