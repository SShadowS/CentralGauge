# Feature 7748: Rent several vehicles to one customer in one go

Reported by Front desk.

Groups and families often rent several vehicles together. Today the desk creates and checks out one contract per vehicle (`CGR Rental Mgt`, CreateContract and CheckOut), and when one of the vehicles turns out to be unavailable halfway, the customer leaves with half the vehicles and the desk has to clean up. We want a desk basket: the desk collects the vehicles first and checks them all out together.

Requirement, in a new codeunit `CGR Desk Basket` in the Rental app:

- `AddToBasket(VehicleNo: Code[20])` adds a vehicle of the fleet to the basket. A vehicle that is already in the basket is in it once. A vehicle that does not exist is refused with the platform's not-found error for `CGR Vehicle`, and the basket stays as it was.
- `RemoveFromBasket(VehicleNo: Code[20])` takes the vehicle out of the basket. When it is not in the basket, nothing happens and no error is raised.
- `EmptyBasket()` takes every vehicle out of the basket.
- `GetBasket(var BasketVehicle: Record "CGR Vehicle" temporary)`: afterwards BasketVehicle holds exactly the vehicles in the basket, as they are stored in `CGR Vehicle` now; whatever BasketVehicle held before is gone. Changing or deleting the rows handed out changes neither the basket nor the vehicles.
- `CheckOutBasket(CustomerName: Text[100]; StartDate: Date; EndDate: Date): Integer` creates one rental contract per vehicle in the basket, as CreateContract does with the given customer and dates, checks each of them out as CheckOut does, and returns the number of vehicles checked out. After a successful checkout the basket is empty.
- CheckOutBasket is all or nothing. When any vehicle in the basket cannot be checked out (it is not available, or an extension refuses the checkout), CheckOutBasket fails with that error, and no contract, no checkout and no outbox entry of any basket vehicle is kept. The basket then stays as it was, so the desk can fix the problem and check out again.
- The basket belongs to the desk session: every `CGR Desk Basket` variable in the session sees and changes the same basket.

Vehicles are not deleted while they are in a basket. CreateContract, CheckOut and the rest of Rental behave as today.
