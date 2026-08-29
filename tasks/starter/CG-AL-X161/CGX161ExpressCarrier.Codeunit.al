codeunit 71455 "CG X161 Express Carrier" implements "CG X161 Rate Provider"
{
    procedure GetQuote(WeightKg: Decimal; Zone: Code[10]): Decimal
    begin
        exit(0);
    end;

    procedure CanShip(WeightKg: Decimal; Zone: Code[10]): Boolean
    begin
        exit(false);
    end;
}
