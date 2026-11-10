# Task 5154: Automated tests for hourly billing

Reported by Accounts receivable.

City cars are rented by the hour and billed with `CGR Hourly Billing`.`BillHourly` when they come back. Every started hour is charged, but customers who keep a car 2 hours and 59 minutes are charged for 2 hours.

Before anyone changes the billing we want automated tests that pin down how it must behave. Put them in a new test codeunit in the Test app. Do not fix the code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault. A faulty version counts as caught only when one of your tests fails on an assertion; a test that stops with an error does not catch it.

How the billing must behave (`CGR Hourly Billing` in Rental, procedure `BillHourly(ContractNo: Code[20]): Boolean`; event `OnGetHourlyDiscount(Contract: Record "CGR Rental Contract"; Hours: Integer; var DiscountPct: Decimal)` on `CGR Hourly Billing`; event `OnAfterBillHourly(Bill: Record "CGR Hourly Bill")` on `CGR Hourly Bill Run`):

- Hours = the number of started hours between "Picked Up At" and "Returned At" on the contract: any part of an hour counts as a whole hour (exactly 2 hours is 2, a moment more is 3).
- One `CGR Hourly Bill` row is written for the contract, with the hours and the amount: hours x the vehicle's "Hourly Rate", less the discount % of the loyalty app (a subscriber to OnGetHourlyDiscount), rounded to 0.01. BillHourly returns true.
- The payment app (a subscriber to OnAfterBillHourly) may refuse the bill with an error. Then no bill row is written and BillHourly returns false; it does not raise the error.
- A contract is billed once: a later call for the same contract writes nothing and returns false.
- Billing is started from the contract card, with no unsaved changes.

Write the test codeunit.
