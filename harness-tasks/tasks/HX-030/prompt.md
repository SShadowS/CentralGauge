# Task 7489: Automated tests for the invoice preview

Reported by the Front desk.

A front desk user opened the invoice preview of a returned contract and filtered it to its excess km line. Without clearing the filter she then opened the preview of the next contract: the preview failed with an error that the preview line already exists.

Before anyone changes the pricing code we want automated tests that pin down how the invoice preview and rental pricing must behave. Put them in a new test codeunit in the Test app. Do not fix the pricing code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault.

How it must behave (`CGR Rental Invoice Preview`, procedures `BuildPreview(ContractNo: Code[20]; var PreviewLine: Record "CGR Invoice Preview Line")` and `TotalAmount(var PreviewLine: Record "CGR Invoice Preview Line"): Decimal`, which price through `CGR Rental Pricing`):

- After BuildPreview the preview holds exactly the lines of that contract and has no filters, whatever it held or was filtered to before.
- Every line carries the contract number.
- Daily pricing: a "Rental days" line for the rental days (start date to end date, both included) at the vehicle's daily rate, and, when "Weekend Surcharge %" in CGR Setup is not 0, a "Weekend surcharge" line for the rental days that fall on a Saturday or Sunday at that percentage of the daily rate.
- Weekend Package pricing: one "Weekend package" line, quantity 1, at two daily rates.
- With either pricing method, an "Excess km" line when the km driven (return km minus start km) exceed the rental days times "Km Allowance per Day"; its quantity is the km above that allowance, at the "Excess Km Rate".
- A line's amount is its quantity times its unit price, rounded to the amount rounding precision in CGR Setup.
- TotalAmount returns the sum of the amounts of the lines within the filters set on the preview.
- Pricing uses CGR Setup as the session has loaded it (`CGR Session Context`). A change to CGR Setup reaches the prices only once the session's Setup is refreshed.
