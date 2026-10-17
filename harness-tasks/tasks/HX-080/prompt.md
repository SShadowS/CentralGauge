# Feature 7839: Which vehicles were serviced in a period

Reported by Workshop planning.

When we plan the next workshop round we need to know which vehicles were serviced in a given period. Every vehicle keeps the date of its last service in "Last Service Date" on `CGR Vehicle` (set by `CGR Service Plan Mgt`, RegisterService). Vehicles that were never serviced have no Last Service Date.

Requirement:

- New query 70520 `CGR Service Date List` in the Reporting app, over `CGR Vehicle`, with the columns:
  - `VehicleNo`: the vehicle's "No.",
  - `ServicePlanCode`: its "Service Plan Code",
  - `LastServiceDate`: its "Last Service Date".
- The query has a filter `ServiceDateFilter` on "Last Service Date", so a caller can restrict it with `SetRange(ServiceDateFilter, ...)`.
- New codeunit 70521 `CGR Service Date Report` in the Reporting app with
  `procedure ListServicedBetween(FromDate: Date; ToDate: Date; var VehicleNos: List of [Code[20]]): Integer`.
  - Afterwards VehicleNos holds exactly the numbers of the vehicles whose Last Service Date is on or after FromDate and on or before ToDate. Whatever VehicleNos held before the call is gone.
  - It returns how many vehicles it listed.
  - A FromDate of 0D means the period has no lower limit.
  - Vehicles that were never serviced are never listed.
  - The order of the list does not matter.
- Callers always pass a ToDate that is a real date and never before FromDate.
