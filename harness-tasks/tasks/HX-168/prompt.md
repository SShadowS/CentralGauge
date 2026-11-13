# Task 5168: Keep desk rate quotes in memory for the session

Requested by Rental desk.

The desk quotes day rates many times per contract, and every call of `CGR Desk Rate Quote`.`QuoteDeskRate` (Rental) reads the desk rate from the database. Turn `CGR Desk Rate Quote` into a session cache.

The new structure:

- `QuoteDeskRate(RateCode: Code[20]): Decimal` keeps its signature. The cache is shared by every `CGR Desk Rate Quote` variable in the session. A repeated quote of a desk rate that has not changed since the session started issues no database statement (`SessionInformation.SqlStatementsExecuted` does not move); the first quote of a rate may read the database.
- Add `procedure ForgetDeskQuotes()` to `CGR Desk Rate Quote`. It puts the session back to its start: the next quote of every desk rate reads the database again.

Everything else stays as it is today, in particular:

- A desk rate created, changed or deleted, through `CGR Desk Rate Update`.`SetDeskDayRate` or by any other app, with or without table triggers, is quoted correctly by the next quote, also inside the same transaction. A desk rate that does not exist has no quote: QuoteDeskRate fails with the table's not-found error. Desk rate codes are never renamed.
- SetDeskDayRate does not commit; its caller does, and the caller may quote the rate again and still fail after SetDeskDayRate has returned. A rate change that was never saved, because SetDeskDayRate rejected it or because the caller's transaction failed and was rolled back, never shows up in a later quote. The desk goes on working in the same session after such a failure.
