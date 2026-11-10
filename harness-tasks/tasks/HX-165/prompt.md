# Task 5165: Automated tests for the service plan span cache

Reported by Workshop planning.

Service planning looks up the interval of a service plan many times per vehicle, so last month the lookup moved to a session cache, `CGR Plan Span Cache`. Last week the nightly sync shortened plan VAN-12 from 12 to 6 months, and the planner kept using 12 months until it signed out and in again.

Before anyone changes the cache we want automated tests that pin down how it must behave. Put them in a new test codeunit in the Test app. Do not fix the code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault. A faulty version counts as caught only when one of your tests fails on an assertion; a test that stops with an error does not catch it.

How the cache must behave (`CGR Plan Span Cache` in Fleet, procedures `PlanSpanMonths(PlanCode: Code[20]): Integer` and `ForgetPlanSpans()`):

- PlanSpanMonths returns the plan's "Interval Months". A plan that does not exist answers 0.
- Within one session, the first lookup of a plan may read the database. Every later lookup of that plan, as long as the plan has not changed, is answered from memory: it issues no database statement (`SessionInformation.SqlStatementsExecuted` does not move).
- A plan that is inserted, changed (with or without table triggers), deleted or renamed is seen by the very next lookup in the same session. After a delete, or after a rename under the old code, the lookup answers 0.
- A change to one plan touches nothing else: lookups of other plans that were already answered from memory stay answered from memory, without a database statement.
- ForgetPlanSpans empties the session's memory.

```al
// CGR Service Plan: Code (Code[20], primary key), Description, Strategy, "Interval Months" (Integer).
// Test app helpers you may use (codeunit 80090 "CGR Test Library", EventSubscriberInstance = Manual):
//   CreateServicePlan(PlanCode: Code[20]; Strategy: Enum "CGR Maintenance Strategy"; IntervalMonths: Integer)
// Test codeunits use Subtype = Test, TestPermissions = Disabled and codeunit "Library Assert"; they run
// through the standard test runner with TestIsolation = Codeunit.
```

Write the test codeunit and explain briefly which fault each test catches.
