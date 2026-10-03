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
        AmountRounding: Codeunit "CGR Amount Rounding";
        Installment: Decimal;
        Allocated: Decimal;
        i: Integer;
    begin
        Clear(Amounts);
        Installment := AmountRounding.RoundAmount(Total / Count);
        for i := 1 to Count - 1 do begin
            Amounts.Add(Installment);
            Allocated += Installment;
        end;
        Amounts.Add(Total - Allocated);
    end;
}
