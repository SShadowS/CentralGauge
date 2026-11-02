# Task 7701: Give the shared part of the approval list its own procedure

Requested by Platform team.

`CGR Rental Approvals.BuildApprovalList(ApprovalFilter, UserID, Result)` (Rental) builds the list of open approvals for a user: their own open approval entries within the filters the caller set on ApprovalFilter, plus the open entries that colleagues share with them, either always (colleague sharing) or while the colleague is out of office. Each kind of sharing is switched on in Setup. At the end it raises `OnAfterBuildApprovalList`, so partner apps can add rows of their own.

Two things to change:

1. Partners report that their rows never appear unless sharing is switched on in Setup. `OnAfterBuildApprovalList` must be raised exactly once for every call of `BuildApprovalList`, whether sharing is on or off.
2. The shared approvals are needed elsewhere too. Move that part into its own public procedure in the same codeunit:

   `procedure AddSharedApprovals(var ApprovalEntry: Record "CGR Approval Entry"; UserID: Code[50]; var Result: Record "CGR Approval Entry" temporary)`

   It adds to Result the approval entries shared with UserID, under the selection ApprovalEntry describes, and respects the sharing switches in Setup. It does not raise `OnAfterBuildApprovalList`. `BuildApprovalList` uses it.

Apart from the event, the list `BuildApprovalList` returns must not change.
