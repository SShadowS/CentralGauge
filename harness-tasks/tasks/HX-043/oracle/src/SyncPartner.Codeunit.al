codeunit 86321 "HX043 Sync Partner"
{
    EventSubscriberInstance = Manual;

    var
        PrepareVehicleNo: Code[20];
        CommitAfterPrepare: Boolean;
        FailAfterPrepare: Boolean;
        FailingVehicles: List of [Code[20]];
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

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Nightly Sync", 'OnBeforeNightlySync', '', false, false)]
    local procedure PrepareRun(var SyncRun: Record "CGR Nightly Sync Run")
    var
        Facade: Codeunit "CGR Integration Facade";
    begin
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
