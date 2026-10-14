# Task 7720: Automated tests for ending a lease early

Reported by Lease desk.

Last sprint we added early termination of leases. Customers whose lease was ended early still pay the rate of their original, longer lease on the months they have left.

Before anyone changes the termination code we want automated tests that pin down how ending a lease early must behave. Put them in a new test codeunit in the Test app. Do not fix the termination code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault.

How it must behave (`CGR Lease Termination`, procedure `TerminateLease(ContractNo: Code[20]; LastDueDate: Date)`):

- A lease cannot end before it starts: when LastDueDate is before the lease's Start Date, TerminateLease fails with `Lease <lease no.> cannot end before it starts.`
- A lease cannot end before a schedule line that is already invoiced: when an invoiced schedule line of the lease is due after LastDueDate, TerminateLease fails with `Lease <lease no.> is invoiced after <LastDueDate>.`, the date written as YYYY-MM-DD (for example `2027-03-15`).
- Otherwise it deletes every schedule line of the lease that is due after LastDueDate. A line due on LastDueDate itself stays.
- The lease's Months becomes the number of schedule lines left.
- Every line left that is not invoiced gets the amount `CGR Lease Mgt`.MonthlyRate(Base Rate, new Months). Invoiced lines keep their amounts.
- For a lease that does not exist, TerminateLease fails.
- When TerminateLease fails, nothing is changed.
