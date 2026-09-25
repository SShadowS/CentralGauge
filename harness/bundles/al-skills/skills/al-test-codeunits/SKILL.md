---
name: al-test-codeunits
description: Writing and reading Business Central AL test codeunits (structure, assertions, expected errors, test data). Use when adding tests, or when a failing test needs to be understood.
---

# AL test codeunits

## Structure

```al
codeunit 50150 "My Feature Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure AddsTwoNumbers()
    var
        Calc: Codeunit "My Calculator";
    begin
        Assert.AreEqual(5, Calc.Add(2, 3), 'Add returns the sum');
    end;
}
```

- Test codeunits usually live in a separate test app that depends on the app under test
  (and on the test libraries it uses). `internalsVisibleTo` in the app under test lets it
  call internal procedures.
- Database changes are rolled back when the test codeunit finishes, not between its test
  procedures. Give each test its own keys and do not assume a table is empty.
- Run them with `cg-al test <codeunit number>`.

## Assertions (codeunit Assert)

`AreEqual(Expected, Actual, Msg)`, `AreNotEqual`, `IsTrue`, `IsFalse`,
`ExpectedError(Text)`, `ExpectedErrorCode`, `RecordIsEmpty`, `RecordCount`.
Put the expected value first. Assert on computed values, never on constants.

## Expected errors

```al
asserterror Calc.Divide(1, 0);
Assert.ExpectedError('Cannot divide by zero');
```

- `asserterror` passes only if the statement raises an error; the test fails if it does not.
- `ExpectedError` checks that the last error text contains the expected text. Check it, or a different error
  (for example a missing record) would pass too.

## Test data

- Create exactly the records the test needs, in the test, with values that make the
  expected result unambiguous (not zero, not equal to a default).
- Use `Insert(true)` / `Modify(true)` / `Validate` when the behavior under test lives in
  triggers; plain `Insert()` skips them.
- Handlers: `[ConfirmHandler]`, `[MessageHandler]`, `[ModalPageHandler]` on the test
  codeunit, listed in `[HandlerFunctions('HandlerName')]` on the test, answer UI calls the
  code makes. An unhandled UI call fails the test.
