# Feature 7311: Round rental amounts to the precision of the contract's branch

Reported by Finance, head office.

Every rental contract stores the branch it was created at ("Branch Code"). Last sprint we added the table `CGR Branch Rounding` (Core) so that each branch can keep its own rounding precision ("Rounding Precision", keyed by "Branch Code"). Nothing reads the table yet: all rental amounts are still rounded to the precision on `CGR Setup`, and the branches with cash-only counters are now invoicing amounts they cannot settle.

Requirement:

- A rental contract's amounts are rounded to the "Rounding Precision" of the contract's branch when `CGR Branch Rounding` has a row for that branch with a precision above 0. When the branch has no row, or its precision is 0, rounding stays as it is today (the Setup precision, 0.01 when Setup holds 0).
- This applies wherever a rental contract is priced: every line of the invoice preview (`CGR Rental Invoice Preview`) and the amount posted to the rental ledger, both when a contract is posted on its own (`CGR Rental Mgt`, Post) and when it is posted in a batch (`CGR Rental Batch Post`). The preview total keeps matching the posted amount.
- The branch that counts is the one stored on the contract, whichever branch the user previewing or posting it is currently working in.
- Lease invoicing is not part of this change: lease invoice lines keep rounding to the Setup precision.
