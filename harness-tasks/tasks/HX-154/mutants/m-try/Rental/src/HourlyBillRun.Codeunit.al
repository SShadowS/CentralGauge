codeunit 70289 "CGR Hourly Bill Run"
{
    var
        BillContract: Record "CGR Rental Contract";
        BillHours: Integer;
        BillDiscountPct: Decimal;

    procedure SetBill(Contract: Record "CGR Rental Contract"; Hours: Integer; DiscountPct: Decimal)
    begin
        BillContract := Contract;
        BillHours := Hours;
        BillDiscountPct := DiscountPct;
    end;

    trigger OnRun()
    begin
        WriteHourlyBill();
    end;

    [TryFunction]
    procedure TryWriteHourlyBill()
    begin
        WriteHourlyBill();
    end;

    local procedure WriteHourlyBill()
    var
        Vehicle: Record "CGR Vehicle";
        Bill: Record "CGR Hourly Bill";
    begin
        Vehicle.Get(BillContract."Vehicle No.");
        Bill.Init();
        Bill."Contract No." := BillContract."No.";
        Bill.Hours := BillHours;
        Bill.Amount := Round(BillHours * Vehicle."Hourly Rate" * (100 - BillDiscountPct) / 100, 0.01);
        Bill.Insert(true);
        OnAfterBillHourly(Bill);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterBillHourly(Bill: Record "CGR Hourly Bill")
    begin
    end;
}
