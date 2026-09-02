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
        // each line's share of the total weight, rounded to the nearest cent.
        if ChargeLine.FindSet() then
            repeat
                LineAmount := Round(ChargeHeader."Total Charge Amount" * ChargeLine.Weight / WeightSum, 0.01);
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
