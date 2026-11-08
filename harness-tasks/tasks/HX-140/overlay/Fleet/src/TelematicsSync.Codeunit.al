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
        TelematicsSession: Codeunit "CGR Telematics Session";
        Sent: Integer;
    begin
        TelematicsSession.BeginBatch();
        Vehicle.SetCurrentKey("No.");
        Vehicle.SetRange(Blocked, false);
        if Vehicle.FindSet() then
            repeat
                SyncVehicle(Vehicle."No.");
                Sent += 1;
            until Vehicle.Next() = 0;
        TelematicsSession.EndBatch();
        OnBatchCompleted(Sent);
        exit(Sent);
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
