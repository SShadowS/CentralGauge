interface "CG X161 Rate Provider"
{
    procedure GetQuote(WeightKg: Decimal; Zone: Code[10]): Decimal;
    procedure CanShip(WeightKg: Decimal; Zone: Code[10]): Boolean;
}
