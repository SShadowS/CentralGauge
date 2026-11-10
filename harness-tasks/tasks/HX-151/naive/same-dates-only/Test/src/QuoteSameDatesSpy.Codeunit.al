codeunit 80585 "CGR Quote Same Dates Spy"
{
    EventSubscriberInstance = Manual;

    var
        SameDatesPremium: Decimal;
        SameDatesAsked: Integer;
        SameDatesRefused: Text[100];
        SameDatesRefusedErr: Label 'Partner refused vehicle %1.', Comment = '%1 = vehicle number';

    procedure SetSameDatesPremium(NewPremium: Decimal)
    begin
        SameDatesPremium := NewPremium;
    end;

    procedure SameDatesAskedCount(): Integer
    begin
        exit(SameDatesAsked);
    end;

    procedure RefuseSameDatesCustomer(CustomerName: Text[100])
    begin
        SameDatesRefused := CustomerName;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Quote Mgt", 'OnGetPremium', '', false, false)]
    local procedure SameDatesGivePremium(VehicleNo: Code[20]; Days: Integer; var Premium: Decimal)
    begin
        SameDatesAsked += 1;
        Premium := SameDatesPremium;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Quote Booking", 'OnAfterBookQuote', '', false, false)]
    local procedure SameDatesRefuseBooking(var Contract: Record "CGR Rental Contract")
    begin
        if (SameDatesRefused <> '') and (Contract."Customer Name" = SameDatesRefused) then
            Error(SameDatesRefusedErr, Contract."Vehicle No.");
    end;
}
