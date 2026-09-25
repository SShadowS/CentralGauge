# Bug 4127: Damaged returns do not block the vehicle

Reported by the front desk, Aarhus branch.

When the clerk records damage while returning a rental vehicle, the damage entry is created, but the vehicle is not blocked and its "Open Damages" count stays at 0. The vehicle then shows as available, and one has already been rented out again with the damage still open.

Expected: a return with damage completes like any other return (the contract is returned and the vehicle is back with the return mileage), and the vehicle is blocked, with the damage counted as open, until the damage is repaired.

To reproduce: create a rental contract, check it out, return it with a damage description (`CGR Rental Mgt`, Return), then look at the vehicle.
