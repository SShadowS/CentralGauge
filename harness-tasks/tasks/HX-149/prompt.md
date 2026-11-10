# Task 5149: Automated tests for the insurance claims export

Reported by IT security.

Unrepaired damages are sent to the insurer by `CGR Claim Export`.`ExportOpenDamages` in the Reporting app. Since the roles went live, claims handlers get a permission error when they run the export.

Before anyone changes the export or the roles we want automated tests that pin down how they must behave. Put them in a new test codeunit in the Test app. Do not fix anything in this task: your tests will be run against the corrected code and permission sets, where they must pass, and against the current ones and other faulty versions, where they must catch the fault. A faulty version counts as caught only when one of your tests fails on an assertion; a test that stops with an error does not catch it.

How it must behave (`CGR Claim Export`, procedure `ExportOpenDamages(): Integer`; event `OnExportDamage(DamageEntry: Record "CGR Damage Entry")`; the `Claimed` field on `CGR Damage Entry`):

- It sends every damage entry that is not Repaired and not yet Claimed to the insurance app (`OnExportDamage`), marks it Claimed, and returns the number sent.
- The insurance app may refuse a damage with an error. Then the export fails with that error and no damage of this run is marked Claimed.
- Claims handlers (`CGR CLAIMS HANDLER`) can run the export.
- Front-desk agents (`CGR FRONT DESK`) have no access to damage entries: for them the export fails with a permission error and the insurer is sent nothing.

Write the test codeunit.
