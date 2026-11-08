codeunit 80587 "CGR Quote Prices Only Spy"
{
    EventSubscriberInstance = Manual;

    var
        PricesOnlyPremium: Decimal;
        PricesOnlyAsked: Integer;
        PricesOnlyRefused: Text[100];
        PricesOnlyRefusedErr: Label 'Partner refused vehicle %1.', Comment = '%1 = vehicle number';

    procedure SetPricesOnlyPremium(NewPremium: Decimal)
    begin
        PricesOnlyPremium := NewPremium;
    end;

    procedure PricesOnlyAskedCount(): Integer
    begin
        exit(PricesOnlyAsked);
    end;

    procedure RefusePricesOnlyCustomer(CustomerName: Text[100])
    begin
        PricesOnlyRefused := CustomerName;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Quote Mgt", 'OnGetPremium', '', false, false)]
    local procedure PricesOnlyGivePremium(VehicleNo: Code[20]; Days: Integer; var Premium: Decimal)
    begin
        PricesOnlyAsked += 1;
        Premium := PricesOnlyPremium;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Quote Booking", 'OnAfterBookQuote', '', false, false)]
    local procedure PricesOnlyRefuseBooking(var Contract: Record "CGR Rental Contract")
    begin
        if (PricesOnlyRefused <> '') and (Contract."Customer Name" = PricesOnlyRefused) then
            Error(PricesOnlyRefusedErr, Contract."Vehicle No.");
    end;
}
