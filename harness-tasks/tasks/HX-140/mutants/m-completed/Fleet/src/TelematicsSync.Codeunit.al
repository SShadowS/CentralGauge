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
        TelematicsBatchMark: Codeunit "CGR Telematics Batch Mark";
        Sent: Integer;
        Read: Integer;
    begin
        BindSubscription(TelematicsBatchMark);
        Vehicle.SetCurrentKey("No.");
        if Vehicle.FindSet() then
            repeat
                Read += 1;
                if not Vehicle.Blocked then begin
                    SyncVehicle(Vehicle."No.");
                    Sent += 1;
                end;
            until Vehicle.Next() = 0;
        UnbindSubscription(TelematicsBatchMark);
        OnBatchCompleted(Read);
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
