# Task 7811: Automated tests for the damage overview

Reported by Fleet controlling.

Last sprint Reporting got a damage overview that lists, per vehicle, how many damages are still open and since when. Fleet controlling says the "oldest open damage" date is sometimes older than any damage that is still open.

Before anyone changes the overview we want automated tests that pin down how it must behave. Put them in a new test codeunit in the Test app. Do not fix the code in this task: your tests will be run against the corrected code, where they must pass, and against the current code and other faulty versions of it, where they must catch the fault.

How the overview must behave (`CGR Damage Overview` in Reporting, procedure `FillDamageOverview(VehicleFilter: Text; IncludeClean: Boolean; var OverviewLine: Record "CGR Damage Overview Line" temporary): Integer`, lines of the temporary table `CGR Damage Overview Line` with the fields "Vehicle No." (key), "Open Damages", "Oldest Open Damage", Blocked and Note):

- OverviewLine holds exactly the lines of this fill; whatever it held before is gone.
- There is one line per vehicle whose "No." matches VehicleFilter, a filter expression on the vehicle number.
- "Open Damages" is the number of the vehicle's damage entries that are not repaired, counted from the damage entries, not taken from the vehicle.
- "Oldest Open Damage" is the earliest "Reported On" among those entries, 0D when there is none.
- Blocked is the vehicle's Blocked.
- A vehicle without open damages gets a line only when IncludeClean is true.
- The event `OnAfterFillOverviewLine(var OverviewLine: Record "CGR Damage Overview Line"; var Skip: Boolean)` of `CGR Damage Overview` is raised for each line after its fields are set and before it is stored. What a subscriber changes in the line is stored, and a subscriber that sets Skip keeps the line out.
- The result is the number of lines stored.
- The fill changes no data.
