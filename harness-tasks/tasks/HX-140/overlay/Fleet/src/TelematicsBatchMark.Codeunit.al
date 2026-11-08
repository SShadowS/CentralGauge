codeunit 70152 "CGR Telematics Batch Mark"
{
    EventSubscriberInstance = Manual;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Telematics Sync", 'OnBeforeSendVehicle', '', false, false)]
    local procedure MarkTelematicsBatch(VehicleNo: Code[20]; var Payload: JsonObject)
    begin
        Payload.Add('batch', true);
    end;
}
