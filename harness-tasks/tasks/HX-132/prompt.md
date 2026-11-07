# Bug 5316: Customers keep a second card hold after a failed check-out

Reported by Customer service.

At check-out, `CGR Rental Mgt`.`CheckOut` asks the payment app for a hold on the customer's card for the contract's `ExpectedAmount` (`OnRequestPreAuthorization`) and keeps the returned code in `"Payment Auth Code"` and the amount in `"Authorized Amount"` on the contract. Each request places a new hold at the card provider; the provider cannot be asked later which holds exist, and a hold is released only by its code (`OnReleasePreAuthorization`). When `SwapVehicle` moves a checked-out contract to a more expensive vehicle, a hold for the new amount is requested and the old hold is released. The key box hands out the keys in `OnAfterCheckOut` and `OnAfterSwapVehicle`, and it can refuse with an error.

Observed: when a check-out fails after the card was authorized, for example because the vehicle is blocked or the key box refuses, the desk fixes the problem and checks out again, and the customer then has two holds on the card, one of which we have no record of.

Expected: a hold the provider returns is never lost, whatever fails after the request, and a contract that already has a hold for the amount it needs does not request another one. The card is authorized for the full amount before the keys are handed out, the old hold is released exactly once and only when the swap has gone through, and a failed check-out or swap otherwise changes nothing on the contract or the vehicles. Check-out and swap are started from the contract card, with no other unsaved changes.
