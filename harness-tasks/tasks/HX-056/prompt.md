# Feature 7671: Every outbox message carries a correlation number

Reported by the Integration team.

Partner systems that receive our outbox messages cannot match a message to their own log. Every outbox message must carry a correlation number, and partner apps want to see that number the moment the entry is queued.

Requirement:

- A new field `"Correlation No."` (field 11, BigInteger) on `CGR Outbox Entry` (70401).
- Every entry `QueueVehicleCheckedOut` of `CGR Integration Facade` (70400) queues gets a correlation number, in `"Correlation No."` and in its payload, which becomes `{"event":"vehicleCheckedOut","vehicleNo":"<vehicle no.>","correlationNo":<correlation no.>}` with the number as a JSON number.
- Correlation numbers are positive, unique, and increase in the order the entries are queued.
- A correlation number is never handed out twice, also when the transaction that queued the entry fails afterwards: a partner may already have seen the number.
- After the entry is stored, `CGR Integration Facade` raises a new integration event `OnAfterQueueEntry(var Entry: Record "CGR Outbox Entry")` with it, so partner apps can record the number at once.
- Queueing commits nothing: when the caller's transaction fails, neither the queued entry nor anything else the caller wrote in that transaction is kept.
- `VehicleCheckedOutPayload` stays exactly as it is today (no correlation number). Everything else, including checkout and dispatch, works as today.
