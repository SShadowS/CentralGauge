# Bug 7762: Bulk checkout messages fail as soon as two vehicles are listed

Reported by the Integration team.

Last sprint we shipped bulk checkout messages: `CGR Outbox Bulk Queue` (Integration) has `QueueCheckedOutVehicles(VehicleNos: List of [Code[20]]): Integer`, which queues one 'vehicleCheckedOut' outbox entry for each listed vehicle and returns the number of entries it queued.

Observed: queueing a single vehicle works, but as soon as the list holds two different vehicle numbers the call fails and queues nothing.

Expected: one pending 'vehicleCheckedOut' outbox entry per vehicle in the list, queued in list order, each with the vehicle's number in Vehicle No. and the payload `CGR Integration Facade`.VehicleCheckedOutPayload gives for that vehicle (pending like any other queued outbox entry: not sent, not failed, no attempts, no error). A vehicle listed more than once is queued once. A blank number in the list is skipped (no entry, not counted). An empty list queues nothing. The result is the number of entries queued. Messages queued earlier for the same vehicle do not matter: the vehicle is queued again. Everything else `QueueCheckedOutVehicles` does stays as it is today.

Reproduction:

1. Build a list with the vehicle numbers V-1 and V-2.
2. Call `QueueCheckedOutVehicles` with that list. It fails with "The record in table CGR Outbox Entry already exists. Identification fields and values: Entry No.='0'" and no outbox entry is queued. Expected: it returns 2, with one 'vehicleCheckedOut' entry for V-1 followed by one for V-2.
