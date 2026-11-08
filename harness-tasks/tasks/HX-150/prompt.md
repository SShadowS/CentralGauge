# Task 5150: Automated tests for desk posting permissions

Reported by IT security.

Desk agents post their returned contracts at the end of the shift. The auditors require that desk agents write rental ledger entries only through the posting routine, never directly. Since the desk permission set `CGR DESK AGENT` (Reporting app) went live, desk posting stops with a permission error.

Before anyone changes the permissions we want automated tests that pin down what desk agents can and cannot do. Put them in a new test codeunit in the Test app. Do not fix anything in this task: your tests will be run against the corrected objects, where they must pass, and against the current ones and other faulty versions, where they must catch the fault. A faulty version counts as caught only when one of your tests fails on an assertion; a test that stops with an error does not catch it.

What a desk agent (`CGR DESK AGENT` only) must and must not be able to do:

- A desk agent can post a returned contract with `CGR Rental Mgt`.`Post` (in Rental): the contract becomes Posted and one rental ledger entry is written for it.
- A desk agent can read the rental ledger entries of a contract.
- A desk agent cannot insert a rental ledger entry outside the posting routine.
- A desk agent cannot modify a rental ledger entry.
- A desk agent cannot delete a rental ledger entry.

Write the test codeunit.
