codeunit 71303 "CG X146 Base Calculator"
{
    /// <summary>
    /// Rebuilds "CG X146 Commission Line" from every "CG X146 Sales Entry"
    /// currently recorded. Each salesperson who has at least one sales
    /// entry gets exactly one commission line, whose Base Amount is the sum
    /// of that salesperson's own entries and nothing else - a run's totals
    /// must never depend on which other salespeople were processed
    /// alongside them.
    /// </summary>
    procedure BuildBases()
    var
        SalesEntry: Record "CG X146 Sales Entry";
        CommissionLine: Record "CG X146 Commission Line";
        RunningTotal: Decimal;
        CurrentSalesperson: Code[20];
    begin
        CommissionLine.Reset();
        CommissionLine.DeleteAll();

        SalesEntry.Reset();
        SalesEntry.SetCurrentKey("Salesperson Code");
        if not SalesEntry.FindSet() then
            exit;

        CurrentSalesperson := SalesEntry."Salesperson Code";
        RunningTotal := 0;
        repeat
            if SalesEntry."Salesperson Code" <> CurrentSalesperson then begin
                FlushCommissionLine(CommissionLine, CurrentSalesperson, RunningTotal);
                CurrentSalesperson := SalesEntry."Salesperson Code";
            end;
            RunningTotal += SalesEntry.Amount;
        until SalesEntry.Next() = 0;

        FlushCommissionLine(CommissionLine, CurrentSalesperson, RunningTotal);
    end;

    local procedure FlushCommissionLine(var CommissionLine: Record "CG X146 Commission Line"; SalespersonCode: Code[20]; BaseAmount: Decimal)
    begin
        CommissionLine.Init();
        CommissionLine."Salesperson Code" := SalespersonCode;
        CommissionLine."Base Amount" := BaseAmount;
        CommissionLine.Insert();
    end;
}
