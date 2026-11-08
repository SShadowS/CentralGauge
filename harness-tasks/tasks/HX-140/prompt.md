# Task 8622: Automated tests for the telematics sync

Reported by Fleet operations.

The telematics partner receives vehicle data from `CGR Telematics Sync`: one vehicle at a time from the vehicle card, and the whole fleet from the "Sync all" action. Since a full sync failed on Monday morning, every vehicle sent from the card for the rest of the day arrived at the partner marked as part of a batch, and the next "Sync all" failed at once.

Before anyone changes the sync we want automated tests that pin down how it must behave. Put them in a new test codeunit in the Test app. Do not fix the code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault. A faulty version counts as caught only when one of your tests fails on an assertion; a test that stops with an error does not catch it.

How the sync must behave (`CGR Telematics Sync` in Fleet, procedures `SyncVehicle(VehicleNo: Code[20])` and `SyncAll(): Integer`, events `OnSendVehicle(VehicleNo: Code[20]; Payload: JsonObject)` and `OnBatchCompleted(VehicleCount: Integer)`):

- SyncVehicle sends one payload with the vehicle number (`"vehicleNo"`) through OnSendVehicle. The partner app subscribed to OnSendVehicle may refuse a vehicle by raising an error; then SyncVehicle fails with that error.
- SyncAll sends every vehicle that is not Blocked, in vehicle number order, each payload marked `"batch": true`. It then raises OnBatchCompleted with the number of vehicles sent, and returns that number.
- When the partner refuses a vehicle during SyncAll, SyncAll stops at that vehicle with the partner's error, and OnBatchCompleted is not raised.
- A payload sent by SyncVehicle on its own carries no batch mark, also after a SyncAll that failed.
- SyncAll can be run again in the same session after it failed.
