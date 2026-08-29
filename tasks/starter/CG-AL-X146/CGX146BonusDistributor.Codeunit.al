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
        BaseSum: Decimal;
        RunningAllocated: Decimal;
        TotalLines: Integer;
        CurrentLine: Integer;
        LineShare: Decimal;
    begin
        CommissionLine.Reset();
        if CommissionLine.FindSet() then
            repeat
                BaseSum += CommissionLine."Base Amount";
            until CommissionLine.Next() = 0;

        if BaseSum = 0 then
            exit;

        TotalLines := CommissionLine.Count();

        CurrentLine := 0;
        RunningAllocated := 0;
        if CommissionLine.FindSet() then
            repeat
                CurrentLine += 1;
                // The last commission line closes out whatever the other
                // lines' individually rounded shares left on the table, so
                // the recorded shares always add up to the pool exactly.
                if CurrentLine = TotalLines then
                    LineShare := PoolAmount - RunningAllocated
                else
                    LineShare := Round(PoolAmount * CommissionLine."Base Amount" / BaseSum, 0.01);
                CommissionLine."Bonus Share" := LineShare;
                RunningAllocated += LineShare;
                CommissionLine.Modify();
            until CommissionLine.Next() = 0;
    end;
}
