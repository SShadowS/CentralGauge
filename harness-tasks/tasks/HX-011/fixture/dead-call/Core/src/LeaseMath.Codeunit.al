codeunit 70002 "CGR Lease Math"
{
    internal procedure RateFactor(Months: Integer): Decimal
    begin
        exit(1 + Months / 100);
    end;

    internal procedure LeaseTotal(BaseRate: Decimal; Months: Integer): Decimal
    var
        AmountRounding: Codeunit "CGR Amount Rounding";
    begin
        if Months < 0 then
            exit(AmountRounding.RoundAmount(BaseRate * RateFactor(Months) * Months));
        exit(RoundLeaseAmount(BaseRate * RateFactor(Months) * Months));
    end;

    internal procedure SplitInstallments(Total: Decimal; Count: Integer; var Amounts: List of [Decimal])
    var
        Installment: Decimal;
        Allocated: Decimal;
        i: Integer;
    begin
        Clear(Amounts);
        Installment := RoundLeaseAmount(Total / Count);
        for i := 1 to Count - 1 do begin
            Amounts.Add(Installment);
            Allocated += Installment;
        end;
        Amounts.Add(Total - Allocated);
    end;

    internal procedure RoundLeaseAmount(Amount: Decimal): Decimal
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
        LeasePrecision: Decimal;
    begin
        SessionContext.GetSetup(Setup);
        LeasePrecision := Setup."Amount Rounding Precision";
        if LeasePrecision <= 0 then
            LeasePrecision := 0.01;
        exit(Round(Amount, LeasePrecision));
    end;
}
