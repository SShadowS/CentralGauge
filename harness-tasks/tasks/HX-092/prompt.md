# Feature 7604: Link several contract days to one billing line at once

Requested by Billing desk.

When a corporate customer's monthly billing line comes in, the desk matches it against the contract day lines it covers with `CGR Billing Match.MatchLines(BillingLineNo, DayLines)`, where DayLines holds the lines the user selected. With one day line selected this works: the line is matched up to what is still open on the billing line and linked to it. With several selected, every line is matched in full and none is linked, so the desk ends up linking them one by one.

Requested, for a selection of several day lines:

- A selected line is linked to the billing line when all of its days fit into what is still open on the billing line at that moment. The desk always selects lines of one contract, and they are taken in line-number order. Each line that gets linked reduces what is open for the lines after it.
- A selected line that does not fit in full is matched in full (Matched Days = its Days) but not linked, and it does not reduce what is open.
- A line whose vehicle was swapped for another vehicle (it has a vehicle substitution in Fleet) is never linked this way. It is matched in full without a link.
- A selected line that is already linked to this billing line may use its own days: what it is already matched counts as open when deciding whether it fits.

Matching a single selected line stays as it is today.

Example: a billing line of 10 days, with day lines of 4, 4 and 4 days selected. The first two are linked and 2 days stay open. The third is matched in full, 4 days, without a link.
