# Feature 7846: Undo the last vehicle swap at the desk

Reported by Front desk.

When a customer at the desk is moved to another vehicle (`CGR Rental Mgt`, SwapVehicle) and then changes their mind, or the desk picked the wrong vehicle, staff have to look up which vehicle the contract was on and swap it back by hand. The desk wants to undo its last swap, and the partner portal wants to be told about every swap the desk makes so it can follow the customer to the new vehicle.

Requirement, in a new codeunit `CGR Desk Swap` in the Rental app:

- `SwapAtDesk(ContractNo: Code[20]; NewVehicleNo: Code[20])` swaps the contract to the new vehicle exactly as SwapVehicle does, then raises a new integration event `OnAfterDeskSwap(ContractNo: Code[20]; OldVehicleNo: Code[20]; NewVehicleNo: Code[20])` with the contract, the vehicle it left and the vehicle it moved to. Once all of that has succeeded, this swap becomes the session's last swap, replacing an earlier one whatever its contract.
- A swap that fails (SwapVehicle refuses it, the contract does not exist, or a partner app raises an error in OnAfterDeskSwap) fails with that error, changes nothing, and leaves the last swap as it was.
- `UndoLastSwap()` moves the last swap's contract back to the vehicle it came from, exactly as SwapVehicle would, and raises OnAfterDeskSwap with the contract, the vehicle it leaves and the vehicle it returns to. Afterwards there is no last swap. When there is no last swap it fails with 'There is no desk swap to undo.'.
- An undo that fails (the earlier vehicle is not available any more, or a partner app raises an error) fails with that error, changes nothing, and keeps the last swap so it can be undone later.
- The last swap belongs to the session: every `CGR Desk Swap` variable sees the same last swap.
- `LastSwapContract(): Code[20]` returns the contract of the last swap, '' when there is none.
- `ForgetLastSwap()` drops the last swap. It does not fail when there is none.
- Swaps made with SwapVehicle directly are not desk swaps: they raise nothing and do not change the last swap. SwapVehicle, CheckOut and Return work as today.
