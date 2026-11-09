codeunit 80612 "CGR Hourly Partner Spy"
{
    EventSubscriberInstance = Manual;

    var
        LoyaltyDiscountPct: Decimal;
        RefusedContractNo: Code[20];
        PaymentRefusedErr: Label 'The payment app refused the hourly bill of contract %1.', Comment = '%1 = contract number';

    procedure GiveLoyaltyDiscount(NewDiscountPct: Decimal)
    begin
        LoyaltyDiscountPct := NewDiscountPct;
    end;

    procedure RefuseHourlyPayment(ContractNo: Code[20])
    begin
        RefusedContractNo := ContractNo;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Hourly Billing", 'OnGetHourlyDiscount', '', false, false)]
    local procedure SupplyLoyaltyDiscount(Contract: Record "CGR Rental Contract"; Hours: Integer; var DiscountPct: Decimal)
    begin
        DiscountPct := LoyaltyDiscountPct;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Hourly Bill Run", 'OnAfterBillHourly', '', false, false)]
    local procedure RefuseHourlyBillOfContract(Bill: Record "CGR Hourly Bill")
    begin
        if (RefusedContractNo <> '') and (Bill."Contract No." = RefusedContractNo) then
            Error(PaymentRefusedErr, Bill."Contract No.");
    end;
}
