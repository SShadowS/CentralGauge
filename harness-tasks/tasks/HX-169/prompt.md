# Task 5169: One open-balance calculation for the group lease exposure

Requested by Group treasury.

The codeunit `CGR Lease Exposure` (Leasing) gives treasury the open lease balance per company, in `CGR Lease Exposure Line` records. `CompanyExposure` fills one line for our own company, and `GroupExposure` fills one line for every company in the database. A lease's open balance is the sum of its schedule lines that are not invoiced yet, and it is below 0 when an open credit line outweighs the rest. A lease counts as an open lease when its open balance is not 0; a lease with nothing left to invoice adds nothing to either figure.

The open-balance calculation lives in `CGR Lease Balance` (Leasing), which other apps call too, and `CompanyExposure` takes its balances from there. `GroupExposure` carries its own copy of the calculation and of the line building. Remove the copy:

- Every open balance `GroupExposure` reads comes from `CGR Lease Balance`. The treasury audit extension subscribes to its `OnAfterOpenLeaseBalance`, and from now on it must see that event once for every lease `GroupExposure` reads, in every company, with that lease's open balance, just as it sees one per lease for `CompanyExposure` today.
- A company's line is the same whether `CompanyExposure` or `GroupExposure` builds it.

Everything else stays as it is today: every company's figures come from that company's own data, `CGR Lease Balance` does not change, and the public procedures keep their signatures.
