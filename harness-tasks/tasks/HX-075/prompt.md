# Task 7804: Partner apps need our lease invoice numbers, without gaps

Reported by Group finance.

Last sprint we started numbering lease invoices in Leasing. `CGR Lease Invoice Line` got field 8 "Invoice No." (Code[20]), and `CGR Setup` got field 70322 "Last Lease Invoice No." (Integer) through the table extension `CGR Lease Invoice Setup`. `CGR Lease Invoicing`.InvoiceDueLines counts that field up itself and stamps the number on the invoice lines it creates.

Partner apps now need numbers from the same series, and finance needs the series without gaps. We want lease invoice numbers handed out in one place.

Requirement:

- Add to `CGR Lease Invoicing` the public procedure `NextLeaseInvoiceNo(): Code[20]`. It returns the next lease invoice number: 'LI' followed by "Last Lease Invoice No." of `CGR Setup` plus 1, written without separators or leading zeros (the number after 41 is LI42), and it stores that value in "Last Lease Invoice No.". When there is no `CGR Setup` record, numbering starts at LI1.
- Numbers have no gaps. A number belongs to the transaction that took it: when that transaction fails, the number is not used up and is handed out again. NextLeaseInvoiceNo commits nothing.
- InvoiceDueLines takes its number through NextLeaseInvoiceNo. It takes one number per call, and only a call that creates at least one invoice line takes one; every invoice line the call creates carries that number. A schedule line that a subscriber to OnBeforeCreateInvoiceLine handles creates no invoice line.
- Invoicing a lease is all or nothing, also when a partner app subscribed to OnAfterCreateInvoiceLine commits: when InvoiceDueLines fails, none of the invoice lines it created, none of the schedule lines it marked invoiced and not its number are kept. A partner that commits and does not fail changes nothing: the lease is invoiced as usual.
- Everything else InvoiceDueLines does stays as it is today: the other fields of the invoice lines it creates, the schedule lines it marks invoiced (handled ones included), OnAfterCreateInvoiceLine for every invoice line it creates, and its return value.
