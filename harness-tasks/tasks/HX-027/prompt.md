# Task 7468: Let the lease desk see a schedule before it is created

Reported by the lease desk.

Today the lease desk only sees the payment schedule of a lease after `CGR Lease Mgt`, CreateSchedule has saved it. Before they create a schedule, and after they change the terms of a lease that is already partly invoiced, they want to see the schedule the lease would get, without saving anything.

Requirement:

- Add to `CGR Lease Mgt`: `procedure BuildSchedule(ContractNo: Code[20]; var ScheduleBuffer: Record "CGR Lease Schedule Line" temporary)`. It fills ScheduleBuffer with the schedule lines that CreateSchedule would create for the lease now: the same "Line No.", "Due Date" and Amount, none of them invoiced. Whatever ScheduleBuffer held before the call is replaced: afterwards it holds only these lines.
- BuildSchedule changes nothing in the database: the lease's saved schedule lines, invoiced or not, stay as they are.
- BuildSchedule also works for a lease that already has invoiced schedule lines: it shows the schedule the lease's current terms give.
- For a lease that CreateSchedule refuses because of its number of months, BuildSchedule fails with the same error.
- CreateSchedule must build its lines with the same code as BuildSchedule, so the two cannot drift apart. CreateSchedule itself keeps its current behaviour.
