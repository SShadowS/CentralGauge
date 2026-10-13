# Task 7566: Automated tests for swaps and returns at the desk

Reported by Front desk.

Last week the desk swapped a customer into a vehicle that still had open damage, in the middle of a running rental. Nobody noticed until the customer brought it back.

Before anyone changes the rental code we want automated tests that pin down how swapping and returning a rental must behave. Put them in a new test codeunit in the Test app. Do not fix the rental code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault.

How it must behave (`CGR Rental Mgt`, procedures `SwapVehicle(ContractNo: Code[20]; NewVehicleNo: Code[20])` and `Return(ContractNo: Code[20]; ReturnKm: Integer; DamageDescription: Text[100])`):

- SwapVehicle only works for a rental contract with status Checked Out; for any other status it fails with 'Rental contract %1 must have status Checked Out.' (%1 is the contract number).
- The new vehicle must exist, and it must be neither checked out nor blocked; a vehicle that is checked out or blocked makes SwapVehicle fail with 'Vehicle %1 is not available.' (%1 is the new vehicle number). When SwapVehicle fails, nothing changes.
- A successful swap releases the old vehicle (no longer checked out), checks out the new vehicle, and sets the contract's vehicle number to the new vehicle and its start km to the new vehicle's mileage. The contract stays Checked Out.
- Return only works for a rental contract with status Checked Out; for any other status it fails with 'Rental contract %1 must have status Checked Out.'.
- The return km may equal the contract's start km but not be below it; below it, Return fails with 'Return km %1 is below the start km %2.' (%1 is the return km, %2 the start km). When Return fails, nothing changes.
- A successful return sets the contract to Returned with the return km and the damage description. The vehicle is released (no longer checked out) and its mileage becomes the return km.
- When the damage description is not empty, the damage is registered on the vehicle in Fleet: a `CGR Damage Entry` with that description is created for the vehicle, the vehicle is blocked and its open damage count goes up by one. Without a damage description nothing is registered.
