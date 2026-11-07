# Task 7946: Automated tests for the lease overnight billing

Reported by the Lease desk.

Last sprint the lease desk got an overnight billing that invoices leases in bulk. Since then some nights the job ends without invoicing anything.

Before anyone changes the overnight billing we want automated tests that pin down how it must behave. Put them in a new test codeunit in the Test app. Do not fix the code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault. A faulty version counts as caught only when one of your tests fails on an assertion; a test that stops with an error does not catch it.

How the overnight billing must behave (`CGR Lease Overnight Billing` in Leasing, procedure `BillLeasesOvernight(var LeaseFilter: Record "CGR Lease Contract"; var FailedLeases: List of [Code[20]]): Integer`):

- It invoices every lease in LeaseFilter on its own, the way `CGR Lease Invoicing`.InvoiceDueLines does, with the schedule lines due up to the work date.
- It may be called while its caller has database changes that are not committed yet; it commits them first.
- A lease whose invoicing fails (for example an archive app subscribed to the invoicing events raises an error) keeps no invoice line and no invoiced schedule line, also when the archive app committed before raising its error. That lease goes into FailedLeases, and the other leases are still invoiced.
- FailedLeases holds exactly the leases that failed in this call.
- The result is the number of leases in LeaseFilter that were invoiced without error, also when a lease had no line due.
