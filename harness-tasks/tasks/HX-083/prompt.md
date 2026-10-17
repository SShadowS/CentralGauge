# Bug 7860: Lease run summary shows invoice lines that were never created

Reported by the Lease desk.

Last sprint we shipped the lease run in Leasing. Codeunit `CGR Lease Run` has `RunLeaseSummary(var LeaseFilter: Record "CGR Lease Contract"; UpToDate: Date; var RunLine: Record "CGR Lease Invoice Line" temporary): Integer`. It invoices every lease in the filter up to the date, one lease at a time through codeunit `CGR Lease Run Unit`, and fills RunLine as the summary of the run. Extensions such as the archive app subscribe to `CGR Lease Invoicing`.`OnAfterCreateInvoiceLine` and to `CGR Lease Run Unit`.`OnAfterLeaseInvoiced`; they may refuse a line or a lease by raising an error, and some of them commit before they do.

Observed: last night's run for leases L-3 and L-4. The archive app refused L-4's April line. L-4 has no invoice lines at all, but the summary lists L-4's March line, and the number of lines the run reported includes it.

Expected:

- For every lease whose run succeeds, RunLine gets a copy of each invoice line the run created for that lease, with all its fields as stored.
- A lease whose run fails adds nothing to RunLine. This holds wherever the failure happens: on any of its lines, or after its lines in `OnAfterLeaseInvoiced`.
- Rows RunLine already held when `RunLeaseSummary` was called stay as they were.
- The result is the number of rows the call added to RunLine.
- Leases run on their own as today: a lease that fails keeps nothing (no invoice lines, no invoiced schedule lines), also when an extension committed during its run, and it does not stop the other leases.
- Lines invoiced before the run are not part of its summary. Leases outside the filter and lines due after the date are not touched.

Reproduction:

1. Leases L-3 and L-4, each starting 2027-03-01 for 3 months, with their schedules created.
2. An extension raises an error in `OnAfterCreateInvoiceLine` for L-4's schedule line 20000 (due 2027-04-01).
3. Call `RunLeaseSummary` with a filter on L-3 and L-4, UpToDate 2027-04-15 and an empty RunLine.
4. L-4 has no invoice lines, but RunLine holds L-4 line 10000 next to L-3's two lines, and the result is 3.

Expected: RunLine holds exactly L-3's lines 10000 and 20000, and the result is 2.
