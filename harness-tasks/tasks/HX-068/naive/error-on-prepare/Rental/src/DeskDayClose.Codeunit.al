codeunit 70231 "CGR Desk Day Close"
{
    procedure CloseDeskDay(var ContractFilter: Record "CGR Rental Contract"): Integer
    var
        BatchPost: Codeunit "CGR Rental Batch Post";
        PostedCount: Integer;
    begin
        PrepareDeskDayClose(ContractFilter);
        PostedCount := BatchPost.PostBatch(ContractFilter);
        OnAfterCloseDeskDay(PostedCount);
        exit(PostedCount);
    end;

    [CommitBehavior(CommitBehavior::Error)]
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
