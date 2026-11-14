# Feature 5182: Posted revenue per rental contract for a date range

Requested by Finance.

Codeunit `CGR Contract Accrual` (70597, Reporting) answers `PostedRevenue(): Dictionary of [Code[20], Decimal]`: for every rental contract, keyed by its number, the sum of the Amount of its `CGR Rental Ledger Entry` rows. It reads query `CGR Contract Posted Revenue` (70596).

For the month-end close, Finance needs the same answer for a date range. Add `PostedRevenueBetween(FromDate: Date; ToDate: Date): Dictionary of [Code[20], Decimal]` to `CGR Contract Accrual`. Its answer has a key for every rental contract, holding the sum of the Amount of the contract's ledger entries with a Posting Date from FromDate to ToDate, both days included. Finance builds its manual accrual list from the zero values, so a contract with nothing posted in the range is in the answer with 0, and is never left out.

`PostedRevenue` gives the same answer as today.
