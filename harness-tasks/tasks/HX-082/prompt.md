# Bug 7853: Lease schedule import accepts two installments on the same day

Reported by the Lease desk.

Last sprint we shipped the codeunit `CGR Schedule Import` (Leasing). The lease desk fills the import lines (table `CGR Schedule Import Line`) from the customer's agreed payment plan, and `ImportSchedule(ContractNo: Code[20]; var ImportLine: Record "CGR Schedule Import Line"): Integer` replaces the lease's schedule with them and returns the number of schedule lines. It is meant to refuse an import in which two lines fall due on the same day, but it never does.

Observed: an import for lease L-12 with the lines 10000 due 2027-03-01, 20000 due 2027-04-01 and 30000 due 2027-03-01 is accepted and creates three installments, two of them on 1 March.

Expected:

- A line whose due date an earlier line (lower Line No.) of the same import already has fails the import with the codeunit's existing repeat error `Line %1 repeats the due date %2 of line %3.`, where %1 is the Line No. of the repeating line, %2 its due date and %3 the Line No. of the earlier line. The error names the first such line in Line No. order and the earliest line with that date, and nothing changes.
- `ImportSchedule` leaves `ImportLine` as it found it: the same lines and the same filters.
- Everything else stays as it is today.

Reproduction:

1. Lease L-12 starting 2027-03-01 with a schedule and no invoiced lines.
2. Import lines 10000 due 2027-03-01, 20000 due 2027-04-01 and 30000 due 2027-03-01.
3. Call `ImportSchedule('L-12', ImportLine)`. It returns 3 and the lease has two installments on 2027-03-01. Expected: it fails with the repeat error for line 30000, due date 2027-03-01 and earlier line 10000, and the lease's schedule and Months are unchanged.
