# Bug 7365: Registering a service released a damaged vehicle

Reported by the workshop, Aarhus.

Since last sprint a vehicle can be blocked for two reasons. It has an open damage (registering a damage blocks it, repairing the last open damage releases it), or it is due for service (the workshop runs `CGR Service Block Mgt`, BlockDueVehicles, which blocks every vehicle that is due; registering a service with `CGR Service Plan Mgt`, RegisterService, releases it again).

Observed:

- A vehicle with an open damage was serviced. Registering the service released it, and it went out on a rental with the damage still open.
- After the last damage of a vehicle was repaired, the vehicle was released although it was due for service, and it went out on a rental before its service.
- A vehicle blocked as due was serviced late: the service was registered at a mileage that did not cover the current interval, and the vehicle was released while it was still due.

Expected:

- A vehicle stays blocked as long as it has an open damage or is due for service on the work date. "Due" means due by the same rules BlockDueVehicles applies.
- Registering a service and repairing a damage release the vehicle only when neither reason remains. When neither remains, they release it as they do now.

Reproduction:

1. Register a damage on an available vehicle that is not due for service. The vehicle is blocked.
2. Register a service for the vehicle at its current mileage.
3. The vehicle is no longer blocked and can be checked out on a rental contract. Expected: it stays blocked until the damage is repaired.
