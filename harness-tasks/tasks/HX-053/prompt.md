# Task 7650: Automated tests for queueing and purging outbox messages

Reported by the Integration team.

Support wanted to requeue outbox messages that the partner endpoint had rejected, but the messages were gone: the nightly purge of sent messages had removed them, although they were never sent.

Before anyone changes the outbox code we want automated tests that pin down how queueing, marking, purging and requeueing outbox entries must behave. Put them in a new test codeunit in the Test app. Do not fix the outbox code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault.

How it must behave (`CGR Integration Facade`, procedures `QueueVehicleCheckedOut(VehicleNo: Code[20])`, `MarkSent(EntryNo: Integer)` and `PurgeSent()`; `CGR Outbox Dispatcher`, procedure `Requeue(EntryNo: Integer)`):

- QueueVehicleCheckedOut adds one unsent outbox entry: Event Type 'vehicleCheckedOut', the vehicle's number in "Vehicle No.", Payload `{"event":"vehicleCheckedOut","vehicleNo":"<vehicle no.>"}`, "Created At" set, 0 attempts, not failed.
- Checking out a rental contract (`CGR Rental Mgt`.CheckOut) queues exactly one such entry for the contract's vehicle. Returning the contract (`CGR Rental Mgt`.Return) queues nothing.
- MarkSent marks the entry as sent. For an entry number that does not exist it raises an error.
- PurgeSent deletes every sent entry and nothing else.
- Requeue makes a failed entry pending again: not failed, no attempts and no "Last Error".
