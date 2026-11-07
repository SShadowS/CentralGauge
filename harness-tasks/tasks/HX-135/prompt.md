# Task 5139: Automated tests for the branch day closing

Reported by the Front desk.

After a failed day closing, the branch stays locked ("Day Closing Running") until IT clears it.

Before anyone changes the day closing we want automated tests that pin down how it must behave. Put them in a new test codeunit in the Test app. Do not fix the code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault. A faulty version counts as caught only when one of your tests fails on an assertion; a test that stops with an error does not catch it.

How the day closing must behave (`CGR Day Closing` in Rental, procedure `CloseDay(BranchCode: Code[10]; ClosingDate: Date)`, event `OnAfterDayClosed(var Branch: Record "CGR Rental Branch"; ClosingDate: Date)` on `CGR Day Closing Run`):

- A closing posts the branch's Returned contracts that ended on or before ClosingDate, writes one `CGR Cash Count` and one `CGR Day Closing Entry` for the branch and date, then raises OnAfterDayClosed (partner apps send the day report and may refuse with an error). It sets the branch's "Last Closed Date".
- While a closing runs, the branch's "Day Closing Running" is set and committed, so other sessions see it. A second closing of the same branch started meanwhile fails with `The day closing of branch <code> is already running.`
- When a closing fails, CloseDay fails with the error that made it fail, and nothing of the failed closing is kept: no contract posted by it, no cash count, no closing entry, "Last Closed Date" unchanged.
- Whether the closing succeeds or fails, "Day Closing Running" is cleared afterwards, and the cleared flag is saved.
