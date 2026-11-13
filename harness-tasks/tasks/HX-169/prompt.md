# Task 5169: One open-balance calculation for the group lease exposure

Requested by Group treasury.

The codeunit `CGR Lease Exposure` (Leasing) gives treasury the open lease balance per company, in `CGR Lease Exposure Line` records. `CompanyExposure` fills one line for our own company, and `GroupExposure` fills one line for every company in the database. A lease's open balance is the sum of its schedule lines that are not invoiced yet. A lease counts as an open lease when its open balance is not 0; a lease with nothing left to invoice adds nothing to either figure.

`GroupExposure` carries its own copy of the open-balance calculation and of the line building that `OpenLeaseBalance` and `CompanyExposure` already do. Remove the copy, so each lives in one place:

- A company's line is the same whether `CompanyExposure` or `GroupExposure` builds it.
- Every open balance `GroupExposure` reads comes from the calculation in `OpenLeaseBalance`. The treasury audit extension subscribes to `OnAfterOpenLeaseBalance`, and from now on it must see the event once for every lease `GroupExposure` reads, in every company, with that lease's open balance, just as it sees one per lease for `CompanyExposure` today.

Everything else stays as it is today: every company's figures come from that company's own data, and the public procedures keep their signatures.
