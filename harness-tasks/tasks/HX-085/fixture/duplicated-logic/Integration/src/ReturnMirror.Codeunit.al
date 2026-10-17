codeunit 70428 "CGR Return Mirror"
{
    SingleInstance = true;
    EventSubscriberInstance = Manual;

    var
        Running: Boolean;

    procedure StartReturnMirror()
    var
        ReturnMirror: Codeunit "CGR Return Mirror";
    begin
        if Running then
            exit;
        BindSubscription(ReturnMirror);
        Running := true;
    end;

    procedure StopReturnMirror()
    var
        ReturnMirror: Codeunit "CGR Return Mirror";
    begin
        UnbindSubscription(ReturnMirror);
        Running := false;
    end;

    procedure IsReturnMirrorOn(): Boolean
    begin
        exit(Running);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Core Events", 'OnAfterVehicleReturned', '', false, false)]
    local procedure MirrorReturn(VehicleNo: Code[20]; ReturnKm: Integer; DamageDescription: Text[100])
    var
        Entry: Record "CGR Outbox Entry";
        Payload: JsonObject;
        PayloadText: Text;
    begin
        Payload.Add('event', 'mirrorReturn');
        Payload.Add('vehicleNo', VehicleNo);
        Payload.WriteTo(PayloadText);
        Entry.Init();
        Entry."Event Type" := 'mirrorReturn';
        Entry."Vehicle No." := VehicleNo;
        Entry.Payload := CopyStr(PayloadText, 1, MaxStrLen(Entry.Payload));
        Entry."Created At" := CurrentDateTime();
        Entry.Insert(true);
    end;
}
