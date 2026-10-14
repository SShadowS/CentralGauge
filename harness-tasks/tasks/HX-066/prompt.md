# Task 7741: Automated tests for maintenance strategies

Reported by Workshop planning.

The workshop installed a partner app that adds a City Car maintenance strategy: a city car is due for service every 10,000 km. Since the last update the service planning ignores it. City cars come up for service 15,000 km after their last service, as if they had the Default strategy.

Before anyone changes the service km code we want automated tests that pin down how the next service km must be worked out. Put them in a new test codeunit in the Test app. Do not fix the service km code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault.

How it must behave (`CGR Fleet Mgt`, procedure `NextServiceKm(VehicleNo: Code[20]): Integer`):

- NextServiceKm returns the next service km that the vehicle's own maintenance strategy gives for the vehicle's Last Service Km.
- Maintenance strategies are the values of the extensible enum "CGR Maintenance Strategy". Each value has its own implementation of the interface "CGR Maintenance Strategy": Default (in Core) adds 15,000 km, Heavy Duty (in Fleet) adds 5,000 km, and a value that another app adds gives the interval of that app's own implementation.
- The vehicle's own Strategy counts, also when it differs from the strategy of the vehicle's service plan.
- One `CGR Fleet Mgt` variable may be asked about any number of vehicles; each answer is for the vehicle asked about.

Partner strategies come from apps the workshop installs. The Test app may add its own.
