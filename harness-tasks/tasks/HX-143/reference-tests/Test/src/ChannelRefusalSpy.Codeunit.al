codeunit 80512 "CGR Channel Refusal Spy"
{
    EventSubscriberInstance = Manual;

    var
        RefuseBookings: Boolean;
        ChannelRefusedErr: Label 'The channel manager refused the web booking.';

    procedure RefuseEveryBooking()
    begin
        RefuseBookings := true;
    end;

    procedure ChannelRefusalText(): Text
    begin
        exit(ChannelRefusedErr);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Web Booking Create", 'OnAfterImportBooking', '', false, false)]
    local procedure RefuseImportedBooking(ContractNo: Code[20])
    begin
        if RefuseBookings then
            Error(ChannelRefusedErr);
    end;
}
