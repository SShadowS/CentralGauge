# Task 8592: Automated tests for the nightly overdue-fee run

Reported by Accounts receivable.

Every night the job queue charges overdue fees on rental contracts that were not returned in time (`CGR Overdue Fee Run`.`ChargeOverdueFees`). When the payment partner refuses a fee one night, the days of that night are never charged afterwards: the next night only charges the days since the refused night.

Before anyone changes the overdue-fee run we want automated tests that pin down how it must behave. Put them in a new test codeunit in the Test app. Do not fix the code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault. A faulty version counts as caught only when one of your tests fails on an assertion; a test that stops with an error does not catch it.

How the overdue-fee run must behave (`CGR Overdue Fee Run` in Rental, procedure `ChargeOverdueFees(AsOf: Date): Integer`; event `OnBeforeChargeOverdueFee(Contract: Record "CGR Rental Contract"; Amount: Decimal)` on `CGR Overdue Fee Charge`):

- It looks at every Checked Out contract whose End Date is before AsOf. A contract is charged for the days after its End Date plus the grace days, up to AsOf, that were not charged before ("Fees Charged Through"). Example: End Date 2025-03-10, 0 grace days, AsOf 2025-03-13: 3 days; the next night, AsOf 2025-03-14: 1 day. A contract with no day to charge is skipped.
- A charge writes one `CGR Overdue Fee Entry` (contract, days, amount = days x "Overdue Fee per Day") and sets "Fees Charged Through" to AsOf.
- Each contract is charged on its own. When the payment partner (a subscriber to OnBeforeChargeOverdueFee) refuses with an error, that contract keeps nothing of the attempt, and the other contracts are still charged. Refused days are charged on a later night.
- The result is the number of contracts charged in this call.
- The fee settings ("Overdue Fee per Day" and "Overdue Grace Days" on `CGR Setup`) are read once per session through `CGR Overdue Fee Settings` (Core). A change takes effect after `CGR Overdue Fee Settings`.`Reload()`.
