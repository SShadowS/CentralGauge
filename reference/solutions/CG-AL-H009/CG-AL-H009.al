codeunit 70213 "CG Price Calculator"
{
    Access = Public;

    procedure CalculateLineAmount(UnitPrice: Decimal; Quantity: Decimal; DiscountPercent: Decimal; CurrencyCode: Code[10]): Decimal
    var
        Currency: Record Currency;
        LineAmount: Decimal;
    begin
        GetCurrency(Currency, CurrencyCode);

        LineAmount := UnitPrice * Quantity;
        LineAmount := LineAmount * (1 - DiscountPercent / 100);

        exit(Round(LineAmount, Currency."Amount Rounding Precision"));
    end;

    procedure CalculateUnitPriceFromAmount(TotalAmount: Decimal; Quantity: Decimal; CurrencyCode: Code[10]): Decimal
    var
        Currency: Record Currency;
        UnitPrice: Decimal;
    begin
        if Quantity = 0 then
            exit(0);

        GetCurrency(Currency, CurrencyCode);

        UnitPrice := TotalAmount / Quantity;

        exit(Round(UnitPrice, Currency."Unit-Amount Rounding Precision"));
    end;

    procedure RoundAmount(Amount: Decimal; CurrencyCode: Code[10]; Direction: Text[1]): Decimal
    var
        Currency: Record Currency;
    begin
        GetCurrency(Currency, CurrencyCode);

        exit(Round(Amount, Currency."Amount Rounding Precision", Direction));
    end;

    procedure GetVATAmount(BaseAmount: Decimal; VATPercent: Decimal; CurrencyCode: Code[10]): Decimal
    var
        Currency: Record Currency;
        VATAmount: Decimal;
    begin
        GetCurrency(Currency, CurrencyCode);

        VATAmount := BaseAmount * VATPercent / 100;

        exit(Round(VATAmount, Currency."Amount Rounding Precision"));
    end;

    local procedure GetCurrency(var Currency: Record Currency; CurrencyCode: Code[10])
    begin
        Clear(Currency);
        if CurrencyCode = '' then
            Currency.InitRoundingPrecision()
        else
            if Currency.Get(CurrencyCode) then begin
                if Currency."Amount Rounding Precision" = 0 then
                    Currency."Amount Rounding Precision" := 0.01;
                if Currency."Unit-Amount Rounding Precision" = 0 then
                    Currency."Unit-Amount Rounding Precision" := 0.00001;
            end else
                Currency.InitRoundingPrecision();
    end;
}