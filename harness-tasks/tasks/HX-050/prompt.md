# Task 7629: Days to the next planned service, and an early warning

Reported by Workshop planning.

Workshop planning wants to see how many days are left until a vehicle's next planned service, and to be warned when that service comes close. Today `CGR Service Plan Mgt` (Fleet) only says whether a service is due (`IsServiceDue`), and works out the date part of that answer on its own.

Requirement:

- Add to `CGR Service Plan Mgt` the procedure `DaysToPlannedService(VehicleNo: Code[20]; AtDate: Date; var Days: Integer): Boolean`. When the vehicle has a next planned service date (`NextServiceDate` is not blank), it returns true and Days is the number of days from AtDate to that date, negative when the date has passed. When the vehicle has no next planned service date, it returns false and Days is 0.
- Add to `CGR Service Plan Mgt` the procedure `IsServiceDueSoon(VehicleNo: Code[20]; AtDate: Date; WindowDays: Integer): Boolean`. It returns true when the next planned service date is at most WindowDays days after AtDate, also when that date has already passed. It returns false for a vehicle without a next planned service date.
- `IsServiceDue` answers its date rule with `DaysToPlannedService`: by date, a service is due when Days is 0 or less. This is a clean-up only: every result of `IsServiceDue` stays exactly as it is today, by km and by date.

Both new procedures are called for existing vehicles.
