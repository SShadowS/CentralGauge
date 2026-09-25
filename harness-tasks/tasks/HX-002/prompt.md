# Task 4188: Automated tests for lease schedules

Finance reports that schedules of leases starting at the end of a month drift. A 12-month lease starting 31 January 2027 has its March installment due on 28 March instead of 31 March, and every later installment stays on the 28th.

Before anyone changes the scheduling code we want automated tests that pin down how a lease schedule must behave. Add them to the Test app. Do not fix the scheduling code in this task: your tests will be run against the corrected scheduling code, where they must pass, and against the current code, where they must catch the drift.

How a lease schedule must behave (schedules are created with `CGR Lease Mgt`, CreateSchedule):

- One schedule line per month of the lease, line numbers 10000, 20000, 30000 and so on.
- The first installment is due on the lease start date; installment n is due n-1 months after the start date.
- The lease total is base rate x months x rate factor, rounded to 0.01, where the rate factor is 1 + months/100. Every installment is the total divided by the number of months, rounded to 0.01, except the last one, which takes the remainder so that the installments add up exactly to the total.
- Creating the schedule again replaces the existing lines with a schedule for the lease as it is now.
- A lease with an invoiced schedule line cannot be rescheduled: the attempt fails.
