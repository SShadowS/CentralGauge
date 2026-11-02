# Feature 7716: Rent out boats

Requested by the Harbour desks.

From next season our harbour branches rent out boats alongside our cars and vans. A boat is a fleet asset like any other: it is rented, handed out, returned, damaged, repaired and serviced through the same desk, the partner portal hears about it like any other asset, and it appears in the same reports.

Where a boat differs:

- It is handed out only at a harbour branch, and only once the customer's boat licence is recorded on the rental contract.
- It is metered in engine hours, not km. The rental includes a daily allowance of engine hours; extra hours are charged at an hourly rate from Setup. The km allowance and the excess km charge do not apply to boats.
- It is serviced every 100 engine hours.
- Boats are never leased.
- A rental stays with one kind of asset from hand-out to return.

Everything else (the daily rate and pricing methods, damage, availability, posting) works for a boat as it does for a car.

For the details the desks and partners rely on: boats are asset type Boat. For a boat, the asset's meter reading (Mileage, and the contract's Start Km and Return Km) is in engine hours. The licence goes in a new contract field "Boat Licence No." (Code[20]); the rental ledger records a boat's hours in a new field "Engine Hours" (Integer); Setup gets "Engine Hour Allowance per Day" (Integer) and "Excess Engine Hour Rate" (Decimal).
