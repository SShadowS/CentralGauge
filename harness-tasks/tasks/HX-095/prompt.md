# Bug 7671: Reapplying payments changes the amount of a payment line the partner already has

Reported by Accounting desk.

Customer payments go to the accounting partner as payment export lines (`CGR Payment Export Line`, Rental). A line starts Open, becomes Exported when the export file is written and Sent when the partner confirms it. The desk links a line to the customer payment entries it settles with `CGR Payment Application.ApplyEntries` (Rental), which sets the Applies-to ID on the entries and on the contract's export lines and works out the line's Amount and Amount (LCY) from those entries.

Observed:

- Reapplying payments for a contract whose export line is already Sent fails with an error, so the desk cannot correct a wrong application at all.
- The desk's "Refresh amounts" action (`CGR Export Line Amount.UpdateAmount`) and the month-end remittance rebuild (`CGR Remittance Builder.Rebuild`) recalculate the amounts of Exported and Sent lines. The amounts we hold then no longer match what the partner received, and Amount (LCY) moves with the exchange rate of the day.

Expected:

- Once a line is Exported or Sent, its Amount and Amount (LCY) never change: not when payments are reapplied, refreshed or rebuilt.
- Reapplying payments works for every line, without an error. The Applies-to ID of the entries and of the export line follows the new application; only the amounts of Exported and Sent lines stay as they are.
- Open lines behave as today: their amounts follow the applied entries and the current exchange rate.

Reproduction:

1. Contract RC2040 has a Sent export line with Amount 100.00 and Amount (LCY) 80.00, exported when the rate was 1.25. The rate is now 1.60.
2. The desk applies the line to two payment entries of 60.00 and 70.00 under a new Applies-to ID: an error is raised. Expected: no error, the line keeps 100.00 and 80.00, and it carries the new Applies-to ID.
