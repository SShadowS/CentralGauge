# Feature 7418: Pause outbox messages while we migrate the fleet

Reported by the Integration team.

During the fleet migration our scripts check vehicles out and in by the hundred. Every checkout queues a `vehicleCheckedOut` message in the outbox (`CGR Outbox Entry`), and the partner endpoint must not receive any of them. The migration needs to switch queueing off for its own session and back on when it is done.

Add these procedures to `CGR Integration Facade` (Integration):

- `procedure SuspendQueueing()`
- `procedure ResumeQueueing()`
- `procedure QueueingSuspended(): Boolean`

Expected behaviour:

- While queueing is suspended in a session, that session queues no outbox entry: not for a checkout, and not when code calls `QueueVehicleCheckedOut` directly. QueueingSuspended returns true while queueing is suspended in the session.
- Suspensions nest, because a migration step that suspends and resumes may run inside a larger run that has already suspended: after two calls of SuspendQueueing, queueing resumes only after two calls of ResumeQueueing. ResumeQueueing while queueing is not suspended does nothing.
- Queueing stays suspended until it is resumed, also when the migration step that suspended it fails and its changes are rolled back.
- Only the session that suspended queueing is affected; other users keep queueing as usual.
- Without a suspension, checkouts and direct calls queue exactly as today.
