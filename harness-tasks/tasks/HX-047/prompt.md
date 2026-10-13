# Bug 7608: Batched checkout messages all name the same vehicle

Reported by the Integration team.

Last sprint we shipped batched outbox messages: `CGR Outbox Batcher` (Integration) has `QueueVehicleBatch(VehicleNos: List of [Code[20]]): Integer`, which splits the given vehicle numbers into groups of at most three, queues one outbox entry per group (Event Type 'vehicleBatch', no Vehicle No., Payload `{"event":"vehicleBatch","vehicleNos":[...]}`) and returns the number of entries it queued.

Observed: the queued messages do not list the vehicles of their group.

- A batch of the seven vehicles V-1 to V-7 queues three messages, and each of them lists only V-7.
- A batch of six vehicles queues two messages that list no vehicle at all.

Expected: one message per group of at most three vehicles, in the order the vehicles were given (V-1 to V-3, V-4 to V-6, V-7), each listing exactly the vehicles of its group in that order. An empty batch queues nothing and returns 0. The queued entries are pending like any other queued outbox entry (not sent, not failed, no attempts, no error). Everything else `QueueVehicleBatch` does stays as it is today.

Reproduction:

1. Build a list with the vehicle numbers V-1, V-2, V-3, V-4, V-5, V-6 and V-7.
2. Call `QueueVehicleBatch` with that list. It returns 3.
3. Read the three 'vehicleBatch' outbox entries in Entry No. order. Each Payload's `vehicleNos` is `["V-7"]`. Expected: `["V-1","V-2","V-3"]`, `["V-4","V-5","V-6"]` and `["V-7"]`.
