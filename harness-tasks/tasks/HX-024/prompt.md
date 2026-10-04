# Bug 7447: Customer overview is empty for "Hansen & Son"

Reported by Controlling.

Last sprint we shipped the codeunit `CGR Customer Overview` (Reporting). It gives two figures per customer, where a customer is identified by the "Customer Name" stored on its contracts:

- `OpenLeaseAmount(CustomerName: Text[100]): Decimal`: the sum of the amounts of the schedule lines that are not yet invoiced, over all lease contracts of the customer.
- `ActiveRentalCount(CustomerName: Text[100]): Integer`: the number of rental contracts of the customer with status Open or Checked Out.

Observed:

- For "Hansen & Son" both figures are 0, although the customer has open lease schedule lines and an open rental contract.
- For "A..Z Freight" the rental count also includes contracts of other customers.

Expected:

- Both figures use exactly the contracts whose "Customer Name" equals the name passed in. Customer names are free text and can contain any character.
- Figures for customers that show correct values today stay as they are.

Reproduction:

1. Create a rental contract with status Open for the customer "Hansen & Son".
2. Call `ActiveRentalCount('Hansen & Son')`. It returns 0; expected 1.
