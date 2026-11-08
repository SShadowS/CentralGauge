codeunit 80489 "CGR PayloadOnly Telematics Spy"
{
    EventSubscriberInstance = Manual;

    var
        PayloadOnlyRefusedNo: Code[20];
        PayloadOnlySeen: Dictionary of [Code[20], Integer];
        PayloadOnlyMarks: Dictionary of [Code[20], Boolean];
        PayloadOnlyRefusedErr: Label 'Vehicle %1 was refused by the telematics partner.', Comment = '%1 = vehicle number';

    procedure PayloadOnlyRefuse(VehicleNo: Code[20])
    begin
        PayloadOnlyRefusedNo := VehicleNo;
    end;

    procedure PayloadOnlyRefusalText(VehicleNo: Code[20]): Text
    begin
        exit(StrSubstNo(PayloadOnlyRefusedErr, VehicleNo));
    end;

    procedure PayloadOnlyCount(VehicleNo: Code[20]): Integer
    var
        Seen: Integer;
    begin
        if PayloadOnlySeen.Get(VehicleNo, Seen) then
            exit(Seen);
        exit(0);
    end;

    procedure PayloadOnlyMarked(VehicleNo: Code[20]): Boolean
    var
        Marked: Boolean;
    begin
        if PayloadOnlyMarks.Get(VehicleNo, Marked) then
            exit(Marked);
        exit(false);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Telematics Sync", 'OnSendVehicle', '', false, false)]
    local procedure PayloadOnlyReceive(VehicleNo: Code[20]; Payload: JsonObject)
    var
        BatchToken: JsonToken;
        Marked: Boolean;
    begin
        PayloadOnlySeen.Set(VehicleNo, PayloadOnlyCount(VehicleNo) + 1);
        if Payload.Get('batch', BatchToken) then
            Marked := BatchToken.AsValue().AsBoolean();
        PayloadOnlyMarks.Set(VehicleNo, Marked);
        if (PayloadOnlyRefusedNo <> '') and (VehicleNo = PayloadOnlyRefusedNo) then
            Error(PayloadOnlyRefusedErr, VehicleNo);
    end;
}
