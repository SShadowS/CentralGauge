# Bug 7531: New rental rates are not used

Reported by Pricing, head office.

Last sprint we shipped the rate card: the table `CGR Vehicle Rate` (Rental) holds daily rates per vehicle with a "Starting Date" and an "Ending Date", and `CGR Rental Pricing` prices rental contracts with the rate from the rate card instead of the vehicle's "Daily Rate" when one applies. We maintain the rate card with a blank "Ending Date" for rates that have no end yet.

Observed: the rates we entered are not used. Contracts are still priced with the vehicle's "Daily Rate".

Expected:

- A blank "Ending Date" means the rate has no end.
- The rate that applies to a contract is a rate of the contract's vehicle that is valid on the contract's "Start Date": its "Starting Date" is on or before the "Start Date", and its "Ending Date" is blank or on or after the "Start Date".
- When several rates are valid on that date, the one with the latest "Starting Date" applies.
- When no rate is valid on that date, the vehicle's "Daily Rate" is used, as today.
- The applicable rate is used for the rental days of a Daily contract and for the weekend package, in the price (`CalcAmount`) and in the invoice preview.

Reproduction:

1. Vehicle V-1 has a "Daily Rate" of 45.
2. The rate card has two rates for V-1: from 2026-01-01 with a blank "Ending Date" at 50, and from 2027-03-01 with a blank "Ending Date" at 60.
3. A Daily contract for V-1 from 2027-03-04 to 2027-03-06: the invoice preview shows the Rental days line with 3 days at 45. Expected 3 days at 60.
