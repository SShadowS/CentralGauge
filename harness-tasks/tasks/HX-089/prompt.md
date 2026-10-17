# Task 7902: Automated tests for the lease due plan

Reported by Lease desk.

The lease desk plans its collections from the lease due plan, and the figures it shows have stopped matching the open installments of the leases. Before anyone touches the due plan we want automated tests that pin down what it must return. Put them in a new test codeunit in the Test app. Do not change the due plan code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault.

How it must behave (`CGR Lease Due Plan`, procedure `FillDuePlan(ContractFilter: Text; FromDate: Date; ToDate: Date; var PlanLine: Record "CGR Due Plan Line" temporary)`):

- FillDuePlan gives PlanLine one line per lease matching ContractFilter and calendar month (Due Year, Due Month) in which that lease has schedule lines (`CGR Lease Schedule Line`) that are not invoiced and are due from FromDate to ToDate, both days included.
- The line's Contract No. is the lease, its Amount is the exact sum of the amounts of those schedule lines, and its Lines is their number.
- A lease and month without such schedule lines gets no plan line.
- Afterwards PlanLine holds only the lines of this fill: lines it held before the call are gone.
