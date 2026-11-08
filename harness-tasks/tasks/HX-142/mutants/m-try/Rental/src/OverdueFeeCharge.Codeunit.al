codeunit 70258 "CGR Overdue Fee Charge"
{
    TableNo = "CGR Rental Contract";

    var
        AsOfDate: Date;

    procedure SetAsOf(NewAsOf: Date)
    begin
        AsOfDate := NewAsOf;
    end;

    procedure DaysDue(Contract: Record "CGR Rental Contract"): Integer
    var
        Settings: Codeunit "CGR Overdue Fee Settings";
        FromDate: Date;
    begin
        FromDate := Contract."End Date" + Settings.GraceDays();
        if Contract."Fees Charged Through" > FromDate then
            FromDate := Contract."Fees Charged Through";
        if AsOfDate <= FromDate then
            exit(0);
        exit(AsOfDate - FromDate);
    end;

    trigger OnRun()
    begin
        ChargeInPlace(Rec);
    end;

    procedure ChargeInPlace(Contract: Record "CGR Rental Contract")
    var
        Settings: Codeunit "CGR Overdue Fee Settings";
        Fee: Record "CGR Overdue Fee Entry";
    begin
        Fee.Init();
        Fee."Contract No." := Contract."No.";
        Fee.Days := DaysDue(Contract);
        Fee.Amount := Fee.Days * Settings.FeePerDay();
        OnBeforeChargeOverdueFee(Contract, Fee.Amount);
        Fee.Insert(true);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforeChargeOverdueFee(Contract: Record "CGR Rental Contract"; Amount: Decimal)
    begin
    end;
}
