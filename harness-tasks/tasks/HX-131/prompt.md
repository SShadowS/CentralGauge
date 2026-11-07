# Task 6318: Automated tests for closing expired contracts

Reported by the Rental desk.

Every night the job queue closes rental contracts whose end date has passed. On busy nights the job closes nothing at all, and the contracts stay open until someone closes them by hand.

Before anyone changes the closer we want automated tests that pin down how it must behave. Put them in a new test codeunit in the Test app. Do not fix the code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault. A faulty version counts as caught only when one of your tests fails on an assertion; a test that stops with an error does not catch it.

How the closer must behave (`CGR Contract Closer` in Rental, procedure `CloseExpired(AsOf: Date): Integer`, event `OnBeforeCloseContract(var Contract: Record "CGR Rental Contract")` on `CGR Close Contract`):

- It closes every Returned contract whose End Date is before AsOf: Status becomes Closed and "Closed On" is AsOf. Other contracts are not changed.
- It runs unattended from the job queue: it never asks the user anything, however many contracts it closes.
- Each contract is closed on its own. When a contract cannot be closed (for example a partner app subscribed to OnBeforeCloseContract raises an error), that contract keeps nothing of the attempt, a row in `CGR Close Failure` records the contract and the error text, and the other contracts are still closed.
- A contract that was closed stays closed even when a later contract in the same call fails.
- It may be called while its caller has database changes that are not committed yet; it commits them first.
- The result is the number of contracts closed in this call.
