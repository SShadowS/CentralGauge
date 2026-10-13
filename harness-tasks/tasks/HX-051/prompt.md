# Task 7636: Automated tests for availability and checkout

Reported by Front desk.

A partner app lets the front desk lend blocked demo cars to customers: it subscribes to the OnBeforeIsAvailable event of `CGR Fleet Mgt` and answers that such a car is available. Since the last update the desk cannot check out a blocked demo car any more; the checkout says the vehicle is not available, as if the partner app were not installed.

Before anyone changes the availability code we want automated tests that pin down how vehicle availability and checkout must behave. Put them in a new test codeunit in the Test app. Do not fix the availability or checkout code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault.

How it must behave (`CGR Fleet Mgt`, procedure `IsAvailable(VehicleNo: Code[20]): Boolean` and event `OnBeforeIsAvailable(VehicleNo: Code[20]; var Result: Boolean; var IsHandled: Boolean)`; `CGR Rental Mgt`, procedure `CheckOut(ContractNo: Code[20])`):

- IsAvailable lets extensions decide first, through OnBeforeIsAvailable. When an extension handles the question, its result is the answer, for any vehicle number: also for a vehicle that does not exist, is blocked or is checked out.
- When no extension handles it, a vehicle is available when it exists and is neither checked out nor blocked.
- While "Suspend Rentals" is set in CGR Setup, no vehicle is available: IsAvailable answers false, and so checkout refuses every vehicle. When there is no CGR Setup record, rentals are not suspended. Which answer wins while rentals are suspended and another extension also handles the question is not defined.
- CheckOut checks out only a rental contract with status Open; for a contract with any other status it fails with `Rental contract <contract no.> must have status Open.`
- CheckOut checks out only an available vehicle (as IsAvailable answers for the contract's vehicle); otherwise it fails with `Vehicle <vehicle no.> is not available.`
- A checkout sets the contract's Start Km to the vehicle's mileage and its status to Checked Out, and marks the vehicle checked out.
