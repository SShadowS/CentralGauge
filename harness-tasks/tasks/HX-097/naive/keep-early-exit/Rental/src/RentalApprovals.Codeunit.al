codeunit 70270 "CGR Rental Approvals"
{
    procedure BuildApprovalList(var ApprovalFilter: Record "CGR Approval Entry"; UserID: Code[50]; var Result: Record "CGR Approval Entry" temporary)
    var
        Entry: Record "CGR Approval Entry";
        Setup: Record "CGR Setup";
    begin
        Result.Reset();
        Result.DeleteAll();

        Entry.CopyFilters(ApprovalFilter);
        Entry.SetRange(Status, Entry.Status::Open);
        Entry.SetRange("Approver ID", UserID);
        if Entry.FindSet() then
            repeat
                Result := Entry;
                Result.Insert();
            until Entry.Next() = 0;

        if not Setup.Get() then
            Setup.Init();
        if not (Setup."Share Approvals with Colleagues" or Setup."Share Approvals Out of Office") then
            exit;

        AddSharedApprovals(Entry, UserID, Result);

        OnAfterBuildApprovalList(UserID, Result);
    end;

    procedure AddSharedApprovals(var ApprovalEntry: Record "CGR Approval Entry"; UserID: Code[50]; var Result: Record "CGR Approval Entry" temporary)
    var
        Sharing: Record "CGR Approval Sharing";
        Setup: Record "CGR Setup";
    begin
        if not Setup.Get() then
            Setup.Init();
        if not (Setup."Share Approvals with Colleagues" or Setup."Share Approvals Out of Office") then
            exit;

        Sharing.SetRange("Shared With ID", UserID);
        if Sharing.FindSet() then
            repeat
                if ((Sharing."Sharing Type" = Sharing."Sharing Type"::Colleague) and Setup."Share Approvals with Colleagues") or
                   ((Sharing."Sharing Type" = Sharing."Sharing Type"::"Out of Office") and Setup."Share Approvals Out of Office")
                then begin
                    ApprovalEntry.SetRange("Approver ID", Sharing."Owner ID");
                    if ApprovalEntry.FindSet() then
                        repeat
                            if not Result.Get(ApprovalEntry."Entry No.") then begin
                                Result := ApprovalEntry;
                                Result.Insert();
                            end;
                        until ApprovalEntry.Next() = 0;
                end;
            until Sharing.Next() = 0;
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterBuildApprovalList(UserID: Code[50]; var Result: Record "CGR Approval Entry" temporary)
    begin
    end;
}
