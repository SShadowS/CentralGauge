# Bug 7440: Accounting import rejects our lease and rental export lines

Reported by Finance.

Last sprint we shipped two exports for the accounting system: `CGR Lease Invoice Export` (Leasing), ExportLine, writes one line per lease invoice line as `<Contract No.>;<Vehicle No.>;<Invoice Date>;<Amount>`, and `CGR Rental Ledger Export` (Rental), ExportEntry, writes one line per rental ledger entry as `<Contract No.>;<Vehicle No.>;<Posting Date>;<Amount>;<Km Driven>`. The accounting import rejects most of the lines we send.

Observed (examples from the import log):

- `LC12;V-1;03/01/27;1,234.5` for lease contract LC12, invoice date 1 March 2027, amount 1234.50
- `RC7;V-1;03/03/27;250;1500` for rental contract RC7, posting date 3 March 2027, amount 250, 1500 km

Expected (the accounting import format):

- `LC12;V-1;2027-03-01;1234.50`
- `RC7;V-1;2027-03-03;250.00;1500`

The import format, for every line of both exports:

- Dates are written as `yyyy-mm-dd`.
- Amounts use `.` as the decimal separator, no thousands separator, and always exactly two decimals.
- The km driven is a whole number written without separators and without decimals.
- The field order and the `;` separators stay as they are.

More exports to accounting are planned, so the formatting rules must live in one place in Core: add codeunit 70012 `CGR Export Format` with

- `procedure FormatAmount(Amount: Decimal): Text`
- `procedure FormatDate(Value: Date): Text`

and make both exports use it.
