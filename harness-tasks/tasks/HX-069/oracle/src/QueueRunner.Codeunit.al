codeunit 86841 "HX069 Queue Runner"
{
    var
        RunVehicleNos: List of [Code[20]];
        QueuedCount: Integer;

    trigger OnRun()
    var
        BulkQueue: Codeunit "CGR Outbox Bulk Queue";
    begin
        QueuedCount := BulkQueue.QueueCheckedOutVehicles(RunVehicleNos);
    end;

    procedure HX069SetVehicleNos(VehicleNos: List of [Code[20]])
    begin
        RunVehicleNos := VehicleNos;
        QueuedCount := -1;
    end;

    procedure HX069Queued(): Integer
    begin
        exit(QueuedCount);
    end;
}
