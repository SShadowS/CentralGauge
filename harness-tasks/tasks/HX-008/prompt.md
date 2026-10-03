# Feature 7320: Invoice every due lease in one run

Reported by Finance, lease desk.

At month end the lease desk invoices leases one at a time with `CGR Lease Invoicing`.InvoiceDueLines. With hundreds of leases that takes the whole day, and when one lease fails (for example because an extension that reacts to lease invoicing raises an error) nobody can tell afterwards which leases were invoiced, which were not, and why.

Requirement:

- Add a codeunit `CGR Lease Batch Invoicing` to the Leasing app with:
  - `procedure InvoiceDueLeases(var LeaseFilter: Record "CGR Lease Contract"; UpToDate: Date): Integer`: for every lease within the filters set on LeaseFilter, invoices the schedule lines due on or before UpToDate, with the same result per line as InvoiceDueLines gives for a single lease. It returns the number of leases for which at least one schedule line was invoiced in this run.
  - `procedure LastRunId(): Guid`: the id of the latest InvoiceDueLeases run made with this codeunit instance. Every run gets a new id.
- Each lease is all or nothing. When invoicing a lease fails, the run leaves nothing of it invoiced: no invoice lines for it, and its schedule lines stay uninvoiced. This also holds when an extension subscribed to lease invoicing commits the transaction while the lease is being invoiced. A failing lease does not stop the run: the other leases are still invoiced.
- Every lease that fails is recorded in a new table `CGR Lease Invoice Error` in the Leasing app, one record per failed lease, with the fields "Entry No." (Integer, AutoIncrement, primary key), "Run Id" (Guid, the id of the run), "Contract No." (Code[20]), "Error Message" (Text[250], the text of the error that made the lease fail) and "Logged At" (DateTime, when it was recorded). The record is kept even though the failed lease's invoicing is undone.
- A lease with nothing due up to UpToDate is neither counted nor recorded.
