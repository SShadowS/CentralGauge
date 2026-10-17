# Task 7874: One codeunit mirrors desk events to the partner portal

Reported by the Integration team.

Last sprint we shipped two mirrors in Integration that copy desk events to the partner portal through the outbox. `CGR Checkout Mirror` (`StartCheckoutMirror()`, `StopCheckoutMirror()`, `IsCheckoutMirrorOn(): Boolean`) queues a 'mirrorCheckOut' entry for every vehicle checkout, and `CGR Return Mirror` (`StartReturnMirror()`, `StopReturnMirror()`, `IsReturnMirrorOn(): Boolean`) queues a 'mirrorReturn' entry for every vehicle return. We want the mirroring in one place.

Requirement:

- Add the codeunit `CGR Desk Mirror` (ID 70429) in Integration with the procedures `SetCheckoutMirror(On: Boolean)`, `SetReturnMirror(On: Boolean)`, `IsCheckoutMirrorOn(): Boolean` and `IsReturnMirrorOn(): Boolean`.
- While the checkout mirror is on, every vehicle checkout queues one 'mirrorCheckOut' entry. While the return mirror is on, every vehicle return queues one 'mirrorReturn' entry. A mirror that is off queues nothing.
- The two mirrors are switched on and off independently and can both be on at the same time. Switching on a mirror that is already on, or switching off a mirror that is already off, changes nothing and raises no error.
- The mirrors belong to the session: once switched on, a mirror stays on across calls until it is switched off, and it can be switched and asked about through any variable.
- `CGR Checkout Mirror` and `CGR Return Mirror` keep their public procedures and what they do, and work through `CGR Desk Mirror`.
- The mirror entries keep their shape: Event Type, Vehicle No., the payload `{"event":"<event type>","vehicleNo":"<vehicle no.>"}` and Created At. Everything else stays as it is today.
