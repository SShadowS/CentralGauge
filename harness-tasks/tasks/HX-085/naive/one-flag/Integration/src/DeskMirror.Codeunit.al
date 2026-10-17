codeunit 70429 "CGR Desk Mirror"
{
    SingleInstance = true;
    EventSubscriberInstance = Manual;

    var
        CheckoutOn: Boolean;
        ReturnOn: Boolean;
        Bound: Boolean;

    procedure SetCheckoutMirror(On: Boolean)
    begin
        CheckoutOn := On;
        UpdateBinding();
    end;

    procedure SetReturnMirror(On: Boolean)
    begin
        ReturnOn := On;
        UpdateBinding();
    end;

    procedure IsCheckoutMirrorOn(): Boolean
    begin
        exit(CheckoutOn);
    end;

    procedure IsReturnMirrorOn(): Boolean
    begin
        exit(ReturnOn);
    end;

    local procedure UpdateBinding()
    var
        DeskMirror: Codeunit "CGR Desk Mirror";
    begin
        if (CheckoutOn or ReturnOn) and not Bound then begin
            BindSubscription(DeskMirror);
            Bound := true;
        end;
        if not (CheckoutOn or ReturnOn) and Bound then begin
            UnbindSubscription(DeskMirror);
            Bound := false;
        end;
    end;

    local procedure QueueMirrorEntry(EventType: Text[50]; VehicleNo: Code[20])
    var
        Entry: Record "CGR Outbox Entry";
        Payload: JsonObject;
        PayloadText: Text;
    begin
        Payload.Add('event', EventType);
        Payload.Add('vehicleNo', VehicleNo);
        Payload.WriteTo(PayloadText);
        Entry.Init();
        Entry."Event Type" := EventType;
        Entry."Vehicle No." := VehicleNo;
        Entry.Payload := CopyStr(PayloadText, 1, MaxStrLen(Entry.Payload));
        Entry."Created At" := CurrentDateTime();
        Entry.Insert(true);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Core Events", 'OnAfterVehicleCheckedOut', '', false, false)]
    local procedure MirrorCheckout(VehicleNo: Code[20])
    begin
        QueueMirrorEntry('mirrorCheckOut', VehicleNo);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Core Events", 'OnAfterVehicleReturned', '', false, false)]
    local procedure MirrorReturn(VehicleNo: Code[20]; ReturnKm: Integer; DamageDescription: Text[100])
    begin
        QueueMirrorEntry('mirrorReturn', VehicleNo);
    end;
}
