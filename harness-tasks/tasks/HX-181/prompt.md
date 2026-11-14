# Task 5181: Run the damage audit for many vehicles at once

Requested by Fleet operations.

The damage audit, `CGR Fleet Audit`.AuditVehicle in the Fleet app, lists the open damages of one vehicle as of an audit date in a temporary `CGR Fleet Audit Finding` list, one finding per damage entry; the work is done by `CGR Vehicle Audit Check`. Before the season starts, the fleet team wants to audit a whole group of vehicles with one call, and to see at the end which vehicles could not be audited and why.

New procedure in `CGR Fleet Audit`:

- `procedure AuditVehicles(var Vehicle: Record "CGR Vehicle"; AuditDate: Date; var Finding: Record "CGR Fleet Audit Finding" temporary; var CheckErrors: Dictionary of [Code[20], Text])`

Every vehicle that the filters on Vehicle select goes through `CGR Vehicle Audit Check` for AuditDate, and Finding ends up with the findings AuditVehicle would give for those vehicles. A vehicle the check cannot finish does not end the run: the run goes on with the next vehicle and records the vehicle number in CheckErrors, with the message the check stopped on. CheckErrors names no other vehicle. In Finding, a vehicle that is in CheckErrors shows no findings at all, also when the check had found open damages for it before it stopped, so the team never acts on half an audit.

`CGR Vehicle Audit Check` and AuditVehicle stay unchanged.
