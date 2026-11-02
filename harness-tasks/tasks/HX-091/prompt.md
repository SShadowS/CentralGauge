# Bug 7591: Customers get the invoice mail again when a dispatch is retried

Reported by Billing desk.

Rental invoices go out through the invoice dispatch queue in Integration. `CGR Invoice Dispatcher.QueueInvoice(ContractNo)` adds an entry, and `ProcessQueue()` delivers every queued entry: first the invoice mail to the customer, then the invoice export file for the accounting partner. An entry whose delivery fails stays in the queue with Error, Error Message and Retry Count, and the next `ProcessQueue()` tries it again. A delivered entry is removed from the queue. `ProcessQueue()` runs from a scheduled job, each run in a new session, so a retry often comes hours later or after a server restart.

Observed:

- When the export fails after the mail went out, the next run mails the customer again. Some customers have received the same invoice three times.
- When something fails after both the mail and the export went out, the retry repeats both, and the partner imports the invoice twice.
- When the desk deletes a failed entry and queues the same invoice again, the customer again gets the mail they already had.

Expected:

- A delivery that has happened stays done, even when a later step of the same attempt fails. A retry delivers only what has not yet been delivered for that invoice.
- Once an invoice has gone out on both channels it is complete. Queuing the same invoice again after that sends it again; that is how the desk does a deliberate resend.
- A failed attempt leaves the entry with Error set, the error text in Error Message, and Retry Count increased by one for each failed attempt. An entry that has never failed is never shown as failed.
- An invoice that goes through without errors gets exactly one mail and one export, as today.

Reproduction:

1. Queue the invoice for contract RC1001 and make the export fail once (the partner share is unreachable).
2. `ProcessQueue()`: the mail is sent, there is no export, and the entry has Error set and Retry Count 1. This is correct.
3. `ProcessQueue()` again: the export is written and the entry is removed, but the customer gets a second mail. Expected: no second mail.
