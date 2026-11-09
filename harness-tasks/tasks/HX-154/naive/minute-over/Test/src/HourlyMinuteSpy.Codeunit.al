codeunit 80615 "CGR Hourly Minute Spy"
{
    EventSubscriberInstance = Manual;

    var
        MinuteDiscountPct: Decimal;
        MinuteRefusedNo: Code[20];
        MinuteRefusedErr: Label 'Payment refused for %1.', Comment = '%1 = contract number';

    procedure SetMinuteDiscount(NewDiscountPct: Decimal)
    begin
        MinuteDiscountPct := NewDiscountPct;
    end;

    procedure SetMinuteRefusal(ContractNo: Code[20])
    begin
        MinuteRefusedNo := ContractNo;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Hourly Billing", 'OnGetHourlyDiscount', '', false, false)]
    local procedure MinuteDiscount(Contract: Record "CGR Rental Contract"; Hours: Integer; var DiscountPct: Decimal)
    begin
        DiscountPct := MinuteDiscountPct;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Hourly Bill Run", 'OnAfterBillHourly', '', false, false)]
    local procedure MinuteRefusal(Bill: Record "CGR Hourly Bill")
    begin
        if (MinuteRefusedNo <> '') and (Bill."Contract No." = MinuteRefusedNo) then
            Error(MinuteRefusedErr, Bill."Contract No.");
    end;
}
