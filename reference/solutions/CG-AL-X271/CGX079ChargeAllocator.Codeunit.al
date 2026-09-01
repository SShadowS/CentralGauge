codeunit 70442 "CG X079 Charge Allocator"
{
    /// <summary>
    /// Spreads a header's total charge amount across its lines in proportion
    /// to each line's weight, then marks the header as allocated.
    /// </summary>
    procedure AllocateCharge(DocumentNo: Code[20])
    var
        ChargeHeader: Record "CG X079 Charge Header";
        ChargeLine: Record "CG X079 Charge Line";
        WeightSum: Decimal;
        RunningExact: Decimal;
        HandedOut: Decimal;
        LineAmount: Decimal;
    begin
        ChargeHeader.Get(DocumentNo);

        ChargeLine.SetRange("Document No.", DocumentNo);
        if ChargeLine.FindSet() then
            repeat
                WeightSum += ChargeLine.Weight;
            until ChargeLine.Next() = 0;

        if WeightSum = 0 then
            exit;

        // Distribute the total charge across the lines in proportion to
        // each line's share of the total weight, keeping a running exact
        // cumulative share and handing out only what has not already been
        // recorded on an earlier line, so the recorded amounts always close
        // on the total exactly.
        if ChargeLine.FindSet() then
            repeat
                RunningExact += ChargeHeader."Total Charge Amount" * ChargeLine.Weight / WeightSum;
                LineAmount := Round(RunningExact, 0.01) - HandedOut;
                HandedOut += LineAmount;
                ChargeLine."Allocated Amount" := LineAmount;
                ChargeLine.Modify();
            until ChargeLine.Next() = 0;

        ChargeHeader.Allocated := true;
        ChargeHeader.Modify();
    end;

    /// <summary>
    /// Returns the sum of the allocated amounts already posted to a
    /// header's lines, for reconciliation against the header total.
    /// </summary>
    procedure GetAllocatedTotal(DocumentNo: Code[20]): Decimal
    var
        ChargeLine: Record "CG X079 Charge Line";
    begin
        ChargeLine.SetRange("Document No.", DocumentNo);
        ChargeLine.CalcSums("Allocated Amount");
        exit(ChargeLine."Allocated Amount");
    end;
}
