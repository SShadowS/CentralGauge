# Task 6942: Automated tests for the check-out SMS

Reported by Customer service.

When a desk agent checks out a vehicle, the customer gets an SMS "Your car <vehicle> is ready." when the agent closes the contract card. Customers whose check-out failed (vehicle blocked, key box refused) still get the SMS and walk to the car park for a car they cannot have.

Before anyone changes the SMS handling we want automated tests that pin down how it must behave. Put them in a new test codeunit in the Test app. Do not fix the code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault. A faulty version counts as caught only when one of your tests fails on an assertion; a test that stops with an error does not catch it.

How it must behave (`CGR Checkout SMS` in Rental: `CheckOutAndNotify(ContractNo: Code[20])`, `Flush(): Integer`, `PendingCount(): Integer`, `Reset()`; gateway event `OnSendSms(ContractNo: Code[20]; MessageText: Text)` on `CGR SMS Send`):

- A successful check-out queues exactly one SMS for its contract. A check-out that fails (any error, including a refusal by the key box app, which subscribes to `OnAfterVehicleCheckedOut` on `CGR Core Events`) fails with that error and queues nothing.
- Queued SMS are kept for the session (they are not stored in the database) until `Flush()`. The contract card calls Flush when it closes, after its own changes are committed.
- Flush sends every queued SMS through OnSendSms. A sent SMS leaves the queue. When the SMS gateway app refuses one (error), that SMS stays queued and Flush continues with the next. Flush returns the number sent.
- `Reset()` drops the queue (called at logout).
