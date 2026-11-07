# Task 8547: Automated tests for the rental posting check

Reported by Accounts receivable.

Last sprint we shipped a posting check for rental contracts: it tells whether returned contracts would post, without posting them. Since then the insurance partner has reported claim records for contracts that were only checked, never posted.

Before anyone changes the posting check we want automated tests that pin down how it must behave. Put them in a new test codeunit in the Test app. Do not fix the code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault. A faulty version counts as caught only when one of your tests fails on an assertion; a test that stops with an error does not catch it.

How the posting check must behave (`CGR Rental Posting Check` in Rental, procedures `CheckPosting(ContractNo: Code[20]; var ErrorText: Text): Boolean` and `CheckBatch(var ContractFilter: Record "CGR Rental Contract"; var Results: Dictionary of [Code[20], Text]): Integer`):

- CheckPosting returns true when posting the contract with `CGR Rental-Post` right now would succeed, and false with the error that posting would raise in ErrorText otherwise.
- A check changes nothing: no ledger entry, no status change, and nothing that partner apps (subscribers of `CGR Rental-Post`.`OnAfterPostRentalContract`) write during the posting is kept, also when a partner app commits its own work during the posting.
- CheckBatch checks every Returned contract in ContractFilter and no other contract. Results holds exactly the checked contracts that would fail, each with its error, and the result is the number of checked contracts that would post.
- Checks are started from the contract list, with no unsaved changes.
