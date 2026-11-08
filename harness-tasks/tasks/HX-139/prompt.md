# Task 8536: Automated tests for booking a vehicle return

Reported by the Rental desk.

Returns are booked at the desk (`CGR Return Desk`.`BookReturn`) and, since last month, also by the yard scanner app, which runs without a user interface. Returns booked by the scanner never charge excess kilometres.

Before anyone changes the return booking we want automated tests that pin down how it must behave. Put them in a new test codeunit in the Test app. Do not fix the code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault. A faulty version counts as caught only when one of your tests fails on an assertion; a test that stops with an error does not catch it.

How the return booking must behave (`CGR Return Desk` in Rental, procedure `BookReturn(ContractNo: Code[20]; ReturnKm: Integer)`):

- It returns the contract (`CGR Rental Mgt`.`Return`, no damage description).
- When the vehicle has damage entries that are not repaired, the person or device booking the return is always told: `Vehicle %1 has %2 open damages. Inspect it before it is rented again.` (vehicle, number of unrepaired damage entries). The scanner app shows these messages on its screen, so this message is shown with and without a user interface.
- When the km driven exceed the allowance (days x "Km Allowance per Day"; days = End Date - Start Date + 1), the excess is charged: one `CGR Return Excess Charge` row with the excess km and amount = excess km x "Excess Km Rate". At the desk, the user is asked first (`Charge %1 excess km?`, default Yes) and nothing is charged when the user answers No. Without a user interface the excess is always charged.
- Within the allowance, nothing is charged and nothing is asked.
