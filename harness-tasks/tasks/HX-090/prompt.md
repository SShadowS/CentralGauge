# Task 7909: Automated tests for the lease night run

Reported by the Lease desk.

Last sprint the lease desk got a night run that invoices leases in bulk. Since then some nights the job ends without invoicing anything.

Before anyone changes the night run we want automated tests that pin down how it must behave. Put them in a new test codeunit in the Test app. Do not fix the code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault.

How the night run must behave (`CGR Lease Night Run` in Leasing, procedure `InvoiceNightRun(var LeaseFilter: Record "CGR Lease Contract"; var FailedLeases: List of [Code[20]]): Integer`):

- It invoices every lease in LeaseFilter on its own, the way `CGR Lease Invoicing`.InvoiceDueLines does, with the schedule lines due up to the work date.
- It may be called while its caller has changes that are not saved yet; it saves them first.
- A lease whose invoicing fails (for example an archive app subscribed to the invoicing events raises an error) keeps no invoice line and no invoiced schedule line, also when the archive app committed before raising its error. That lease goes into FailedLeases, and the other leases are still invoiced.
- FailedLeases holds exactly the leases that failed in this call.
- The result is the number of leases invoiced without error.
