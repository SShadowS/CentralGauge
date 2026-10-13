# Bug 7524: Group availability shows our own numbers for every sister company

Reported by Group fleet desk.

Last sprint we shipped the codeunit `CGR Group Availability` (Rental). The group fleet desk calls `AvailableVehicles(CompanyName: Text[30]): Integer` with the name of a company in our database to see how many vehicles that company can rent out right now.

Observed since go-live, when the desk asks for our sister company:

- A vehicle that exists only in the sister company is never counted.
- A vehicle that is checked out in the sister company is counted when our vehicle with the same number is free.
- The sister company has stopped rentals in its Setup, but the desk still sees available vehicles there. On a day when we had stopped rentals and the sister company had not, the desk saw 0 for the sister company.

Expected:

- `AvailableVehicles` returns the number of vehicles of the named company that are neither checked out nor blocked in that company.
- It returns 0 when that company has "Suspend Rentals" set in its Setup. A company without a Setup record has not suspended rentals.
- The same rules apply when the desk passes our own company name.
- Asking for the figures changes no data in any company.

Reproduction (run in our company, both companies with "Suspend Rentals" off):

1. In our company: vehicle A free, vehicle B checked out, vehicle C blocked.
2. In the sister company: vehicle A checked out, vehicles B, C and D free (neither checked out nor blocked).
3. `AvailableVehicles(<sister company name>)` counts only A from these vehicles; expected B, C and D (3).
4. `AvailableVehicles(<our company name>)` counts A (1), which is correct.
