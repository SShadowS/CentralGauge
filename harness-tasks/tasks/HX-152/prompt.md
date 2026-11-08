# Task 5152: Automated tests for blocking a vehicle

Reported by Customer service.

Vehicles are blocked with `CGR Vehicle Blocking`.`BlockVehicle`, from the vehicle card and, since last month, by the maintenance robot, which runs without a user interface. Last week the robot blocked a car and silently deleted three customer bookings on it.

Before anyone changes the blocking we want automated tests that pin down how it must behave. Put them in a new test codeunit in the Test app. Do not fix the code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault. A faulty version counts as caught only when one of your tests fails on an assertion; a test that stops with an error does not catch it.

How blocking must behave (`CGR Vehicle Blocking` in Reporting, procedure `BlockVehicle(VehicleNo: Code[20]; Reason: Text[100])`; event `OnAfterBlockVehicle(Vehicle: Record "CGR Vehicle")`):

- A checked-out vehicle cannot be blocked: `Vehicle %1 is rented out.`
- A vehicle without Open contracts is blocked (Blocked = true, "Block Reason" = Reason). Its contracts with other statuses are not touched.
- After a vehicle is blocked, the fleet partner app is told (`OnAfterBlockVehicle`). The partner app may refuse with an error; then `BlockVehicle` fails with that error and nothing changes.
- A vehicle with Open contracts: at the vehicle card the user is asked `Vehicle %1 has %2 open contracts. Delete them and block the vehicle?`. Yes deletes those contracts and blocks the vehicle; No changes nothing.
- Without a user interface `BlockVehicle` never deletes bookings: it fails with `Vehicle %1 has open contracts. Block it from the vehicle card.` and nothing changes.

Write the test codeunit.
