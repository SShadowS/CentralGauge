codeunit 70321 "CGR Lease Start Charge"
{
    procedure FirstInstallment(ContractNo: Code[20]): Decimal
    var
        Contract: Record "CGR Lease Contract";
        LeaseMath: Codeunit "CGR Lease Math";
        Rate: Decimal;
        DaysInMonth: Integer;
        DaysLeft: Integer;
    begin
        Contract.Get(ContractNo);
        Rate := Round(Contract."Base Rate" * LeaseMath.RateFactor(Contract.Months), 0.01);
        DaysInMonth := Date2DMY(CalcDate('<CM>', Contract."Start Date"), 1);
        DaysLeft := DaysInMonth - Date2DMY(Contract."Start Date", 1) + 1;
        exit(Round(Rate * (DaysLeft div DaysInMonth), 0.01));
    end;
}
