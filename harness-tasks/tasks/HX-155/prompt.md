# Task 5155: Automated tests for the fuel charge

Reported by the Rental desk.

When a car comes back with less than a full tank, the customer pays for the missing fuel (`CGR Fuel Charge`.`ChargeFuel`). At the desk the agent picks the fuel level from a menu. Returns booked by the yard scanner, which runs without a user interface, never charge fuel, although the telematics app knows the level.

Before anyone changes the fuel charge we want automated tests that pin down how it must behave. Put them in a new test codeunit in the Test app. Do not fix the code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault. A faulty version counts as caught only when one of your tests fails on an assertion; a test that stops with an error does not catch it.

How the fuel charge must behave (`CGR Fuel Charge` in Rental, procedure `ChargeFuel(ContractNo: Code[20])`; event `OnGetFuelLevel(VehicleNo: Code[20]; var LevelPct: Integer)`):

- Only Returned contracts are charged; charging any other contract is refused with an error. Each contract is charged at most once.
- At the desk the agent picks the level: Full, Three quarters, Half, Quarter, Empty (100, 75, 50, 25, 0 %). Cancelling the menu charges nothing.
- Without a user interface the level comes from the telematics app (OnGetFuelLevel sets LevelPct). When no app gives a level, nothing is charged.
- Below 100 %, one `CGR Fuel Charge Entry` is written: litres = (100 - level) % of the vehicle's "Tank Litres", amount = litres x "Fuel Price per Litre" (`CGR Setup`), rounded to 0.01. At 100 % nothing is written.

Write the test codeunit.
