codeunit 71304 "CG X146 Bonus Distributor"
{
    /// <summary>
    /// Spreads a bonus pool across every recorded "CG X146 Commission Line"
    /// in proportion to each line's Base Amount, storing the result in
    /// Bonus Share. A line with a Base Amount of zero never shares in the
    /// pool while other lines have a Base Amount to share it. When there is
    /// nothing to allocate the pool is left undistributed.
    /// </summary>
    procedure DistributeBonus(PoolAmount: Decimal)
    var
        CommissionLine: Record "CG X146 Commission Line";
        SalespersonCode: array[50] of Code[20];
        BaseAmount: array[50] of Decimal;
        ShareAmount: array[50] of Decimal;
        Remainder: array[50] of Decimal;
        Awarded: array[50] of Boolean;
        LineCount: Integer;
        BaseSum: Decimal;
        FloorSum: Decimal;
        ExactShare: Decimal;
        RemainingResidual: Decimal;
        WinnerIndex: Integer;
        i: Integer;
    begin
        CommissionLine.Reset();
        LineCount := 0;
        BaseSum := 0;
        if CommissionLine.FindSet() then
            repeat
                LineCount += 1;
                SalespersonCode[LineCount] := CommissionLine."Salesperson Code";
                BaseAmount[LineCount] := CommissionLine."Base Amount";
                BaseSum += CommissionLine."Base Amount";
            until CommissionLine.Next() = 0;

        if BaseSum = 0 then
            exit;

        FloorSum := 0;
        for i := 1 to LineCount do begin
            ExactShare := PoolAmount * BaseAmount[i] / BaseSum;
            ShareAmount[i] := Round(ExactShare, 0.01, '<');
            Remainder[i] := ExactShare - ShareAmount[i];
            FloorSum += ShareAmount[i];
        end;

        RemainingResidual := PoolAmount - FloorSum;
        while RemainingResidual >= 0.005 do begin
            WinnerIndex := 0;
            for i := 1 to LineCount do
                if not Awarded[i] then
                    // AL's "or" does not short-circuit, so evaluating
                    // Remainder[WinnerIndex] in the same condition as
                    // "WinnerIndex = 0" indexes Remainder[0] on the first
                    // candidate - guard it with a nested if instead.
                    if WinnerIndex = 0 then
                        WinnerIndex := i
                    else
                        if (Remainder[i] > Remainder[WinnerIndex]) or
                           ((Remainder[i] = Remainder[WinnerIndex]) and (SalespersonCode[i] < SalespersonCode[WinnerIndex]))
                        then
                            WinnerIndex := i;
            ShareAmount[WinnerIndex] += 0.01;
            Awarded[WinnerIndex] := true;
            RemainingResidual -= 0.01;
        end;

        for i := 1 to LineCount do begin
            CommissionLine.Get(SalespersonCode[i]);
            CommissionLine."Bonus Share" := ShareAmount[i];
            CommissionLine.Modify();
        end;
    end;
}
