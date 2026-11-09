# Bug 5161: Every customer approved while the credit agency was down

Reported by Risk management.

Before a rental, the desk checks the customer's credit (`CGR Credit Check`.`CheckCustomer`). The credit agency app answers through an event; when the agency cannot be reached, the app raises an error. Last Saturday the agency was down for six hours and every customer was approved.

Expected:

- CheckCustomer returns true only when the credit agency app approves the customer. When the agency app refuses, or raises an error (agency unreachable, timeout), the customer is not approved: CheckCustomer returns false and never raises the error to its caller.
- From now on every new contract records the check: `CGR Rental Mgt`.`CreateContract` sets the new Boolean field "Credit Approved" on the contract from CheckCustomer. Creating a contract must never fail because of the credit check.
- CreateContract is called from the desk, by the booking import (one booking per Codeunit.Run) and by other apps inside their own transactions.
- The credit agency app only reads; it writes nothing in our database. It subscribes to `CGR Credit Check Run`.`OnCheckCredit`, which must stay where it is.

Keep the signatures of CheckCustomer and CreateContract.
