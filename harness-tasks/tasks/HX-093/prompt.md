# Bug 7633: Card-paid rental posts a one-sided entry when the payment method has no balancing account

Reported by Finance.

When a rental contract is paid by card, the bank statement line is matched to it (a CGR Matched Payment row for the contract). Posting the contract with `CGR Rental-Post` then writes the rental ledger entry and a CGR Balancing Entry against the Balancing Account No. of the payment method of that matched card payment. That method is often not the one on the contract: customers pick one method when they book and pay with another card at the desk.

Observed: when the matched payment's method has no Balancing Account No., posting goes through and writes a balancing entry with a blank account. Finance finds these one-sided postings at month end. The contract check (`CGR Contract Check.CheckContract`) says nothing about it.

Expected:

- Posting stops with an error when the balancing account it needs is missing. It stops before it writes anything and before the posting events are raised.
- `CheckContract` lists the problem with the code 'NO-BALANCING-ACCOUNT', next to any other problems it already lists.
- No balancing account is needed, and nothing changes, when:
  - the contract has no matched payment;
  - the matched payment is marked Externally Settled;
  - "Post Payments on Import" is set in Setup (the payment was already balanced when the statement was imported);
  - the matched payment's method has "Posts to Customer Account" set.
- Contracts that post correctly today post exactly as before.

Reproduction:

1. Payment method CARD-A with Balancing Account No. 1940, payment method CARD-B without one.
2. A returned contract with Payment Method Code CARD-A, and a matched payment for it with method CARD-B.
3. Post the contract: it posts, with a balancing entry on a blank account. Expected: an error, and nothing posted.
