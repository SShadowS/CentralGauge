codeunit 70288 "CGR Hourly Billing"
{
    procedure BillHourly(ContractNo: Code[20]): Boolean
    var
        Contract: Record "CGR Rental Contract";
        BillRun: Codeunit "CGR Hourly Bill Run";
        Hours: Integer;
        DiscountPct: Decimal;
    begin
        Contract.Get(ContractNo);
        Hours := (Contract."Returned At" - Contract."Picked Up At" + 3599999) div 3600000;
        OnGetHourlyDiscount(Contract, Hours, DiscountPct);
        BillRun.SetBill(Contract, Hours, DiscountPct);
        exit(BillRun.Run());
    end;

    [IntegrationEvent(false, false)]
    local procedure OnGetHourlyDiscount(Contract: Record "CGR Rental Contract"; Hours: Integer; var DiscountPct: Decimal)
    begin
    end;
}
