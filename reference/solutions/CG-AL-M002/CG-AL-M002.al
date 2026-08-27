codeunit 70001 "Sales Order Calculator"
{
    Access = Public;

    procedure CalculateLineTotal(Quantity: Decimal; UnitPrice: Decimal): Decimal
    begin
        if Quantity < 0 then
            Error(QuantityMustBePositiveErr);
        if UnitPrice < 0 then
            Error(PriceMustBePositiveErr);

        exit(Quantity * UnitPrice);
    end;

    procedure CalculateLineTotal(Quantity: Decimal; UnitPrice: Decimal; DiscountPercent: Decimal): Decimal
    var
        LineTotal: Decimal;
    begin
        if Quantity < 0 then
            Error(QuantityMustBePositiveErr);
        if UnitPrice < 0 then
            Error(PriceMustBePositiveErr);
        if (DiscountPercent < 0) or (DiscountPercent > 100) then
            Error(InvalidDiscountErr);

        LineTotal := Quantity * UnitPrice;
        LineTotal := LineTotal - (LineTotal * DiscountPercent / 100);

        exit(LineTotal);
    end;

    procedure CalculateOrderTotal(LineTotals: List of [Decimal]): Decimal
    var
        LineTotal: Decimal;
        OrderTotal: Decimal;
    begin
        OrderTotal := 0;
        foreach LineTotal in LineTotals do
            OrderTotal += LineTotal;

        exit(OrderTotal);
    end;

    procedure ApplyVolumeDiscount(OrderTotal: Decimal): Decimal
    begin
        if OrderTotal < 1000 then
            exit(OrderTotal);

        if OrderTotal <= 5000 then
            exit(OrderTotal - (OrderTotal * 5 / 100));

        exit(OrderTotal - (OrderTotal * 10 / 100));
    end;

    procedure ValidateOrderLimits(OrderAmount: Decimal): Boolean
    begin
        exit((OrderAmount >= 10) and (OrderAmount <= 100000));
    end;

    procedure CalculateTaxAmount(NetAmount: Decimal; TaxRate: Decimal): Decimal
    begin
        if TaxRate < 0 then
            Error(InvalidTaxRateErr);

        exit(NetAmount * TaxRate / 100);
    end;

    var
        QuantityMustBePositiveErr: Label 'Quantity must be positive';
        PriceMustBePositiveErr: Label 'Price must be positive';
        InvalidDiscountErr: Label 'Discount percent must be between 0 and 100';
        InvalidTaxRateErr: Label 'Tax rate must not be negative';
}