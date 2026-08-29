codeunit 71543 "CG X170 Charge Allocator"
{
    /// <summary>
    /// Spreads a charge's Total Amount across its cost centers in
    /// proportion to each cost center's Weight, storing each cost
    /// center's share in its Allocated Amount, and marks the charge
    /// header Allocated. A cost center with a Weight of zero, within a
    /// charge that has other weight to allocate, is never entitled to
    /// any share and always ends up with an Allocated Amount of exactly
    /// zero. A charge with no weight on any of its cost centers has
    /// nothing to allocate and is left exactly as it is.
    /// </summary>
    procedure AllocateCharge(ChargeNo: Code[20])
    var
        ChargeHeader: Record "CG X170 Charge Header";
        CostCenter: Record "CG X170 Cost Center";
        Weight: array[10] of Decimal;
        Share: array[10] of Decimal;
        WeightSum: Decimal;
        Count: Integer;
        i: Integer;
    begin
        ChargeHeader.Get(ChargeNo);

        CostCenter.SetRange("Charge No.", ChargeNo);
        Count := 0;
        WeightSum := 0;
        if CostCenter.FindSet() then
            repeat
                Count += 1;
                Weight[Count] := CostCenter.Weight;
                WeightSum += CostCenter.Weight;
            until CostCenter.Next() = 0;

        if (Count = 0) or (WeightSum = 0) then
            exit;

        AllocateSharesByLargestRemainder(ChargeHeader."Total Amount", Weight, Count, Share);

        i := 0;
        CostCenter.SetRange("Charge No.", ChargeNo);
        if CostCenter.FindSet() then
            repeat
                i += 1;
                CostCenter."Allocated Amount" := Share[i];
                CostCenter.Modify();
            until CostCenter.Next() = 0;

        ChargeHeader.Allocated := true;
        ChargeHeader.Modify();
    end;

    /// <summary>
    /// Records a payback against a charge, splitting ReversalAmount
    /// across the charge's cost centers and storing each cost center's
    /// share as a Reversed Amount in a "CG X170 Reversal Line" record
    /// under the given Reversal No. The Reversed Amounts recorded for
    /// one Reversal No. always sum to exactly ReversalAmount, and every
    /// cost center's net remaining amount (its Allocated Amount less
    /// everything reversed against it so far, across every Reversal No.
    /// recorded against the charge) always equals a fresh, whole-cent,
    /// largest-remainder allocation of whatever is left of the charge's
    /// Total Amount not yet reversed - however many separate reversals
    /// it took to get there.
    /// </summary>
    procedure ReverseCharge(ChargeNo: Code[20]; ReversalNo: Code[20]; ReversalAmount: Decimal)
    var
        ChargeHeader: Record "CG X170 Charge Header";
        CostCenter: Record "CG X170 Cost Center";
        ReversalLine: Record "CG X170 Reversal Line";
        Weight: array[10] of Decimal;
        OldNet: array[10] of Decimal;
        NewAllocation: array[10] of Decimal;
        LineNo: array[10] of Integer;
        RemainingTotal: Decimal;
        Count: Integer;
        i: Integer;
    begin
        ChargeHeader.Get(ChargeNo);

        CostCenter.SetRange("Charge No.", ChargeNo);
        Count := 0;
        if CostCenter.FindSet() then
            repeat
                Count += 1;
                LineNo[Count] := CostCenter."Line No.";
                Weight[Count] := CostCenter.Weight;
                OldNet[Count] := GetNetAmount(ChargeNo, CostCenter."Line No.");
            until CostCenter.Next() = 0;

        if Count = 0 then
            exit;

        // What every cost center's net amount must equal once this
        // reversal is recorded: a fresh largest-remainder split of
        // whatever is left of the charge after every reversal so far,
        // including this one - not a split of ReversalAmount on its
        // own. Each cost center's share of THIS reversal is then simply
        // the difference between what it holds now and that fresh
        // target.
        RemainingTotal := ChargeHeader."Total Amount" - GetChargeReversedTotal(ChargeNo) - ReversalAmount;
        AllocateSharesByLargestRemainder(RemainingTotal, Weight, Count, NewAllocation);

        for i := 1 to Count do begin
            ReversalLine.Init();
            ReversalLine."Charge No." := ChargeNo;
            ReversalLine."Reversal No." := ReversalNo;
            ReversalLine."Cost Center Line No." := LineNo[i];
            ReversalLine."Reversed Amount" := OldNet[i] - NewAllocation[i];
            ReversalLine.Insert();
        end;
    end;

    /// <summary>
    /// Returns the sum of the Allocated Amounts already recorded on a
    /// charge's cost centers, for reconciliation against the charge's
    /// own Total Amount.
    /// </summary>
    procedure GetAllocatedTotal(ChargeNo: Code[20]): Decimal
    var
        CostCenter: Record "CG X170 Cost Center";
    begin
        CostCenter.SetRange("Charge No.", ChargeNo);
        CostCenter.CalcSums("Allocated Amount");
        exit(CostCenter."Allocated Amount");
    end;

    /// <summary>
    /// Returns the sum of the Reversed Amounts recorded under one
    /// Reversal No. of a charge, for reconciliation against the amount
    /// that reversal was for.
    /// </summary>
    procedure GetReversedTotal(ChargeNo: Code[20]; ReversalNo: Code[20]): Decimal
    var
        ReversalLine: Record "CG X170 Reversal Line";
    begin
        ReversalLine.SetRange("Charge No.", ChargeNo);
        ReversalLine.SetRange("Reversal No.", ReversalNo);
        ReversalLine.CalcSums("Reversed Amount");
        exit(ReversalLine."Reversed Amount");
    end;

    /// <summary>
    /// Returns the sum of every Reversed Amount recorded against a
    /// charge, across every Reversal No. on it.
    /// </summary>
    procedure GetChargeReversedTotal(ChargeNo: Code[20]): Decimal
    var
        ReversalLine: Record "CG X170 Reversal Line";
    begin
        ReversalLine.SetRange("Charge No.", ChargeNo);
        ReversalLine.CalcSums("Reversed Amount");
        exit(ReversalLine."Reversed Amount");
    end;

    /// <summary>
    /// Returns one cost center's net remaining amount: its Allocated
    /// Amount less everything recorded against it across every
    /// Reversal No. on the charge.
    /// </summary>
    procedure GetNetAmount(ChargeNo: Code[20]; CostCenterLineNo: Integer): Decimal
    var
        CostCenter: Record "CG X170 Cost Center";
        ReversalLine: Record "CG X170 Reversal Line";
    begin
        CostCenter.Get(ChargeNo, CostCenterLineNo);
        ReversalLine.SetRange("Charge No.", ChargeNo);
        ReversalLine.SetRange("Cost Center Line No.", CostCenterLineNo);
        ReversalLine.CalcSums("Reversed Amount");
        exit(CostCenter."Allocated Amount" - ReversalLine."Reversed Amount");
    end;

    // Floors every item's exact share of TotalAmount to whole cents,
    // then hands out whatever the floors left on the table one cent at
    // a time to whichever not-yet-topped-up item's exact entitlement
    // was rounded down by the most - so the shares always sum to
    // exactly TotalAmount, whatever the weights.
    local procedure AllocateSharesByLargestRemainder(TotalAmount: Decimal; Weight: array[10] of Decimal; ItemCount: Integer; var Share: array[10] of Decimal)
    var
        Remainder: array[10] of Decimal;
        Awarded: array[10] of Boolean;
        WeightSum: Decimal;
        FloorSum: Decimal;
        RemainingResidual: Decimal;
        ExactShare: Decimal;
        WinnerIndex: Integer;
        i: Integer;
    begin
        WeightSum := 0;
        for i := 1 to ItemCount do
            WeightSum += Weight[i];

        FloorSum := 0;
        for i := 1 to ItemCount do begin
            Awarded[i] := false;
            if (WeightSum = 0) or (Weight[i] = 0) then begin
                Share[i] := 0;
                Remainder[i] := 0;
            end else begin
                ExactShare := TotalAmount * Weight[i] / WeightSum;
                Share[i] := Round(ExactShare, 0.01, '<');
                Remainder[i] := ExactShare - Share[i];
                FloorSum += Share[i];
            end;
        end;

        if WeightSum = 0 then
            exit;

        RemainingResidual := TotalAmount - FloorSum;
        while RemainingResidual >= 0.005 do begin
            WinnerIndex := 0;
            for i := 1 to ItemCount do
                if (Weight[i] <> 0) and (not Awarded[i]) then
                    // AL's "or" does not short-circuit, so evaluating
                    // Remainder[WinnerIndex] in the same condition as
                    // "WinnerIndex = 0" would index Remainder[0] on the
                    // first candidate - guard it with a nested if instead.
                    if WinnerIndex = 0 then
                        WinnerIndex := i
                    else
                        if Remainder[i] > Remainder[WinnerIndex] then
                            WinnerIndex := i;
            Share[WinnerIndex] += 0.01;
            Awarded[WinnerIndex] := true;
            RemainingResidual -= 0.01;
        end;
    end;
}
