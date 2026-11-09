codeunit 80582 "CGR Quote Partner Spy"
{
    EventSubscriberInstance = Manual;

    var
        RefusedCustomerName: Text[100];
        PartnerRefusedErr: Label 'The booking partner refused the booking of vehicle %1.', Comment = '%1 = vehicle number';

    procedure RefuseBookingFor(CustomerName: Text[100])
    begin
        RefusedCustomerName := CustomerName;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Quote Booking", 'OnAfterBookQuote', '', false, false)]
    local procedure RefuseQuoteBooking(var Contract: Record "CGR Rental Contract")
    begin
        if (RefusedCustomerName <> '') and (Contract."Customer Name" = RefusedCustomerName) then
            Error(PartnerRefusedErr, Contract."Vehicle No.");
    end;
}
