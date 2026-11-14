# Task 5181: Audit a selection of vehicles in one run

Requested by Fleet operations.

Before each season, fleet operations audit the vehicles they look after. Today they do it one vehicle at a time with `CGR Fleet Audit`.AuditVehicle in the Fleet app, which runs `CGR Vehicle Audit Check` for the vehicle on an audit date and returns its findings in a temporary `CGR Fleet Audit Finding` list. For the whole fleet that takes them a day, so they want the audit for a selection of vehicles in one run.

Add this procedure to `CGR Fleet Audit`:

- `procedure AuditVehicles(var Vehicle: Record "CGR Vehicle"; AuditDate: Date; var Finding: Record "CGR Fleet Audit Finding" temporary)`

For every vehicle in the caller's selection, the finding list holds the findings that `CGR Vehicle Audit Check` gives for that vehicle on AuditDate, as AuditVehicle lists them; a vehicle without findings has no line. Each vehicle is audited on its own, so a vehicle whose check fails does not stop the run: for that vehicle the finding list holds a single line, Line No. 0 with Check Failed set and the check's error text as its Finding, and none of the findings the check had already reported for it before it failed. The other vehicles keep their findings.

Keep `CGR Vehicle Audit Check` and AuditVehicle as they are.
