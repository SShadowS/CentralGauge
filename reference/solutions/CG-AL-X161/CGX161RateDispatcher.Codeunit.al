codeunit 71456 "CG X161 Rate Dispatcher"
{
    procedure Quote(Carrier: Enum "CG X161 Carrier"; WeightKg: Decimal; Zone: Code[10]): Decimal
    var
        Provider: Interface "CG X161 Rate Provider";
    begin
        Provider := Carrier;
        exit(Provider.GetQuote(WeightKg, Zone));
    end;

    procedure IsShippable(Carrier: Enum "CG X161 Carrier"; WeightKg: Decimal; Zone: Code[10]): Boolean
    var
        Provider: Interface "CG X161 Rate Provider";
    begin
        Provider := Carrier;
        exit(Provider.CanShip(WeightKg, Zone));
    end;
}
