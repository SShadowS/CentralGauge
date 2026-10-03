# Task 7475: Keep the weekend rule in one place

Reported by the Platform team.

Which dates fall on a weekend is worked out in two places today: `CGR Working Days` (Core) and the weekend surcharge in `CGR Rental Pricing` (Rental) each calculate it from the date on their own. Other apps are about to need the same rule, and we want it defined once, in Core.

Requirement:

- Add to `CGR Working Days` the procedure `IsWeekend(CheckDate: Date): Boolean`. It returns true when CheckDate is a Saturday or a Sunday and false on every other day.
- `CGR Working Days` and the weekend surcharge in `CGR Rental Pricing` use IsWeekend instead of their own weekday calculation.
- This is a clean-up only. Every result stays exactly as it is today: invoice preview lines and totals, posted rental amounts, and what IsWorkingDay, WorkingDaysBetween and NextWorkingDay return.
