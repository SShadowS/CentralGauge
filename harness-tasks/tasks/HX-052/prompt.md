# Task 7643: Automated tests for the revenue and vehicle status queries

Reported by Fleet controlling.

Controlling no longer trusts the monthly revenue figures per vehicle, and the vehicle status list feeds the morning planning. Before anyone touches the queries we want automated tests that pin down what both queries must return. Put them in a new test codeunit in the Test app. Do not change the queries in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault.

How they must behave:

- `CGR Revenue by Vehicle Month` returns one row per vehicle, year and month of the Posting Date of its `CGR Rental Ledger Entry` records (columns VehicleNo, PostingYear, PostingMonth, Amount, EntryCount).
- Amount is the sum of the amounts of those entries. Refunds are entries with a negative amount and reduce it; entries with amount 0 belong to the month as well.
- EntryCount is the number of those entries, refunds and zero-amount entries included.
- `CGR Vehicle Status` returns one row per `CGR Vehicle`, for every vehicle: blocked or not, checked out or not.
- Its columns are VehicleNo (the vehicle's number), CheckedOut (the vehicle's Checked Out) and Mileage (the vehicle's Mileage).
