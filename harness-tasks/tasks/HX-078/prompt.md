# Task 7825: Automated tests for amount allocation

Reported by Group finance.

Last sprint Core got a procedure that splits an amount into equal shares. Since then group finance has found splits whose shares do not add up to the amount that was split.

Before anyone changes the allocation we want automated tests that pin down how it must behave. Put them in a new test codeunit in the Test app. Do not fix the code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault.

How it must behave (`CGR Amount Allocation` in Core, procedure `AllocateAmount(Total: Decimal; Parts: Integer; var Shares: List of [Decimal])`):

- When Parts is below 1 it raises the error 'An amount can only be split into at least one part.'
- Otherwise Shares holds exactly Parts values afterwards; whatever it held before is gone.
- Each of the first Parts - 1 shares is Total / Parts rounded with `CGR Amount Rounding`.RoundAmount. The last share is Total minus the sum of the other shares.
- The rounding precision is the "Amount Rounding Precision" of CGR Setup as the session has loaded it through `CGR Session Context`, so a change to CGR Setup applies only after `CGR Session Context`.RefreshSetup. A precision of 0 or less means 0.01.
- A negative Total is split the same way.
