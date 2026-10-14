# Task 7615: One Fleet procedure releases a returned vehicle

Reported by the Fleet team.

When a rental contract is returned, `CGR Fleet Return Handler` releases the vehicle with its own code. Other Fleet processes need to release vehicles the same way, and the desk wants to see on a vehicle which damage it came back with last.

Requirement:

- Add the field 12 "Last Damage Entry No." (Integer) to `CGR Vehicle`.
- Add to `CGR Fleet Mgt` the procedure `ReleaseVehicle(VehicleNo: Code[20]; ReturnKm: Integer; DamageDescription: Text[100])`. The vehicle is no longer checked out and its Mileage becomes ReturnKm. When DamageDescription is not empty, the damage is registered as `CGR Damage Mgt`.RegisterDamage registers it (a damage entry, the vehicle blocked, one more open damage), and "Last Damage Entry No." holds the number of that damage entry. When DamageDescription is empty, "Last Damage Entry No." is 0.
- When VehicleNo is not a vehicle, ReleaseVehicle changes nothing and raises no error.
- The return handler in `CGR Fleet Return Handler` releases returned vehicles through ReleaseVehicle.
- Everything else a return does stays exactly as today.
