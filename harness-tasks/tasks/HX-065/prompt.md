# Task 7734: Automated tests for contract and lease numbers

Reported by Group finance.

Since the last update the lease numbers jump ahead and some rental contract numbers are never used. Finance matches both series against their own registers and needs them to be gap-free.

Before anyone changes the numbering code we want automated tests that pin down how contract and lease numbers must be given. Put them in a new test codeunit in the Test app. Do not fix the numbering code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault.

How it must behave (`CGR Rental Mgt`, procedure `CreateContract(VehicleNo: Code[20]; CustomerName: Text[100]; StartDate: Date; EndDate: Date): Code[20]`; `CGR Lease Mgt`, procedure `CreateContract(VehicleNo: Code[20]; CustomerName: Text[100]; StartDate: Date; Months: Integer; BaseRate: Decimal): Code[20]`; table `CGR Setup`, fields "Last Contract No." and "Last Lease No."):

- A new rental contract gets the number `RC` followed by CGR Setup's "Last Contract No." + 1, with no separator and no leading zeros (for example RC42 when "Last Contract No." is 41). That value is stored as the new "Last Contract No.", and the procedure returns the number.
- A new lease gets the number `LC` followed by "Last Lease No." + 1 in the same way, and that value is stored as the new "Last Lease No.".
- The two series are independent: creating a rental contract does not change the lease series, and creating a lease does not change the rental series.
- When there is no CGR Setup record yet, numbering starts at RC1 and LC1.
