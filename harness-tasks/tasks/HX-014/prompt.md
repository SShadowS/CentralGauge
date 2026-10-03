# Task 7372: Let maintenance strategies set the default service interval

Reported by Workshop planning.

Service plans (`CGR Service Plan`, Fleet) carry an "Interval Months". Today a plan with "Interval Months" 0 gives no next service date at all, so every plan has to repeat an interval that really belongs to the maintenance strategy. We want each maintenance strategy to define its own default service interval.

Requirement:

- Add an interface `CGR Service Interval` to Core with the method `DefaultIntervalMonths(): Integer`. Every value of the `CGR Maintenance Strategy` enum provides it: Default is 12 months, Heavy Duty is 6 months.
- Other apps already extend `CGR Maintenance Strategy` with their own strategies. Those apps must keep compiling and working without any change, and their strategies get a default interval of 12 months. An app must be able to give its own strategy a different default interval.
- `CGR Service Plan Mgt`, NextServiceDate: when the vehicle's service plan has "Interval Months" 0, the next service date is the last service date plus the default interval of the plan's strategy. A plan with an "Interval Months" above 0 keeps using its own interval. A vehicle without a service plan or without a last service date still has no next service date (0D). IsServiceDue follows the new next service date.
- The public procedures of `CGR Service Plan Mgt` keep their signatures.
