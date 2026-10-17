# Task 7797: One availability check for checkouts and swaps

Reported by Front desk.

A checkout and a vehicle swap in `CGR Rental Mgt` (Rental) do not agree on which vehicles are available. A checkout asks Fleet, so the rental stop in CGR Setup and partner apps that decide availability through Fleet are respected. A swap decides on its own. Two cases from the desk this week: while rentals were suspended, a contract was still swapped to another vehicle; and a blocked demo vehicle that our partner app lends out could be checked out but a swap to it was refused. We want one availability check that both use.

Requirement:

- Add to `CGR Rental Mgt` the public procedure `CheckVehicleAvailable(VehicleNo: Code[20])`. It does nothing when the vehicle is available as `CGR Fleet Mgt`.IsAvailable (Fleet) decides it, and otherwise fails with the error 'Vehicle %1 is not available.', where %1 is the vehicle number. A vehicle that does not exist is not available.
- CheckOut and SwapVehicle decide whether a vehicle is available only through CheckVehicleAvailable.
- SwapVehicle keeps the order of its checks: a contract that is not checked out is refused with its status error first; then a new vehicle that does not exist is refused with the platform's error for a record that does not exist; only then is availability checked.
- Everything else CheckOut and SwapVehicle do stays as it is today.
