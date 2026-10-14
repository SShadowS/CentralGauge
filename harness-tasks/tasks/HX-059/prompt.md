# Bug 7692: After a failed repair batch the desk cannot rent the vehicles until tomorrow

Reported by the Front desk.

Last sprint we shipped the workshop repair run in Fleet. Codeunit `CGR Workshop Repair Run` has `RepairBatch(EntryNos: List of [Integer])`, which repairs a batch of damage entries. While a batch runs, the single-instance codeunit `CGR Workshop Hold` (`HoldVehicles(VehicleNos: List of [Code[20]])`, `ReleaseAll()`, `IsHeld(VehicleNo: Code[20]): Boolean`) keeps the vehicles of the batch away from the desk.

Observed: the workshop's batch with the damage entries of V-3 (already repaired) and V-4 failed on an unknown entry number. For the rest of the day V-3, which has no open damage, is not available at the desk, and the next repair batch fails with `The binding of codeunit 70117 was unsuccessful. The codeunit has already been bound.`

Expected:

- While a batch runs, the vehicles of its entries are held: `IsHeld` returns true for them and `CGR Fleet Mgt`.`IsAvailable` returns false. Other vehicles are available or not as before.
- Every entry of the batch is repaired as `CGR Damage Mgt`.`RepairDamage` repairs it. Repairing an entry that is already repaired changes nothing.
- The hold ends when the batch ends, also when the batch fails.
- A batch that fails (an unknown entry number, or an extension that refuses one of the repairs) fails with that error and keeps none of its repairs.
- After a failed batch the next batch works as usual.
- An empty batch changes nothing.

Batches are never started from inside another batch.

Reproduction:

1. Vehicle V-3 with one damage entry that is already repaired; V-3 is available.
2. Call `RepairBatch` with that entry number and a number that no damage entry has. It fails with the error that the damage entry does not exist.
3. Afterwards `IsHeld('V-3')` returns true and `IsAvailable('V-3')` returns false.
4. Call `RepairBatch` with the open damage entry of another vehicle. It fails with the binding error above.

Expected: after step 2, V-3 is available and not held, and step 4 repairs the entry.
