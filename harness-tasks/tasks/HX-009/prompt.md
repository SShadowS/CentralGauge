# Feature 7334: Charge late returns per working day

Reported by the front desk, Aarhus.

Customers who bring a rental vehicle back after the agreed End Date are not charged for the extra time. We want to charge a fixed fee for every working day a vehicle comes back late.

Requirement:

- `CGR Setup` gets a new field "Late Fee per Day" (Decimal).
- `CGR Rental Contract` gets a new field "Return Date" (Date). Returning a contract (`CGR Rental Mgt`, Return) sets "Return Date" to the work date.
- A contract whose "Return Date" is after its "End Date" is priced with one extra line with the Description 'Late return'. Its Quantity is the number of working days after the End Date, up to and including the Return Date. Saturdays, Sundays and the dates in `CGR Non-Working Day` are not working days. Its Unit Price is the "Late Fee per Day", and its amount is rounded like the other lines' amounts.
- There is no 'Late return' line when that number of working days is 0 or when "Late Fee per Day" is 0.
- The late return is charged whatever the pricing method of the contract, and everywhere a contract is priced: the lines and the total of the invoice preview (`CGR Rental Invoice Preview`), and the amount posted to the rental ledger, both by `CGR Rental Mgt`, Post and by `CGR Rental Batch Post`.
