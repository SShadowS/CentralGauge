# Feature 7433: Re-register a vehicle under its new plate number

Reported by the Fleet office.

When a vehicle gets new plates, its vehicle number (`CGR Vehicle`, "No.") has to change. Today we create a second vehicle card, retype its data and lose the link to everything already recorded under the old number.

Add this procedure to `CGR Fleet Mgt` (Fleet):

- `procedure ChangeVehicleNo(OldNo: Code[20]; NewNo: Code[20])`

Expected behaviour:

- Afterwards the vehicle exists only under NewNo and keeps all of its data (mileage, maintenance strategy, service plan, last service, daily rate, description, blocked state and open damages).
- Every record that refers to the vehicle carries NewNo: rental contracts, rental ledger entries, damage entries, lease contracts, lease invoice lines and outbox entries, including outbox entries that were already sent. Payload texts already written to outbox entries stay as they are.
- Records of other vehicles are not changed.
- When NewNo is already the number of a vehicle, ChangeVehicleNo fails with the error `Vehicle <NewNo> already exists.` (for example `Vehicle V-200 already exists.`) and changes nothing.
