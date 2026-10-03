# Task 7461: Move the session's branch out of the session context

Reported by Platform team.

`CGR Session Context` (Core) holds two things for the session today: the cached `CGR Setup` and the branch the user is working in. We want the branch handling in its own codeunit, so that it can grow without touching the Setup cache.

Requirement:

- Add a codeunit `CGR Branch Context` to Core with `CurrentBranch(): Code[10]` and `SetCurrentBranch(NewBranchCode: Code[10])`. The session's current branch lives there.
- `CGR Session Context` keeps `CurrentBranch` and `SetCurrentBranch` with their signatures, because other apps call them. Whichever of the two codeunits sets the branch, both report the same current branch to every caller in the session.
- The branch behaves as it does today: an explicitly set branch wins; without one, the current branch is the "Default Branch Code" of the Setup the session has loaded, so a change to Setup shows after `RefreshSetup` is called and not before. `CGR Session Context`, Reset clears the explicit branch together with the Setup cache. RefreshSetup keeps an explicit branch.
- `CGR Rental Mgt`, CreateContract: a new contract takes its "Branch Code" from `CGR Branch Context`.
