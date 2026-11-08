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
        exit(AsOfDate - FromDate + 1);
    end;

    trigger OnRun()
    var
        Settings: Codeunit "CGR Overdue Fee Settings";
        Fee: Record "CGR Overdue Fee Entry";
    begin
        Fee.Init();
        Fee."Contract No." := Rec."No.";
        Fee.Days := DaysDue(Rec);
        Fee.Amount := Fee.Days * Settings.FeePerDay();
        OnBeforeChargeOverdueFee(Rec, Fee.Amount);
        Fee.Insert(true);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforeChargeOverdueFee(Contract: Record "CGR Rental Contract"; Amount: Decimal)
    begin
    end;
}
