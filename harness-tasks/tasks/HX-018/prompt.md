# Task 7402: Automated tests for service due rules

Reported by the Workshop.

The workshop reports that Heavy Duty trucks are not called in for service on time. A Heavy Duty truck that has driven 14,000 km since its last service is shown as not due, although trucks on the Heavy Duty strategy are due 5,000 km after their last service.

Before anyone changes the service plan code we want automated tests that pin down how service plans and the service due check must behave. Put them in a new test codeunit in the Test app. Do not fix the service plan code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault.

How it must behave (`CGR Service Plan Mgt`, procedures `AssignPlan(VehicleNo: Code[20]; PlanCode: Code[20])`, `RegisterService(VehicleNo: Code[20]; ServiceDate: Date; ServiceKm: Integer)`, `NextServiceDate(VehicleNo: Code[20]): Date` and `IsServiceDue(VehicleNo: Code[20]; AtDate: Date): Boolean`):

- AssignPlan stores the service plan on the vehicle and gives the vehicle the plan's maintenance strategy. Assigning a plan that does not exist fails.
- RegisterService stores the service km and the service date as the vehicle's last service. A service km above the vehicle's mileage fails; a service km equal to the mileage is allowed. After a service is registered, extensions are notified through the OnAfterServiceRegistered event, which passes the vehicle with its new last service km and date.
- NextServiceDate is the last service date plus the plan's interval in months. There is no next service date (0D) when the vehicle has no plan, has no last service date, or its plan has an interval of 0 months.
- A vehicle is due for service when its mileage reaches the next service km that its maintenance strategy gives for its last service km (`CGR Fleet Mgt`, NextServiceKm), or when AtDate is on or after its next service date. Either rule makes it due, whether or not the vehicle has a plan.
