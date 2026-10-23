# Bug 7769: Leases starting mid-month show a first installment of 0.00

Reported by the Lease desk.

Last sprint we added `FirstInstallment(ContractNo: Code[20]): Decimal` in the new codeunit `CGR Lease Start Charge` (Leasing). The lease desk uses it to charge the first, partial month of a lease.

Observed: a lease that starts after the 1st of a month gets a first installment of 0.00. A lease that starts on the 1st gets the full monthly rate.

Expected: the first installment is the lease's monthly rate (as `CGR Lease Mgt`.MonthlyRate gives it for the lease's base rate and months) times the number of days from the lease's "Start Date" to the end of that month, the start day included, divided by the number of days in that month, rounded to the cent. A lease that does not exist fails with the platform's not-found error. Keep the signature of FirstInstallment.

Reproduction:

1. Create a lease for 3 months with a base rate of 100 starting on 2027-03-16 (`CGR Lease Mgt`, CreateContract). Its monthly rate is 103.00.
2. `FirstInstallment` returns 0.00 for it. Expected: 53.16 (103.00 x 16 / 31).
3. A lease with the same months and base rate starting on 2027-03-01 returns 103.00, which is correct.
