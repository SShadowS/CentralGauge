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
    var
        Bill: Record "CGR Hourly Bill";
    begin
        WriteHourlyBill(Bill);
        OnAfterBillHourly(Bill);
    end;

    procedure TryWriteHourlyBill(): Boolean
    var
        Bill: Record "CGR Hourly Bill";
    begin
        WriteHourlyBill(Bill);
        exit(TryAnnounceHourlyBill(Bill));
    end;

    [TryFunction]
    local procedure TryAnnounceHourlyBill(Bill: Record "CGR Hourly Bill")
    begin
        OnAfterBillHourly(Bill);
    end;

    local procedure WriteHourlyBill(var Bill: Record "CGR Hourly Bill")
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Get(BillContract."Vehicle No.");
        Bill.Init();
        Bill."Contract No." := BillContract."No.";
        Bill.Hours := BillHours;
        Bill.Amount := Round(BillHours * Vehicle."Hourly Rate" * (100 - BillDiscountPct) / 100, 0.01);
        Bill.Insert(true);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterBillHourly(Bill: Record "CGR Hourly Bill")
    begin
    end;
}
