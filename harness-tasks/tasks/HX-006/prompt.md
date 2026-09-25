# Feature 4262: Tell the partner portal about returns, in order

The partner portal gets a message in the integration outbox when a vehicle is checked out. It also needs to know when a vehicle comes back, and it processes messages per vehicle, so it needs their order.

1. When a rental vehicle is returned, queue an outbox entry with Event Type "vehicleReturned" and this JSON payload:
   `{"event":"vehicleReturned","vehicleNo":"<No.>","returnKm":<km>,"damage":<true|false>,"damageDescription":"<text>","sequence":<n>}`
   "returnKm" and "sequence" are JSON numbers and "damage" a JSON boolean. "damageDescription" is present only when damage was reported.
2. Every outbox entry of a vehicle, checkouts and returns alike, carries a sequence number per vehicle: 1 for the first message of that vehicle, then 2, 3 and so on in the order the events happened. Store it in a new field "Vehicle Sequence No." (Integer) on the outbox entry and in the payload's "sequence". The checkout payload becomes `{"event":"vehicleCheckedOut","vehicleNo":"<No.>","sequence":<n>}`. Payloads are compact JSON (no formatting whitespace between tokens; text values keep their own spaces) with the keys in the order shown.
3. Sent entries are purged regularly (`CGR Integration Facade`, PurgeSent). Purging does not restart the numbering of a vehicle.
