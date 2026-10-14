# Feature 7580: A nightly outbox run that partners can prepare

Reported by the Integration team.

Today someone starts the outbox dispatch by hand. We want one nightly run that dispatches everything that is pending, and partner apps want to prepare that run, for example by queueing more outbox entries just before it dispatches.

Requirement:

- A new table `CGR Nightly Sync Run` (70413, Integration) with the fields `"Run No."` (Integer, AutoIncrement, primary key), `"Started At"` (DateTime), `Dispatched` (Integer) and `Completed` (Boolean).
- A new codeunit `CGR Nightly Sync` (70412, Integration) with `RunNightlySync(): Integer`.
- `RunNightlySync`:
  1. Records the run as a new `CGR Nightly Sync Run` row with `"Started At"` set and `Completed` false.
  2. Raises an integration event `OnBeforeNightlySync(var SyncRun: Record "CGR Nightly Sync Run")` on `CGR Nightly Sync`, so partner apps can prepare the run.
  3. Dispatches every pending outbox entry, exactly as `DispatchPending` of `CGR Outbox Dispatcher` does when it is given no filter. Entries queued while the run was prepared are dispatched in the same run. Every dispatch attempt is kept the way `DispatchEntry` keeps it today, and an entry that is not delivered does not stop the run.
  4. Sets the run's `Dispatched` to the number of entries delivered and `Completed` to true, and returns that number.
- Preparing the run may not commit. When a commit is attempted while the run is being prepared, for example by a subscriber, the run fails with the error raised for that commit, and nothing of the run is kept: no run row, nothing written while the run was being prepared, and no dispatch attempt.
- When a subscriber raises an error while the run is being prepared, the run fails with that error and nothing of the run is kept either.
- `CGR Outbox Dispatcher`, its event and its behaviour stay as they are.
