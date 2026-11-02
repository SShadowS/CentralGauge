# Bug 7652: E-invoicing partner rejects invoice summaries with a negative discount

Reported by Integration desk.

The e-invoicing partner receives a summary of every rental invoice, built by `CGR Invoice Summary.Build(InvoiceNo, Header, Lines)` in Reporting. Lines holds the allowance and charge lines: a Discount line with reason 'DISC' for the line discounts and a Charge line with reason 'FEE' for the handling fee. Header holds the totals.

Some invoice lines carry a negative Discount Amount: a price correction that adds to the line instead of reducing it. Those invoices come back from the partner as rejected, because their summaries contain a Discount line with a negative amount. The partner does not accept negative amounts anywhere in a summary.

Expected:

- Discounts are summarised per tax group: one line per Tax Group Code for the net of that group's Discount Amounts, with Base Amount the total Line Amount of all the group's invoice lines.
- When a group's net is negative, its line is a Charge line with reason 'DISC-ADJ' for the absolute amount, with the same base. A group whose net is zero gets no line.
- The 'FEE' line stays as it is.
- The header totals are the totals of the summary lines: Discount Total is the sum of the Discount lines and Charge Total the sum of all Charge lines. Line Total minus Discount Total plus Charge Total equals Total Excl. Tax, and Total Excl. Tax stays what it is today.
- No amount in a summary is negative.

Reproduction:

1. An invoice with two lines in tax group STD: 300.00 with Discount Amount 41.50, and 15.00 with Discount Amount -60.00.
2. Build the summary: two Discount lines, 41.50 and -60.00. Expected: one Charge line 'DISC-ADJ' for STD, amount 18.50 on a base of 315.00, and no Discount line.
