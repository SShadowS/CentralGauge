# Testing

Every change that alters behaviour comes with tests that prove the behaviour.
Tests live in the test app of the repository, not in the app they test.

## Test codeunits

- A test codeunit has `Subtype = Test` and sits in the test app.
- Group tests by the area they cover; add to an existing test codeunit for that
  area before you create a new one.
- New test codeunits take their ID from the test app's `app.json` range.
- Keep shared setup in a local `Initialize` procedure called at the start of
  every test, so each test starts from a known state.

## Test procedures

- Each test procedure has the `[Test]` attribute and tests one behaviour.
  Name it after that behaviour, so a failing test name says what broke.
- Structure the body with `// [GIVEN]`, `// [WHEN]` and `// [THEN]` comments.
- Create the data the test needs inside the test, with the helpers and
  libraries the test app already depends on (read its `app.json`). Do not add
  new dependencies to the test app. Do not depend on demo data being present.
- Do not depend on the order in which tests run.

## Assertions

- Use `Library Assert` (`Assert.AreEqual`, `Assert.IsTrue`,
  `Assert.ExpectedError`, `Assert.RecordIsEmpty` and the rest).
- Assert exact expected values that the test computed or set up itself, not
  "something changed" or "not zero".
- Every assertion message says what was expected.
- Never write a placeholder assertion such as `Assert.IsTrue(true, ...)`. A test
  that cannot fail tests nothing.
- For an expected error, run the call inside `asserterror` and then check the
  error text with `Assert.ExpectedError`.

## UI in tests

- Pages are tested through `TestPage` variables.
- Every `Message`, `Confirm`, `StrMenu` or modal page the code under test raises
  needs a handler function (`[MessageHandler]`, `[ConfirmHandler]`,
  `[StrMenuHandler]`, `[ModalPageHandler]`), named in the test's
  `[HandlerFunctions]` attribute.
- A handler that is declared but never called fails the test, so declare only
  the handlers the test triggers.

## Running tests

- While you iterate, run only the test codeunits your change affects:
  `cg-al test <codeunit>`.
- Before you finish, run all tests with `cg-al test` and make sure nothing that
  passed before now fails.
- A failing test is information. Fix the code or the test that is wrong; never
  weaken an assertion to make it pass.
