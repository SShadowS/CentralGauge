# Bug 7351: Lease invoices do not add up to the lease total

Reported by Finance, cash branches.

Our cash branches round all amounts to 0.05 ("Amount Rounding Precision" in `CGR Setup`). Since then the lease invoices of a lease no longer add up to its payment schedule, and the schedule itself contains amounts that cannot be paid in cash.

Observed:

- The lease total and the installments of a lease schedule are rounded to cents, whatever the precision in `CGR Setup`. The same goes for the monthly rate (`CGR Lease Mgt`, MonthlyRate).
- Lease invoicing rounds every installment again with the Setup precision, so the invoice lines differ from the schedule and their sum differs from the lease total.

Expected:

- The lease total, every installment and the monthly rate are rounded to the Setup precision, the way invoice line amounts are rounded today, using the precision in effect when the schedule is created or the rate is computed.
- The installments are the rounded lease total divided by the number of months, each rounded to that precision; the last installment takes the remainder, so the installments add up to the rounded lease total.
- An invoice line bills the amount of its schedule line unchanged, also when the precision was changed after the schedule was created.

Reproduction:

1. Set "Amount Rounding Precision" in `CGR Setup` to 0.05.
2. Create a lease starting 1 March 2027 for 3 months with a base rate of 100.01 and create its schedule.
3. The schedule has three installments of 103.01 (309.03). Expected: a lease total of 309.05 and installments of 103.00, 103.00 and 103.05.
4. Invoice the lease up to 1 May 2027. The three invoice lines are 103.00 each (309.00). Expected: 103.00, 103.00 and 103.05.
