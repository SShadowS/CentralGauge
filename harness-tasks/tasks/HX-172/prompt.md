# Feature 5172: Change the code of a service plan

Requested by Workshop planning.

The manufacturer renames its service plans now and then; last month its plan VAN-12 became VANPRO-12. Today the workshop creates a second plan under the new code, moves the vehicles over by hand and deletes the old plan, and since the last release every registered service is also kept as a service visit (`CGR Service Visit`) with the plan the vehicle was on, so those visits lose their plan.

Add this procedure to `CGR Service Plan Mgt` (Fleet):

- `procedure ChangePlanCode(OldCode: Code[20]; NewCode: Code[20])`

Afterwards the plan exists only under NewCode, with its description, maintenance strategy and interval, and everything that points at the plan points at it under NewCode: the vehicles on the plan, and every service visit registered under OldCode, also the visits of vehicles that have since moved to another plan. The vehicles keep everything else as it is, and other plans, their vehicles and their visits are not changed. When NewCode is already the code of a plan, ChangePlanCode fails with the error `Service plan <NewCode> already exists.` (for example `Service plan VANPRO-12 already exists.`) and changes nothing.

Keep the signatures of the existing procedures of `CGR Service Plan Mgt`.
