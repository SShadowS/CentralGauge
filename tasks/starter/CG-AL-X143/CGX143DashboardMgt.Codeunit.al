codeunit 71071 "CG X143 Dashboard Mgt"
{
    /// Refreshes every tile of an approver's operations dashboard in one
    /// call: the approver's approval-history feed, the given team's
    /// assignment display list, and one workload/latest-activity indicator
    /// row per assignment currently in that list.
    procedure RefreshDashboard(Approver: Code[50]; TeamCode: Code[20]; var HistoryBuffer: Record "CG X134 History Buffer" temporary; var DisplayRow: Record "CG X133 Display Row" temporary; var Indicator: Record "CG X143 Dashboard Indicator" temporary)
    var
        HistoryLoader: Codeunit "CG X134 History Loader";
        DisplayRowBuilder: Codeunit "CG X133 Display Row Builder";
        DispatchCheck: Codeunit "CG X113 Dispatch Check";
        EntryFinder: Codeunit "CG X109 Entry Finder";
        Assignment: Record "CG X133 Assignment";
        ActivityEntry: Record "CG X109 Activity Entry";
    begin
        HistoryLoader.LoadRecentHistory(Approver, HistoryBuffer);

        DisplayRowBuilder.BuildRows(TeamCode, DisplayRow);

        Indicator.Reset();
        Indicator.DeleteAll();

        DisplayRow.Reset();
        DisplayRow.SetRange("Team Code", TeamCode);
        if DisplayRow.FindSet() then
            repeat
                Indicator.Init();
                Indicator."Assignment No." := DisplayRow."Assignment No.";
                Indicator."Has Pending Job" := false;
                Indicator."Latest Activity Amount" := 0;

                if Assignment.Get(DisplayRow."Assignment No.") then
                    Indicator."Has Pending Job" := DispatchCheck.HasPendingJobs(Assignment."Owner Code");

                Clear(ActivityEntry);
                if EntryFinder.FindLatest(DisplayRow."Assignment No.", ActivityEntry) then
                    Indicator."Latest Activity Amount" := ActivityEntry.Amount;

                Indicator.Insert();
            until DisplayRow.Next() = 0;
    end;
}
