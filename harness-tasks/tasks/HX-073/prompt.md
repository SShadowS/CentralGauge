# Task 7790: Let the lease desk see which installments a run would invoice

Reported by Lease desk.

Before the lease desk runs `CGR Lease Invoicing`.InvoiceDueLines (Leasing) for a lease, it wants to see which schedule lines the run would invoice. Today only InvoiceDueLines knows which lines are due, and it keeps that to itself. We want that choice in one place.

Requirement:

- Add to `CGR Lease Invoicing` the public procedure `GetDueLines(ContractNo: Code[20]; UpToDate: Date; var DueLine: Record "CGR Lease Schedule Line" temporary): Integer`.
- After the call, DueLine holds a copy of every schedule line of the lease ContractNo that is not invoiced and is due on or before UpToDate, and nothing else: whatever DueLine held before the call is gone. GetDueLines returns the number of these lines.
- GetDueLines changes no data.
- When the lease ContractNo does not exist, GetDueLines fails with the platform's error for a record that does not exist.
- InvoiceDueLines invoices exactly the lines GetDueLines hands out for the same lease and date. Everything else InvoiceDueLines does stays as it is today: the invoice lines it creates, the schedule lines it marks invoiced, OnBeforeCreateInvoiceLine and OnAfterCreateInvoiceLine (including a subscriber that handles a line), and its return value.
