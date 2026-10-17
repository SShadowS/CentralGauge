# Task 7881: The support page takes the same vehicle snapshots as the fleet board

Reported by the Fleet team.

Last sprint we shipped `CGR Fleet Board` in Fleet. Its procedures `SnapshotFreeVehicles(var Board: Record "CGR Vehicle" temporary): Integer` and `SnapshotDamagedVehicles(var Board: Record "CGR Vehicle" temporary): Integer` fill a temporary board with the free vehicles and the damaged vehicles. The support page needs snapshots of other vehicle selections, and it should take them the same way as the fleet board does.

Requirement:

- Add to `CGR Fleet Board` the public procedure `TakeVehicleSnapshot(var VehicleFilter: Record "CGR Vehicle"; var Board: Record "CGR Vehicle" temporary): Integer`.
- TakeVehicleSnapshot adds to Board a copy of every vehicle that matches the filters on VehicleFilter, with all its fields, and returns how many vehicles it copied.
- A vehicle that is already on Board is replaced by its current values, and it counts as copied. Rows of other vehicles on Board stay on Board as they are.
- Filters the caller has set on Board do not limit what is added, and they are still set after the call, unchanged. The filters on VehicleFilter are not changed either.
- A snapshot shows the vehicles as they were when it was taken.
- `SnapshotFreeVehicles` and `SnapshotDamagedVehicles` take their snapshots through TakeVehicleSnapshot. What they return and what they leave on Board stays as it is today.
