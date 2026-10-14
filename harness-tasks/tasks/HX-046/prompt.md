# Bug 7601: Extended leases fall due on the wrong day

Reported by the Lease desk.

Last sprint we shipped lease extensions: `CGR Lease Extension` (Leasing) has `ExtendLease(ContractNo: Code[20]; ExtraMonths: Integer)`, which adds ExtraMonths months to a lease and adds one schedule line for each added month after the lease's last schedule line.

Observed: the added schedule lines fall due on the wrong day of the month.

- Lease L-1 starts on 2027-01-31 and runs for 3 months. After extending it by 3 months, the added lines are due on 2027-04-30, 2027-05-30 and 2027-06-30.
- A lease that starts on 2026-11-30 and runs for 3 months, extended by 3 months, gets added lines due on 2027-02-28, 2027-03-28 and 2027-04-28.

Expected: every installment of a lease, also one added by an extension, is due on the day of the month of the lease's "Start Date", or on the last day of the month when that month has no such day, the same as in the schedule created for the lease. This also holds when a lease is extended more than once. Everything else `ExtendLease` does stays as it is today.

Reproduction:

1. Create lease L-1 starting 2027-01-31 for 3 months with a base rate of 100 and create its schedule (`CGR Lease Mgt`, CreateSchedule). Its lines are due on 2027-01-31, 2027-02-28 and 2027-03-31.
2. Extend L-1 by 3 months.
3. The added lines 40000, 50000 and 60000 are due on 2027-04-30, 2027-05-30 and 2027-06-30. Expected: 2027-04-30, 2027-05-31 and 2027-06-30.
