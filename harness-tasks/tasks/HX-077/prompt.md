# Task 7818: Automated tests for base rate changes on leases

Reported by Lease desk.

Last sprint we added changing the base rate of a running lease. Since then the desk sees a higher number of repriced lines after a rate change than the number of lines whose amount actually changed.

Before anyone changes the rate change code we want automated tests that pin down how changing a base rate must behave. Put them in a new test codeunit in the Test app. Do not fix the code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault.

How it must behave (`CGR Lease Rate Change` in Leasing, procedure `ChangeBaseRate(ContractNo: Code[20]; NewBaseRate: Decimal): Integer` and integration event `OnBeforeChangeBaseRate(ContractNo: Code[20]; OldBaseRate: Decimal; NewBaseRate: Decimal)`):

- When NewBaseRate is zero or less, ChangeBaseRate fails with `Lease %1 needs a base rate above zero.`, where %1 is ContractNo.
- For a lease that does not exist, ChangeBaseRate fails.
- Partner apps are asked first, through OnBeforeChangeBaseRate. They receive the lease number, the lease's current base rate as OldBaseRate and the new one as NewBaseRate. At that moment the lease in the database still has its old base rate.
- A partner app may refuse the change by raising an error. Then ChangeBaseRate fails with the partner's error and nothing of the change is kept.
- Partner apps may not commit. When a partner app commits while it is asked, ChangeBaseRate fails with the platform's error, and nothing of the change or of the partner's work is kept.
- Otherwise the lease's Base Rate becomes NewBaseRate, and every schedule line of the lease that is not invoiced gets the amount `CGR Lease Mgt`.MonthlyRate(NewBaseRate, Months), where Months is the lease's Months. Invoiced lines keep their amounts.
- ChangeBaseRate returns the number of schedule lines it repriced.
