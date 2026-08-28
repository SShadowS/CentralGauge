codeunit 71002 "CG X140 Rebate Allocator"
{
    /// <summary>
    /// Spreads a header's total rebate amount across its lines in
    /// proportion to each line's allocation weight, then marks the header
    /// as allocated. Within a document that has any weight to allocate, a
    /// line with an allocation weight of zero - a free-of-charge sample
    /// line, for example - is not entitled to any share of the rebate and
    /// must always end up with a Rebate Amount of zero. A document whose
    /// lines carry no allocation weight at all has nothing to allocate and
    /// is left exactly as it is.
    /// </summary>
    procedure AllocateRebate(DocumentNo: Code[20])
    var
        RebateHeader: Record "CG X140 Rebate Header";
        RebateLine: Record "CG X140 Rebate Line";
        WeightSum: Decimal;
        RunningAllocated: Decimal;
        TotalLines: Integer;
        CurrentLine: Integer;
        LineAmount: Decimal;
    begin
        RebateHeader.Get(DocumentNo);

        RebateLine.SetRange("Document No.", DocumentNo);
        if RebateLine.FindSet() then
            repeat
                WeightSum += RebateLine."Allocation Weight";
            until RebateLine.Next() = 0;

        if WeightSum = 0 then
            exit;

        TotalLines := RebateLine.Count();

        CurrentLine := 0;
        RunningAllocated := 0;
        if RebateLine.FindSet() then
            repeat
                CurrentLine += 1;
                // The last line on the document closes out whatever the
                // other lines' individually rounded shares left on the
                // table, so the recorded amounts always add up to the
                // header total exactly.
                if CurrentLine = TotalLines then
                    LineAmount := RebateHeader."Total Rebate Amount" - RunningAllocated
                else
                    LineAmount := Round(RebateHeader."Total Rebate Amount" * RebateLine."Allocation Weight" / WeightSum, 0.01);
                RebateLine."Rebate Amount" := LineAmount;
                RunningAllocated += LineAmount;
                RebateLine.Modify();
            until RebateLine.Next() = 0;

        RebateHeader.Allocated := true;
        RebateHeader.Modify();
    end;

    /// <summary>
    /// Returns the sum of the rebate amounts already recorded on a
    /// document's lines, for reconciliation against the header total.
    /// </summary>
    procedure GetAllocatedTotal(DocumentNo: Code[20]): Decimal
    var
        RebateLine: Record "CG X140 Rebate Line";
    begin
        RebateLine.SetRange("Document No.", DocumentNo);
        RebateLine.CalcSums("Rebate Amount");
        exit(RebateLine."Rebate Amount");
    end;
}
