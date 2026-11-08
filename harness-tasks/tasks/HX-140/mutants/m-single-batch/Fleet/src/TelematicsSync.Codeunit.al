codeunit 70150 "CGR Telematics Sync"
{
    procedure SyncVehicle(VehicleNo: Code[20])
    var
        Payload: JsonObject;
    begin
        Payload.Add('vehicleNo', VehicleNo);
        OnBeforeSendVehicle(VehicleNo, Payload);
        if not Payload.Contains('batch') then
            Payload.Add('batch', true);
        OnSendVehicle(VehicleNo, Payload);
    end;

    procedure SyncAll(): Integer
    var
        Vehicle: Record "CGR Vehicle";
        TelematicsBatchMark: Codeunit "CGR Telematics Batch Mark";
        Sent: Integer;
    begin
        BindSubscription(TelematicsBatchMark);
        Vehicle.SetCurrentKey("No.");
        Vehicle.SetRange(Blocked, false);
        if Vehicle.FindSet() then
            repeat
                SyncVehicle(Vehicle."No.");
                Sent += 1;
            until Vehicle.Next() = 0;
        UnbindSubscription(TelematicsBatchMark);
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
