# Task 5153: Automated tests for invoicing due lease lines

Reported by Accounts receivable.

Due lease schedule lines are invoiced by `CGR Lease Due Invoicing`.`InvoiceDue`, every night from the job queue and on demand from the lease list. When the accounting app refuses one line of a lease, the other lines of that lease are invoiced anyway, and the customer gets half an invoice.

Before anyone changes the invoicing we want automated tests that pin down how it must behave. Put them in a new test codeunit in the Test app. Do not fix the code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault. A faulty version counts as caught only when one of your tests fails on an assertion; a test that stops with an error does not catch it.

How the invoicing must behave (`CGR Lease Due Invoicing` in Leasing, procedure `InvoiceDue(AsOf: Date): Integer`; event `OnAfterInvoiceLine(Line: Record "CGR Lease Schedule Line")` on `CGR Lease Due Line Run`):

- It invoices every schedule line that is not Invoiced and is due on or before AsOf, and no other line.
- An invoiced schedule line gets Invoiced = true and one `CGR Lease Invoice Line` with its contract, schedule line number and amount.
- A lease is invoiced as a whole: either all its due lines are invoiced or none of them is.
- The accounting app is told about each invoiced line through OnAfterInvoiceLine and may refuse it by raising an error. Then nothing of that lease is invoiced, and the other leases are still invoiced.
- The result is the number of leases invoiced. A refused lease does not count.
- Started by a user from the lease list, it tells the user `%1 leases invoiced, %2 refused.`. Started without a user interface (job queue), it shows nothing.

Write the test codeunit.
