codeunit 70427 "CGR Checkout Mirror"
{
    SingleInstance = true;
    EventSubscriberInstance = Manual;

    var
        Running: Boolean;

    procedure StartCheckoutMirror()
    var
        CheckoutMirror: Codeunit "CGR Checkout Mirror";
        DeskMirror: Codeunit "CGR Desk Mirror";
    begin
        DeskMirror.SetCheckoutMirror(true);
        if Running then
            exit;
        BindSubscription(CheckoutMirror);
        Running := true;
    end;

    procedure StopCheckoutMirror()
    var
        CheckoutMirror: Codeunit "CGR Checkout Mirror";
        DeskMirror: Codeunit "CGR Desk Mirror";
    begin
        DeskMirror.SetCheckoutMirror(false);
        UnbindSubscription(CheckoutMirror);
        Running := false;
    end;

    procedure IsCheckoutMirrorOn(): Boolean
    begin
        exit(Running);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Core Events", 'OnAfterVehicleCheckedOut', '', false, false)]
    local procedure MirrorCheckout(VehicleNo: Code[20])
    var
        Entry: Record "CGR Outbox Entry";
        Payload: JsonObject;
        PayloadText: Text;
    begin
        Payload.Add('event', 'mirrorCheckOut');
        Payload.Add('vehicleNo', VehicleNo);
        Payload.WriteTo(PayloadText);
        Entry.Init();
        Entry."Event Type" := 'mirrorCheckOut';
        Entry."Vehicle No." := VehicleNo;
        Entry.Payload := CopyStr(PayloadText, 1, MaxStrLen(Entry.Payload));
        Entry."Created At" := CurrentDateTime();
        Entry.Insert(true);
    end;
}
