codeunit 70231 "CGR Desk Day Close"
{
    var
        ExportPostedCount: Integer;

    trigger OnRun()
    begin
        OnAfterCloseDeskDay(ExportPostedCount);
    end;

    procedure CloseDeskDay(var ContractFilter: Record "CGR Rental Contract"): Integer
    var
        BatchPost: Codeunit "CGR Rental Batch Post";
        DayExport: Codeunit "CGR Desk Day Close";
        PostedCount: Integer;
    begin
        PrepareDeskDayClose(ContractFilter);
        PostedCount := BatchPost.PostBatch(ContractFilter);
        // An export must not undo the postings.
        DayExport.SetExportPostedCount(PostedCount);
        if DayExport.Run() then;
        exit(PostedCount);
    end;

    internal procedure SetExportPostedCount(NewPostedCount: Integer)
    begin
        ExportPostedCount := NewPostedCount;
    end;

    [CommitBehavior(CommitBehavior::Ignore)]
    local procedure PrepareDeskDayClose(var ContractFilter: Record "CGR Rental Contract")
    begin
        OnBeforeCloseDeskDay(ContractFilter);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforeCloseDeskDay(var ContractFilter: Record "CGR Rental Contract")
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterCloseDeskDay(PostedCount: Integer)
    begin
    end;
}
