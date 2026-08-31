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
        LineNo: array[10] of Integer;
        Weight: array[10] of Decimal;
        FloorShare: array[10] of Decimal;
        Remainder: array[10] of Decimal;
        Awarded: array[10] of Boolean;
        WeightSum: Decimal;
        FloorSum: Decimal;
        RemainingResidual: Decimal;
        ExactShare: Decimal;
        LineCount: Integer;
        WinnerIndex: Integer;
        i: Integer;
    begin
        RebateHeader.Get(DocumentNo);

        RebateLine.SetRange("Document No.", DocumentNo);
        WeightSum := 0;
        LineCount := 0;
        if RebateLine.FindSet() then
            repeat
                LineCount += 1;
                LineNo[LineCount] := RebateLine."Line No.";
                Weight[LineCount] := RebateLine."Allocation Weight";
                WeightSum += RebateLine."Allocation Weight";
            until RebateLine.Next() = 0;

        if WeightSum = 0 then
            exit;

        // First pass: every line gets the floor of its exact proportional
        // share. A zero-weight line always floors to zero and never earns
        // a remainder, so it can never end up with anything else below.
        FloorSum := 0;
        for i := 1 to LineCount do begin
            Awarded[i] := false;
            if Weight[i] = 0 then begin
                FloorShare[i] := 0;
                Remainder[i] := 0;
            end else begin
                ExactShare := RebateHeader."Total Rebate Amount" * Weight[i] / WeightSum;
                FloorShare[i] := Round(ExactShare, 0.01, '<');
                Remainder[i] := ExactShare - FloorShare[i];
                FloorSum += FloorShare[i];
            end;
        end;

        // Second pass: whatever the floors left on the table is handed
        // out one cent at a time to the lines closest to rounding up,
        // regardless of which line happens to be entered last. Two lines
        // tied on remainder are broken by the lower line number, so the
        // outcome never depends on the order the lines were entered in.
        RemainingResidual := RebateHeader."Total Rebate Amount" - FloorSum;
        while RemainingResidual >= 0.005 do begin
            WinnerIndex := 0;
            for i := 1 to LineCount do
                if (Weight[i] <> 0) and (not Awarded[i]) then
                    // AL's "or" does not short-circuit, so a single
                    // condition with "WinnerIndex = 0 or Remainder[i] >
                    // Remainder[WinnerIndex]" still evaluates
                    // Remainder[WinnerIndex] on the very first candidate,
                    // indexing Remainder[0] - guard it with a nested if
                    // instead.
                    if WinnerIndex = 0 then
                        WinnerIndex := i
                    else
                        if (Remainder[i] > Remainder[WinnerIndex]) or
                           ((Remainder[i] = Remainder[WinnerIndex]) and (LineNo[i] < LineNo[WinnerIndex]))
                        then
                            WinnerIndex := i;
            FloorShare[WinnerIndex] += 0.01;
            Awarded[WinnerIndex] := true;
            RemainingResidual -= 0.01;
        end;

        for i := 1 to LineCount do begin
            RebateLine.Get(DocumentNo, LineNo[i]);
            RebateLine."Rebate Amount" := FloorShare[i];
            RebateLine.Modify();
        end;

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
