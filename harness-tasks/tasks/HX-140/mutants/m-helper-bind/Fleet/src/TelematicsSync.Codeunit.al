codeunit 70150 "CGR Telematics Sync"
{
    procedure SyncVehicle(VehicleNo: Code[20])
    var
        Payload: JsonObject;
    begin
        Payload.Add('vehicleNo', VehicleNo);
        OnBeforeSendVehicle(VehicleNo, Payload);
        OnSendVehicle(VehicleNo, Payload);
    end;

    procedure SyncAll(): Integer
    var
        Vehicle: Record "CGR Vehicle";
        Sent: Integer;
    begin
        StartTelematicsBatch();
        Vehicle.SetCurrentKey("No.");
        Vehicle.SetRange(Blocked, false);
        if Vehicle.FindSet() then
            repeat
                SyncVehicle(Vehicle."No.");
                Sent += 1;
            until Vehicle.Next() = 0;
        OnBatchCompleted(Sent);
        exit(Sent);
    end;

    local procedure StartTelematicsBatch()
    var
        TelematicsBatchMark: Codeunit "CGR Telematics Batch Mark";
    begin
        BindSubscription(TelematicsBatchMark);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforeSendVehicle(VehicleNo: Code[20]; var Payload: JsonObject)
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnSendVehicle(VehicleNo: Code[20]; Payload: JsonObject)
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBatchCompleted(VehicleCount: Integer)
    begin
    end;
}
