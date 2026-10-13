# Task 7706: Run an inspection day across several checkouts

Reported by the Front desk.

Last sprint we shipped desk inspections in Rental. `CGR Desk Inspection`.`CheckOutForInspection(ContractNo: Code[20])` checks out the vehicle of a contract also when the vehicle is blocked; the lending in `CGR Inspection Lending` makes the vehicle available for that one checkout. On inspection days the desk checks out a list of vehicles one after the other, in separate calls, and wants to start the inspection once for the whole list.

Requirement:

- Add to `CGR Desk Inspection` the procedure `StartInspection(VehicleNos: List of [Code[20]])`. It starts an inspection. Until the inspection ends, every listed vehicle that exists and is not checked out is available (`CGR Fleet Mgt`.`IsAvailable` returns true and the vehicle can be checked out), also when it is blocked. Every other vehicle is available or not exactly as today.
- Calling StartInspection while an inspection runs replaces the list of that inspection.
- Add `EndInspection()`. It ends the running inspection. When no inspection runs, it changes nothing and raises no error.
- Add `IsInspectionRunning(): Boolean`.
- An inspection belongs to the session: once started it stays running across calls until it is ended, and it can be started, ended and asked about through any `CGR Desk Inspection` variable.
- `CheckOutForInspection` keeps its signature and what it does, and runs through StartInspection and EndInspection. The desk only calls it while no inspection runs and for contracts that can be checked out.
