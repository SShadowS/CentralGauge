# Task 7895: Automated tests for the dispatch statistics

Reported by the Integration team.

Last sprint the outbox dispatcher started keeping dispatch statistics for the integration dashboard. Since then the dashboard shows more failed dispatches than there are failed outbox entries.

Before anyone changes the statistics code we want automated tests that pin down how the dispatch statistics must behave. Put them in a new test codeunit in the Test app. Do not fix the code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault.

How the dispatch statistics must behave (`CGR Dispatch Statistics` in Core, procedures `RecordDispatch(Delivered: Boolean; EntryFailed: Boolean)`, `DispatchAttempts(): Integer`, `DispatchDelivered(): Integer`, `DispatchFailures(): Integer` and `ResetDispatchStatistics()`; `CGR Outbox Dispatcher` records its dispatches in them):

- Every dispatch of an outbox entry is one attempt, whether the entry is dispatched by `DispatchEntry` directly or through `DispatchPending`. DispatchAttempts returns the number of attempts.
- DispatchDelivered returns the number of attempts that were delivered.
- DispatchFailures returns the number of attempts at which the entry became failed, that is, the attempt that reached the maximum number of attempts. An attempt that is not delivered while the entry stays pending is not a failure. Entries that are already failed are never dispatched again.
- The statistics belong to the session: every `CGR Dispatch Statistics` variable in the session returns the same numbers.
- The statistics count what was attempted, also when the transaction that made the attempt fails after the dispatch.
- ResetDispatchStatistics sets all three numbers to 0.
