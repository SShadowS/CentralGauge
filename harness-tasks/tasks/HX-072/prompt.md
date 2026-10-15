# Task 7783: Let partner apps add damage severities

Reported by the Workshop team.

Last sprint we shipped damage severities in Fleet. `CGR Damage Entry` got field 6 "Severity" (Enum `CGR Damage Severity`, values Minor and Major), and `CGR Damage Mgt` got `RegisterDamageWithSeverity(VehicleNo: Code[20]; Description: Text[100]; Severity: Enum "CGR Damage Severity"): Integer`. `RegisterDamage` registers a Major damage. A vehicle is blocked while it has an open damage that is not Minor.

Partner apps now want to add their own severities to `CGR Damage Severity`, and each partner app must decide whether an open damage of its severity blocks the vehicle. Today the decision is hard-coded as "not Minor" in the vehicle block subscriber and in RepairDamage, so every partner severity blocks.

Requirement:

- Add an interface `CGR Damage Severity Rule` to Fleet with the method `BlocksVehicle(): Boolean`. Every value of `CGR Damage Severity` provides it: Minor does not block, Major blocks. A partner app that adds a value to the enum provides its own implementation, and its answer decides for that severity.
- Add to `CGR Damage Mgt` the procedure `IsBlockingSeverity(Severity: Enum "CGR Damage Severity"): Boolean`, which returns what the severity's rule answers.
- Registering a damage and `RepairDamage` decide through IsBlockingSeverity instead of their own check. Open Damages still counts every open damage of the vehicle, whatever its severity. A vehicle is blocked while at least one of its open damages has a blocking severity; after a repair, a vehicle whose remaining open damages all have non-blocking severities is not blocked.
- Everything else stays as it is today: `RegisterDamage` registers a Major damage, a damaged return registers a damage, and the public procedures of `CGR Damage Mgt` keep their signatures.
