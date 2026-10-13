# Feature 7587: Group holidays for all our companies

Reported by Group finance.

Our companies share one database. Today every company keeps its own non-working days in `CGR Non-Working Day`, so a public holiday that applies to the whole group has to be entered again in each company, and a company that forgets it invoices leases on the holiday.

Requirement:

- New table `CGR Group Holiday` (id 70014, module Core) with fields "Holiday Date" (Date, primary key) and Description (Text[100]).
- A group holiday is one record for the whole group. Once a group holiday exists, whichever company it was created in and whether or not it was created with triggers (our data migration inserts records without running triggers), it applies in every company and is visible in every company. When it is deleted in any company, it no longer applies anywhere.
- `CGR Working Days`.IsWorkingDay returns false on a group holiday, just as on a non-working day of the company. WorkingDaysBetween, NextWorkingDay and everything built on them (for example the invoice date of lease invoicing, `CGR Lease Invoicing`.InvoiceDate) follow.
- `CGR Non-Working Day` stays per company: a company's own non-working days still apply in that company and do not apply in other companies.
- Weekends and existing non-working days behave as today.
