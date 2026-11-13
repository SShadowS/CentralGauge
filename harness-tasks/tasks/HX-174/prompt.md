# Bug 5174: The yearly tariff indexation cuts daily rates

Reported by the Price board.

The yearly indexation (`CGR Tariff Indexation`.`IndexDailyRates`, Rental) raises the daily rates of the rental tariffs by the index the price board sets, up to a ceiling, and writes an index entry for each tariff it raises. The price board prints the entries of a run in entry order and reads them as the tariffs from the lowest old rate up.

Observed: after this year's run with an index of 4 percent, every tariff below the ceiling came out at a few percent of its old daily rate.

Expected: each run raises every tariff whose daily rate is below RateCeiling exactly once, by IndexPct percent of its rate before the run, rounded to the amount precision and never above RateCeiling, and returns the number of tariffs it raised. A tariff at or above RateCeiling keeps its rate, gets no entry and is not counted. Each raised tariff gets one index entry with its old and its new rate, and the entries of a run follow the old rates, lowest first.

Keep the public procedure of `CGR Tariff Indexation` and the two tables as they are.

Shipped code:

```al
// Rental: CGR Rental Tariff has Code (PK), Description, "Daily Rate" (Decimal), key ByDailyRate("Daily Rate").
// CGR Tariff Index Entry has "Entry No." (AutoIncrement, PK), "Tariff Code", "Old Rate", "New Rate".

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
        NewRate := AmountRounding.RoundAmount(Tariff."Daily Rate" * IndexPct / 100);
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
```

Write the corrected AL for the affected procedures and explain briefly.
