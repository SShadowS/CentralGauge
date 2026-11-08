# Task 8731: Automated tests for the outbox redelivery

Reported by the Integration team.

Outbox entries that a partner could not take are retried by a job every minute (`CGR Outbox Redelivery`.`RetryDue`). Since the checkout entries started arriving without a first send attempt, the job fails every minute with "The date is not valid." and nothing is retried at all.

Before anyone changes the retry we want automated tests that pin down how it must behave. Put them in a new test codeunit in the Test app. Do not fix the code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault. A faulty version counts as caught only when one of your tests fails on an assertion; a test that stops with an error does not catch it.

How the retry must behave (`CGR Outbox Redelivery` in Integration, procedures `IsDue(EntryNo: Integer; Now: DateTime): Boolean` and `RetryDue(Now: DateTime): Integer`; event `OnRedeliverEntry(Entry: Record "CGR Outbox Entry")` on `CGR Redelivery Send`):

- IsDue is true for an entry that is not Sent and not Failed and was either never attempted ("Last Attempt At" is blank) or last attempted at least 30 seconds before Now.
- RetryDue sends every due entry through OnRedeliverEntry, each on its own. A sent entry gets Sent = true. A partner app may refuse an entry by raising an error in OnRedeliverEntry.
- A refused entry gets Attempts + 1 and "Last Attempt At" = Now. After its 5th refused attempt it gets Failed = true.
- One refused entry does not stop the others.
- The result of RetryDue is the number of entries sent in that call.
