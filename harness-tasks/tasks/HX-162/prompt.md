# Bug 5162: The accounting partner rejects every rental invoice line

Reported by the Integration team.

Posted rental ledger entries are sent to the accounting partner as CSV lines (`CGR Ledger Export`.`BuildLine`, in Integration). Since we moved to the new partner, every line is rejected with "invalid date".

Expected (partner specification, section 4):

- One line per ledger entry: `<contract no.>;<vehicle no.>;<posting date>;<amount>;<km driven>`.
- Posting date as yyyy-mm-dd (2027-03-01).
- Amount with a point as decimal separator, always two decimals, no thousands separator: 1234.50, 103.50, 12.35 (rounded to cents). Negative amounts (corrections) with a leading minus: -45.50.
- Km driven as a whole number without separators: 1500.
- The partner rejects the whole file on the first line it cannot read, so every line must follow this exactly.

The export runs in the session language of whoever starts it.
