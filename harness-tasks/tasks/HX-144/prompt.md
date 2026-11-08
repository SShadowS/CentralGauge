# Task 6417: Automated tests for the desk and back-office roles

Reported by IT security.

Last sprint we shipped two permission sets in the Integration app, `CGR DESK` for desk agents and `CGR BACKOFFICE` for the back office. Since then desk agents cannot check out vehicles: the check-out stops with a permission error.

Before anyone changes the permission sets we want automated tests that pin down what each role can and cannot do. Put them in a new test codeunit in the Test app. Do not fix the permission sets in this task: your tests will be run against the corrected permission sets, where they must pass, and against the current ones and other faulty versions, where they must catch the fault. A faulty version counts as caught only when one of your tests fails on an assertion; a test that stops with an error does not catch it.

What the roles must allow (`CGR Rental Mgt` in Rental):

- A desk agent (`CGR DESK` only) can create a rental contract (`CreateContract`).
- A desk agent can check out an open contract (`CheckOut`): the contract and its vehicle are checked out.
- A desk agent can return a checked-out contract with a damage description (`Return`): the damage is registered and the vehicle is blocked.
- A desk agent cannot post a contract (`Post`): the post is refused and the contract stays Returned.
- A desk agent cannot delete a rental contract.
- A back-office user (`CGR BACKOFFICE` only) can post a returned contract: it gets status Posted and one rental ledger entry.

Write the test codeunit.
