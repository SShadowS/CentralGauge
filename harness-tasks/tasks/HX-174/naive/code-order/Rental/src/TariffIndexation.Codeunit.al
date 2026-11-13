codeunit 70298 "CGR Tariff Indexation"
{
    procedure IndexDailyRates(IndexPct: Decimal; RateCeiling: Decimal): Integer
    var
        Tariff: Record "CGR Rental Tariff";
        Raised: Integer;
    begin
        if Tariff.FindSet() then
            repeat
                if Tariff."Daily Rate" < RateCeiling then begin
                    RaiseTariff(Tariff.Code, IndexPct, RateCeiling);
                    Raised += 1;
                end;
            until Tariff.Next() = 0;
        exit(Raised);
    end;

    local procedure RaiseTariff(TariffCode: Code[20]; IndexPct: Decimal; RateCeiling: Decimal)
    var
        Tariff: Record "CGR Rental Tariff";
        IndexEntry: Record "CGR Tariff Index Entry";
        AmountRounding: Codeunit "CGR Amount Rounding";
        NewRate: Decimal;
    begin
        Tariff.Get(TariffCode);
        NewRate := AmountRounding.RoundAmount(Tariff."Daily Rate" + Tariff."Daily Rate" * IndexPct / 100);
        if NewRate > RateCeiling then
            NewRate := RateCeiling;
        IndexEntry.Init();
        IndexEntry."Tariff Code" := Tariff.Code;
        IndexEntry."Old Rate" := Tariff."Daily Rate";
        IndexEntry."New Rate" := NewRate;
        IndexEntry.Insert();
        Tariff."Daily Rate" := NewRate;
        Tariff.Modify(true);
    end;
}
