# Task 5177: Log new lease invoice lines for the accounting partner

Requested by Finance, lease desk.

Our accounting partner is moving to a feed of lease activity. The partner sync already sends every entry of the lease activity log, table `CGR Lease Activity Entry` in the Leasing app, but no code writes invoice lines to that log yet.

Before each invoicing run, Finance checks the billing preview, `CGR Lease Billing Preview`.PreviewBilling, which lists the invoice lines that `CGR Lease Invoicing`.InvoiceDueLines would create for a lease up to a date.

Requirement:

- Every lease invoice line that is created, whether by the invoicing run or by another app that inserts `CGR Lease Invoice Line` records itself, adds one entry to the lease activity log: Activity `INVOICE LINE`, the line's Contract No., its Schedule Line No. as Reference No., and its Amount.
- Checking the billing preview bills nothing: running it leaves the lease activity log as it was.
- The invoicing run and the billing preview keep their signatures and results, and the invoice lines they produce do not change.
