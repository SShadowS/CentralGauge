codeunit 80619 "CGR Hourly Direct Spy"
{
    EventSubscriberInstance = Manual;

    var
        DirectDiscountPct: Decimal;
        DirectRefusedNo: Code[20];
        DirectRefusedErr: Label 'Payment refused for %1.', Comment = '%1 = contract number';

    procedure SetDirectDiscount(NewDiscountPct: Decimal)
    begin
        DirectDiscountPct := NewDiscountPct;
    end;

    procedure SetDirectRefusal(ContractNo: Code[20])
    begin
        DirectRefusedNo := ContractNo;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Hourly Billing", 'OnGetHourlyDiscount', '', false, false)]
    local procedure DirectDiscount(Contract: Record "CGR Rental Contract"; Hours: Integer; var DiscountPct: Decimal)
    begin
        DiscountPct := DirectDiscountPct;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Hourly Bill Run", 'OnAfterBillHourly', '', false, false)]
    local procedure DirectRefusal(Bill: Record "CGR Hourly Bill")
    begin
        if (DirectRefusedNo <> '') and (Bill."Contract No." = DirectRefusedNo) then
            Error(DirectRefusedErr, Bill."Contract No.");
    end;
}
