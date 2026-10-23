# Feature 7755: Close the desk day in one step

Reported by the Front desk.

At the end of the day the desk posts the returned rental contracts with `CGR Rental Batch Post` by hand. We want one step that closes the desk day, and partner apps want to take part in it: before anything is posted they prepare the day close (for example they narrow which contracts are closed, or write data of their own), and after posting they export the day.

Requirement:

- A new codeunit `CGR Desk Day Close` (70231, Rental) with `CloseDeskDay(var ContractFilter: Record "CGR Rental Contract"): Integer`.
- `CGR Desk Day Close` publishes two integration events:
  - `OnBeforeCloseDeskDay(var ContractFilter: Record "CGR Rental Contract")`, raised first, so partner apps can prepare the day close. A subscriber may change the filters on ContractFilter; the day close then closes the contracts of the changed filter.
  - `OnAfterCloseDeskDay(PostedCount: Integer)`, raised after posting with the number of contracts posted, so partner apps can export the day.
- `CloseDeskDay` posts every returned contract in the filter exactly as `PostBatch` of `CGR Rental Batch Post` does: each contract is posted on its own, and a contract whose posting fails stays returned, is logged in the batch error log and does not stop the others. It returns the number of contracts posted.
- What a partner app writes while it prepares the day close is kept with the day close.
- A commit by a partner app while it prepares the day close makes nothing durable. When the preparation fails after such a commit, nothing written during the preparation is kept. The commit on its own does not fail the day close.
- When a subscriber raises an error while the day close is being prepared, the day close fails with that error, nothing written during the preparation is kept and no contract is posted.
- When a subscriber raises an error during the export, the day close fails with that error. Everything posted and logged before it, and what was written during the preparation, stays.
- `CGR Rental Batch Post` and its behaviour stay as they are.
