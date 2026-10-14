codeunit 86321 "HX043 Sync Partner"
{
    EventSubscriberInstance = Manual;

    var
        PrepareVehicleNo: Code[20];
        CommitAfterPrepare: Boolean;
        FailAfterPrepare: Boolean;
        FailingVehicles: List of [Code[20]];
        PrepareCalls: Integer;
        SeenRunNo: Integer;
        SeenCompleted: Boolean;
        SeenStartedAt: DateTime;
        SeenRowInTable: Boolean;
        PreparationFailedErr: Label 'HX043 preparation failed.';
        SendFailedErr: Label 'HX043 send failed for %1.', Comment = '%1 = vehicle number';

    procedure SetPreparation(VehicleNo: Code[20]; ThenCommit: Boolean; ThenFail: Boolean)
    begin
        PrepareVehicleNo := VehicleNo;
        CommitAfterPrepare := ThenCommit;
        FailAfterPrepare := ThenFail;
    end;

    procedure FailSendFor(VehicleNo: Code[20])
    begin
        FailingVehicles.Add(VehicleNo);
    end;

    procedure PreparationCalls(): Integer
    begin
        exit(PrepareCalls);
    end;

    procedure PreparedRunNo(): Integer
    begin
        exit(SeenRunNo);
    end;

    procedure PreparedRunCompleted(): Boolean
    begin
        exit(SeenCompleted);
    end;

    procedure PreparedRunStartedAt(): DateTime
    begin
        exit(SeenStartedAt);
    end;

    procedure PreparedRunInTable(): Boolean
    begin
        exit(SeenRowInTable);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Nightly Sync", 'OnBeforeNightlySync', '', false, false)]
    local procedure PrepareRun(var SyncRun: Record "CGR Nightly Sync Run")
    var
        StoredRun: Record "CGR Nightly Sync Run";
        Facade: Codeunit "CGR Integration Facade";
    begin
        PrepareCalls += 1;
        SeenRunNo := SyncRun."Run No.";
        SeenCompleted := SyncRun.Completed;
        SeenStartedAt := SyncRun."Started At";
        SeenRowInTable := StoredRun.Get(SyncRun."Run No.");
        if SeenRowInTable then
            SeenRowInTable := (not StoredRun.Completed) and (StoredRun."Started At" <> 0DT);
        if PrepareVehicleNo = '' then
            exit;
        Facade.QueueVehicleCheckedOut(PrepareVehicleNo);
        if CommitAfterPrepare then
            Commit();
        if FailAfterPrepare then
            Error(PreparationFailedErr);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Outbox Dispatcher", 'OnSendEntry', '', false, false)]
    local procedure SendEntry(Entry: Record "CGR Outbox Entry"; var Delivered: Boolean)
    begin
        if FailingVehicles.Contains(Entry."Vehicle No.") then
            Error(SendFailedErr, Entry."Vehicle No.");
        Delivered := true;
    end;
}
