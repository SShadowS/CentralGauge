# Task 7545: Show the invoice lines a lease run would create

Reported by Finance, lease desk.

Before the lease desk runs `CGR Lease Invoicing`, InvoiceDueLines for a lease, Finance wants to see the invoice lines the run would create, without creating anything.

Requirement:

- Add to `CGR Lease Invoicing`: `procedure ProposeInvoiceLines(ContractNo: Code[20]; UpToDate: Date; var InvoiceBuffer: Record "CGR Lease Invoice Line" temporary)`. It fills InvoiceBuffer with the invoice lines that InvoiceDueLines(ContractNo, UpToDate) would create for the lease now, as they are before any extension sees them: the same Contract No., Schedule Line No., Vehicle No., Customer Name, Due Date, Invoice Date and Amount. Whatever InvoiceBuffer held before the call is replaced: afterwards it holds only these lines.
- ProposeInvoiceLines changes nothing in the database and raises no event.
- InvoiceDueLines must build its invoice lines with ProposeInvoiceLines, so the proposal and the run cannot drift apart. Everything else InvoiceDueLines does stays as it is today: OnBeforeCreateInvoiceLine and OnAfterCreateInvoiceLine are raised for each line as today, subscribers can still change a line or handle it, and its return value, the invoice lines it creates and the schedule lines it marks invoiced do not change.
