codeunit 70298 "CGR Tariff Indexation"
{
    procedure IndexDailyRates(IndexPct: Decimal; RateCeiling: Decimal): Integer
    var
        Tariff: Record "CGR Rental Tariff";
        Raised: Integer;
    begin
        Tariff.SetCurrentKey("Daily Rate");
        if Tariff.FindSet() then
            repeat
                if Tariff."Daily Rate" < RateCeiling then begin
                    RaiseTariff(Tariff, IndexPct, RateCeiling);
                    Raised += 1;
                end;
            until Tariff.Next() = 0;
        exit(Raised);
    end;

    local procedure RaiseTariff(var Tariff: Record "CGR Rental Tariff"; IndexPct: Decimal; RateCeiling: Decimal)
    var
        IndexEntry: Record "CGR Tariff Index Entry";
        AmountRounding: Codeunit "CGR Amount Rounding";
        NewRate: Decimal;
    begin
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
