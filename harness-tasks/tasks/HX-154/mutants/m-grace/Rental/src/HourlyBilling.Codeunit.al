codeunit 70288 "CGR Hourly Billing"
{
    procedure BillHourly(ContractNo: Code[20]): Boolean
    var
        Contract: Record "CGR Rental Contract";
        Bill: Record "CGR Hourly Bill";
        BillRun: Codeunit "CGR Hourly Bill Run";
        Hours: Integer;
        DiscountPct: Decimal;
    begin
        Contract.Get(ContractNo);
        Bill.SetRange("Contract No.", ContractNo);
        if not Bill.IsEmpty() then
            exit(false);
        Hours := (Contract."Returned At" - Contract."Picked Up At" + 3540999) div 3600000;
        OnGetHourlyDiscount(Contract, Hours, DiscountPct);
        BillRun.SetBill(Contract, Hours, DiscountPct);
        exit(BillRun.Run());
    end;

    [IntegrationEvent(false, false)]
    local procedure OnGetHourlyDiscount(Contract: Record "CGR Rental Contract"; Hours: Integer; var DiscountPct: Decimal)
    begin
    end;
}
