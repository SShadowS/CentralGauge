codeunit 80518 "CGR Channel Happy Refusal Spy"
{
    EventSubscriberInstance = Manual;

    var
        HappyRefuse: Boolean;
        HappyRefusedErr: Label 'Channel manager refusal (happy suite).';

    procedure RefuseHappyBookings()
    begin
        HappyRefuse := true;
    end;

    procedure HappyRefusalText(): Text
    begin
        exit(HappyRefusedErr);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Web Booking Create", 'OnAfterImportBooking', '', false, false)]
    local procedure RefuseHappyBooking(ContractNo: Code[20])
    begin
        if HappyRefuse then
            Error(HappyRefusedErr);
    end;
}
