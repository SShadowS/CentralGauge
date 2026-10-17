# Bug 7867: Working-day due dates skip the 6th and 7th of the month

Reported by Group finance.

Last sprint we added `AddWorkingDays(FromDate: Date; Days: Integer): Date` to codeunit `CGR Working Days` (Core). Finance uses it to set due dates a number of working days after a start date.

Observed: the due dates are wrong. Some land on a Saturday or a Sunday, and the 6th and 7th of every month are never counted as working days.

Expected: AddWorkingDays returns the Days-th working day after FromDate, where a working day is what `IsWorkingDay` says (not a Saturday, not a Sunday, not a `CGR Non-Working Day`). Days = 0 returns FromDate unchanged, also when FromDate is not a working day. A negative Days fails with the error 'The number of working days to add must not be negative.'. Keep the signature of AddWorkingDays and the behaviour of the other procedures of the codeunit.

Reproduction (no non-working days entered for July 2027):

1. `AddWorkingDays(20270705D, 2)` (Monday 5 July 2027) returns 9 July 2027. Expected: Wednesday 7 July 2027.
2. `AddWorkingDays(20270709D, 1)` (Friday 9 July 2027) returns Saturday 10 July 2027. Expected: Monday 12 July 2027.
