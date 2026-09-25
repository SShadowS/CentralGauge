codeunit 70002 "CGR Lease Math"
{
    internal procedure RateFactor(Months: Integer): Decimal
    begin
        exit(1 + Months / 100);
    end;

    internal procedure LeaseTotal(BaseRate: Decimal; Months: Integer): Decimal
    begin
        exit(Round(BaseRate * RateFactor(Months) * Months, 0.01));
    end;

    internal procedure SplitInstallments(Total: Decimal; Count: Integer; var Amounts: List of [Decimal])
    var
        Installment: Decimal;
        Allocated: Decimal;
        i: Integer;
    begin
        Clear(Amounts);
        Installment := Round(Total / Count, 0.01);
        for i := 1 to Count do begin
            Amounts.Add(Installment);
            Allocated += Installment;
        end;
    end;
}
