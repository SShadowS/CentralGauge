# Task 7388: Automated tests for outbox dispatch and retries

Reported by the Integration team.

Support reports outbox entries that were rejected once and delivered on a later retry: the entry is marked as sent, but its "Last Error" still shows the old rejection text, so the monitoring dashboard lists it as a problem.

Before anyone changes the dispatcher we want automated tests that pin down how outbox dispatch must behave. Put them in a new test codeunit in the Test app. Do not fix the dispatcher in this task: your tests will be run against the corrected dispatcher, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault.

How outbox dispatch must behave (`CGR Outbox Dispatcher`, procedures `DispatchPending(var EntryFilter: Record "CGR Outbox Entry"): Integer`, `DispatchEntry(EntryNo: Integer): Boolean`, `Requeue(EntryNo: Integer)` and `MaxAttempts(): Integer`):

- DispatchPending dispatches every pending entry within the caller's filter and returns the number delivered. An entry is pending when it is neither sent nor failed; sent and failed entries are not dispatched.
- Every dispatch of an entry is an attempt: it adds one to Attempts and records the time of the attempt in "Last Attempt At".
- An entry is delivered when a subscriber to the dispatcher's OnSendEntry event reports it delivered. A delivered entry is sent and has no "Last Error".
- An attempt that is not delivered stores the error text of that attempt in "Last Error" (the error raised by the subscriber, or "Outbox entry <entry no.> was not delivered." when nothing delivers it), replacing any earlier text. The entry becomes failed when its attempts reach the maximum number of attempts.
- The maximum number of attempts is "Outbox Max Attempts" in CGR Setup, or 3 when Setup holds 0 or less.
- Requeue makes a failed entry pending again: not failed, no attempts and no "Last Error".
