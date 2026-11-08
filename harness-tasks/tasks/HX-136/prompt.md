# Task 6274: Automated tests for vehicle transfers between branches

Reported by Fleet operations.

Last sprint we shipped the branch transfer: `CGR Branch Transfer`.`TransferVehicle` creates a zero-price transfer contract for the target branch. Since then some desk users find that contracts they create later in the day belong to another branch.

Before anyone changes the transfer we want automated tests that pin down how it must behave. Put them in a new test codeunit in the Test app. Do not fix the code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault. A faulty version counts as caught only when one of your tests fails on an assertion; a test that stops with an error does not catch it.

How the transfer must behave (`CGR Branch Transfer` in Rental, procedure `TransferVehicle(VehicleNo: Code[20]; TargetBranch: Code[10]; TransferDate: Date): Code[20]`, event `OnAfterCreateContract(var Contract: Record "CGR Rental Contract")` on `CGR Rental Mgt`):

- It creates a rental contract for the vehicle with Customer Name `TRANSFER`, Start Date and End Date = TransferDate, Pricing Method Zero and Branch Code = TargetBranch, and returns its number.
- Partner apps subscribed to `OnAfterCreateContract` are told about the transfer contract, and when they are told it already belongs to the target branch. A partner app may refuse with an error; then TransferVehicle fails with that error and no transfer contract exists.
- The user's own branch is not changed by a transfer: contracts the user creates afterwards in the same session (`CGR Rental Mgt`.`CreateContract`) belong to the branch they belonged to before. A user who has no branch set keeps using the setup's Default Branch Code, also when it is changed later.
