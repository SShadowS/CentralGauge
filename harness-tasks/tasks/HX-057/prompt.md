# Bug 7678: Utilisation report leaves out idle vehicles

Reported by Fleet controlling.

Last sprint we shipped the fleet utilisation report in Reporting: table `CGR Utilisation Buffer` (70513), query `CGR Vehicle Utilisation` (70514) and codeunit `CGR Fleet Utilisation` (70515) with `FillUtilisation(VehicleFilter: Text; var Buffer: Record "CGR Utilisation Buffer" temporary)`. FillUtilisation fills the buffer with one line per vehicle whose "No." matches VehicleFilter, with the number of the vehicle's rentals in Rentals and its revenue in Revenue.

Observed: vehicles that were never rented are missing from the buffer. With V-1 rented twice and V-2 never rented, the report lists only V-1.

Expected: the buffer has one line for every vehicle in the filter, also for a vehicle that was never rented (Rentals 0, Revenue 0). Rentals is the number of the vehicle's `CGR Rental Ledger Entry` rows, also entries with an amount of 0 and refunds (negative amounts); Revenue is the sum of their amounts. After a fill the buffer holds only the lines of that fill. Keep the signature of FillUtilisation.

Reproduction:

1. Create vehicles V-1 and V-2.
2. Insert two rental ledger entries for V-1 with amounts 100 and 50; none for V-2.
3. Call FillUtilisation('V-*', Buffer).
4. The buffer holds one line, V-1 with Rentals 2 and Revenue 150. Expected: also a line V-2 with Rentals 0 and Revenue 0.
