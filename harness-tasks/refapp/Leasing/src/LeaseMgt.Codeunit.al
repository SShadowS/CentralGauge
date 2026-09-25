codeunit 70300 "CGR Lease Mgt"
{
    procedure MonthlyRate(BaseRate: Decimal; Months: Integer): Decimal
    var
        LeaseMath: Codeunit "CGR Lease Math";
    begin
        exit(Round(BaseRate * LeaseMath.RateFactor(Months), 0.01));
    end;
}
