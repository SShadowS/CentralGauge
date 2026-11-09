# Task 5157: Automated tests for the yard finding tally

Reported by Fleet operations.

The number of open findings per vehicle on the yard board is wrong after the scanner import and after the nightly clean-up.

Before anyone changes the tally we want automated tests that pin down how it must behave. Put them in a new test codeunit in the Test app, plus any helper codeunits your tests need. Do not fix the code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault. A faulty version counts as caught only when one of your tests fails on an assertion; a test that stops with an error does not catch it.

How the tally must behave (`CGR Yard Finding Sync` in Fleet keeps `CGR Yard Finding Tally` up to date, event `OnVehicleClearOfFindings(VehicleNo: Code[20])`):

- `CGR Yard Finding Tally`."Open Findings" of a vehicle is the number of its `CGR Yard Finding` rows that are not Closed. The tally row is created when the vehicle's first finding that is not Closed arrives.
- The tally follows every finding that is created or deleted, however that is done. The scanner import writes findings without running table triggers, the desk with them; the nightly clean-up removes many at once, without running table triggers.
- A finding that is Closed when it is created or deleted does not change the tally.
- The desk keeps draft findings in a temporary record. A draft is not a finding and does not change the tally.
- When a vehicle's last open finding is deleted, partner apps are told, once, through OnVehicleClearOfFindings; not when open findings remain.
- A partner app may refuse with an error. Then the delete fails with that error and nothing changes: the finding is still there and the tally is unchanged.

Write the test codeunit and any helper codeunits.
