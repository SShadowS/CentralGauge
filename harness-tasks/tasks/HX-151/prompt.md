# Task 5151: Automated tests for rental quotes

Reported by the Rental desk.

The desk quotes a price for a vehicle and dates (`CGR Quote Mgt`.`Quote`) and books the quote when the customer agrees (`BookQuote`). Customers who ask for the same car on different dates are sometimes booked at the price of their first quote.

Before anyone changes the quotes we want automated tests that pin down how they must behave. Put them in a new test codeunit in the Test app. Do not fix the code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault. A faulty version counts as caught only when one of your tests fails on an assertion; a test that stops with an error does not catch it.

How quotes must behave (`CGR Quote Mgt` in Reporting; `CGR Quote Cache`.`Reset()`; the insurer app gives the premium through `OnGetPremium(VehicleNo: Code[20]; Days: Integer; var Premium: Decimal)` on `CGR Quote Mgt`, and the booking partner sees each booking through `OnAfterBookQuote(var Contract: Record "CGR Rental Contract")` on `CGR Quote Booking`):

- `Quote(VehicleNo: Code[20]; StartDate: Date; EndDate: Date): Decimal` = days x the vehicle's "Daily Rate" + the premium the insurer app gives; days = EndDate - StartDate + 1.
- Quotes are kept for the session and not saved. Asking again for the same vehicle and the same dates returns the kept quote without asking the insurer again. Other dates are a new quote.
- `CGR Quote Cache`.`Reset()` drops all kept quotes; logging out does the same.
- `BookQuote(VehicleNo: Code[20]; StartDate: Date; EndDate: Date; CustomerName: Text[100]): Code[20]` creates an Open rental contract for the vehicle, dates and customer with "Agreed Price" = the kept quote, and returns its number. Without a kept quote it fails with `There is no quote for vehicle %1 from %2 to %3.` (vehicle, start date, end date). A booked quote is no longer kept.
- The booking partner may refuse a booking in OnAfterBookQuote. Then BookQuote fails with the partner's error, no contract is kept, and the quote is still kept so the desk can try again.
- Quotes are booked from the quote page, with no unsaved changes.

Write the test codeunit.
