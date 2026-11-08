# Task 8643: Automated tests for the desk posting lock

Reported by the Rental desk.

To stop desk agents from hammering "Post" on contracts that cannot post, the desk locks after three failed postings until the back office unlocks it. Since it went live, agents are locked out by the afternoon although most of their postings succeed.

Before anyone changes the lock we want automated tests that pin down how it must behave. Put them in a new test codeunit in the Test app. Do not fix the code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault. A faulty version counts as caught only when one of your tests fails on an assertion; a test that stops with an error does not catch it.

How the desk posting lock must behave (`CGR Desk Posting` in Rental, procedure `PostAtDesk(ContractNo: Code[20])`; `CGR Desk Attempts`: `Failures(): Integer`, `Reset()`):

- PostAtDesk posts the contract with `CGR Rental-Post`. When the posting fails, PostAtDesk fails with the posting's error, and nothing of the posting is kept.
- After 3 failed postings in a row in the session, PostAtDesk refuses at once with `The desk is locked after 3 failed postings. Ask the back office to unlock it.` and does not try to post. A refused call does not count as a failed posting.
- A successful posting starts the count (`Failures()`) again from 0.
- The count belongs to the session and is not saved. The back office unlocks a desk with `CGR Desk Attempts`.`Reset()`; logging out does the same.
- PostAtDesk is started from the contract card, with no unsaved changes.
