codeunit 70205 "CG Line Amount Engine"
{
    Access = Public;

    procedure CalculateLineAmount(UnitPrice: Decimal; Quantity: Decimal; DiscountPercent: Decimal; RoundingPrecision: Decimal): Decimal
    var
        Gross: Decimal;
        DiscountAmount: Decimal;
        Net: Decimal;
        Result: Decimal;
    begin
        if (UnitPrice < 0) or (Quantity < 0) or (DiscountPercent < 0) or (RoundingPrecision < 0) then
            Error(NegativeInputErr);

        if RoundingPrecision = 0 then
            Error(ZeroRoundingPrecisionErr);

        if (UnitPrice = 0) or (Quantity = 0) then begin
            Result := 0;
            OnAfterCalculateLineAmount(Result, UnitPrice, Quantity, DiscountPercent, RoundingPrecision);
            exit(Result);
        end;

        if DiscountPercent > 100 then
            DiscountPercent := 100;

        Gross := UnitPrice * Quantity;
        DiscountAmount := Round(Gross * (DiscountPercent / 100), RoundingPrecision, '=');
        Net := Gross - DiscountAmount;
        Result := Round(Net, RoundingPrecision, '=');

        OnAfterCalculateLineAmount(Result, UnitPrice, Quantity, DiscountPercent, RoundingPrecision);
        exit(Result);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterCalculateLineAmount(var Result: Decimal; UnitPrice: Decimal; Quantity: Decimal; DiscountPercent: Decimal; RoundingPrecision: Decimal)
    begin
    end;

    var
        NegativeInputErr: Label 'Inputs cannot be negative';
        ZeroRoundingPrecisionErr: Label 'Rounding precision must be greater than zero';
}