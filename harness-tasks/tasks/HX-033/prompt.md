# Feature 7510: Shift handover: which vehicles came back on my shift

Reported by the Front desk, Aarhus.

At shift handover the desk wants to see which vehicles came back during the shift and which of them came back damaged, so the next shift knows what to inspect. Today the desk has to search the rental contracts by hand.

Add a new codeunit `CGR Shift Returns` (Rental) with these procedures:

- `procedure ReturnedVehicles(var VehicleNos: List of [Code[20]])`
- `procedure DamagedVehicles(var VehicleNos: List of [Code[20]])`
- `procedure ClearShift()`

Expected behaviour:

- ReturnedVehicles gives the numbers of the vehicles returned through `CGR Rental Mgt` (Return) in this session, in the order of their first return. A vehicle returned more than once is listed once.
- DamagedVehicles gives the vehicles that were returned with a damage description, by the same rules.
- Each call replaces the content of VehicleNos with the current list.
- The list a caller gets is its own: changing it does not change the shift's lists, and vehicles returned later do not appear in a list that was filled earlier.
- Every `CGR Shift Returns` variable in the session reports the same lists; other sessions keep their own.
- ClearShift empties both lists, for the start of the next shift.
- Returning a vehicle otherwise behaves as today.
