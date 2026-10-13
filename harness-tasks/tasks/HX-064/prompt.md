# Task 7727: Automated tests for the rental posting events

Reported by the Partner team.

A partner app extends some rental contracts by one day when they are posted: it subscribes to OnBeforePostRentalContract and moves the contract's End Date. Since the last update the posted contract and its ledger entry show the longer period, but the customer is charged for the original number of days.

Before anyone changes the posting code we want automated tests that pin down how posting and its events must behave. Put them in a new test codeunit in the Test app. Do not fix the posting code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault.

How it must behave (`CGR Rental Mgt`, procedure `Post(ContractNo: Code[20])`; `CGR Rental-Post`, events `OnBeforePostRentalContract(var RentalContract: Record "CGR Rental Contract")` and `OnAfterPostRentalContract(var RentalContract: Record "CGR Rental Contract"; Amount: Decimal)`):

- Post refuses a contract whose status is not Returned with `Rental contract <contract no.> must be returned before it is posted.` A refused posting raises neither posting event.
- For a returned contract, OnBeforePostRentalContract is raised first. The contract as the subscribers leave it is what gets priced and posted.
- Posting creates one rental ledger entry for the contract: the contract's vehicle, Posting Date = the contract's End Date, Amount = the contract's price (`CGR Rental Pricing`.CalcAmount), and Km Driven = the contract's Return Km minus its Start Km.
- The contract's status becomes Posted.
- OnAfterPostRentalContract is raised once, with the posted amount, after the contract is stored as Posted and its ledger entry exists.
