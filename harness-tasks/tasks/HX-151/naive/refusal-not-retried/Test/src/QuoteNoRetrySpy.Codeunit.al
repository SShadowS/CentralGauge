codeunit 80589 "CGR Quote No Retry Spy"
{
    EventSubscriberInstance = Manual;

    var
        NoRetryPremium: Decimal;
        NoRetryAsked: Integer;
        NoRetryRefused: Text[100];
        NoRetryRefusedErr: Label 'Partner refused vehicle %1.', Comment = '%1 = vehicle number';

    procedure SetNoRetryPremium(NewPremium: Decimal)
    begin
        NoRetryPremium := NewPremium;
    end;

    procedure NoRetryAskedCount(): Integer
    begin
        exit(NoRetryAsked);
    end;

    procedure RefuseNoRetryCustomer(CustomerName: Text[100])
    begin
        NoRetryRefused := CustomerName;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Quote Mgt", 'OnGetPremium', '', false, false)]
    local procedure NoRetryGivePremium(VehicleNo: Code[20]; Days: Integer; var Premium: Decimal)
    begin
        NoRetryAsked += 1;
        Premium := NoRetryPremium;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Quote Booking", 'OnAfterBookQuote', '', false, false)]
    local procedure NoRetryRefuseBooking(var Contract: Record "CGR Rental Contract")
    begin
        if (NoRetryRefused <> '') and (Contract."Customer Name" = NoRetryRefused) then
            Error(NoRetryRefusedErr, Contract."Vehicle No.");
    end;
}
