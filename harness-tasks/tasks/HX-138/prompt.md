# Task 8486: Automated tests for the outbox purge

Reported by the Integration team.

The outbox purge (`CGR Outbox Purge`.`PurgeSent`) removes old sent outbox entries; it runs from the job queue every night and can also be started from the outbox list. The outbox table keeps growing: on nights when a partner app vetoes one entry near the end, nothing at all is purged, and the next night starts over.

Before anyone changes the purge we want automated tests that pin down how it must behave. Put them in a new test codeunit in the Test app. Do not fix the code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault. A faulty version counts as caught only when one of your tests fails on an assertion; a test that stops with an error does not catch it.

How the purge must behave (`CGR Outbox Purge` in Integration, procedure `PurgeSent(OlderThan: DateTime): Integer`, event `OnBeforePurgeEntry(Entry: Record "CGR Outbox Entry")`):

- It deletes every outbox entry that is Sent and was created before OlderThan, except entries of vehicles whose `"Hold Outbox"` is set. Unsent and failed entries are never deleted.
- Partner apps may veto the deletion of an entry by raising an error in OnBeforePurgeEntry. Then the purge stops with that error; entries deleted before the vetoed one stay deleted if at least 500 deletions were made before it (the purge commits after every 500 deletions); the deletions after the last commit are undone.
- The result is the number of entries deleted.
- Started by a user, the purge tells the user how many entries were deleted (`%1 outbox entries were deleted.`). Started without a user interface (job queue), it shows nothing.
