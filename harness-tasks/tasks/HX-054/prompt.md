# Task 7657: Automated tests for damages and repairs

Reported by Fleet team.

Last month a vehicle went back out to a customer with a damage nobody had repaired. The workshop had registered one repair twice, and the vehicle came free while its other damage was still open.

Before anyone changes the damage code we want automated tests that pin down how registering and repairing damages must behave. Put them in a new test codeunit in the Test app. Do not fix the damage code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault.

How it must behave (`CGR Damage Mgt`, procedures `RegisterDamage(VehicleNo: Code[20]; Description: Text[100]): Integer` and `RepairDamage(EntryNo: Integer)`):

- RegisterDamage stores a new `CGR Damage Entry` for the vehicle: not repaired, the description exactly as given, and the work date as Reported On. It returns the new entry's Entry No.
- After RegisterDamage the vehicle is blocked and its Open Damages is one higher than before.
- RepairDamage marks the entry repaired and keeps its Reported On.
- After RepairDamage the vehicle's Open Damages is the number of its damage entries that are not repaired, and the vehicle stays blocked while that number is above zero; at zero it is no longer blocked.
- Repairing an entry that is already repaired changes nothing and raises no error.
- Repairing an entry number that does not exist raises an error.
- A blocked vehicle is not available (`CGR Fleet Mgt`.IsAvailable).
