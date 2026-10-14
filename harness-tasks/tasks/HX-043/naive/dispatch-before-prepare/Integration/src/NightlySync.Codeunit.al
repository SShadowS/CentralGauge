codeunit 70412 "CGR Nightly Sync"
{
    procedure RunNightlySync(): Integer
    var
        SyncRun: Record "CGR Nightly Sync Run";
        Entry: Record "CGR Outbox Entry";
        Dispatcher: Codeunit "CGR Outbox Dispatcher";
        RunNo: Integer;
        Delivered: Integer;
    begin
        SyncRun.Init();
        SyncRun."Started At" := CurrentDateTime();
        SyncRun.Completed := false;
        SyncRun.Insert(true);
        RunNo := SyncRun."Run No.";

        Delivered := Dispatcher.DispatchPending(Entry);

        RaiseBeforeNightlySync(SyncRun);

        SyncRun.Get(RunNo);
        SyncRun.Dispatched := Delivered;
        SyncRun.Completed := true;
        SyncRun.Modify(true);
        exit(Delivered);
    end;

    [CommitBehavior(CommitBehavior::Error)]
    local procedure RaiseBeforeNightlySync(var SyncRun: Record "CGR Nightly Sync Run")
    begin
        OnBeforeNightlySync(SyncRun);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforeNightlySync(var SyncRun: Record "CGR Nightly Sync Run")
    begin
    end;
}
