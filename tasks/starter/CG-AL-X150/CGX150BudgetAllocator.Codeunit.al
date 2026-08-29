codeunit 71344 "CG X150 Budget Allocator"
{
    /// <summary>
    /// Spreads a budget's total amount across its departments in
    /// proportion to each department's weight, storing each department's
    /// share in its Department Amount. Then spreads each department's own
    /// Department Amount across that department's teams in proportion to
    /// each team's weight, storing each team's share in its Team Amount,
    /// and marks the budget as allocated.
    /// </summary>
    procedure AllocateBudget(BudgetNo: Code[20])
    var
        BudgetHeader: Record "CG X150 Budget Header";
        Department: Record "CG X150 Department";
        Team: Record "CG X150 Team";
        DeptWeightSum: Decimal;
        TeamWeightSum: Decimal;
        DeptAmount: Decimal;
        TeamAmount: Decimal;
    begin
        BudgetHeader.Get(BudgetNo);

        Department.SetRange("Budget No.", BudgetNo);
        DeptWeightSum := 0;
        if Department.FindSet() then
            repeat
                DeptWeightSum += Department.Weight;
            until Department.Next() = 0;

        if DeptWeightSum = 0 then
            exit;

        // Distribute the total across departments in proportion to each
        // department's share of the total weight, rounded to the nearest
        // cent.
        if Department.FindSet() then
            repeat
                DeptAmount := Round(BudgetHeader."Total Amount" * Department.Weight / DeptWeightSum, 0.01);
                Department."Department Amount" := DeptAmount;
                Department.Modify();
            until Department.Next() = 0;

        // Now spread each department's own (already-rounded) amount
        // across its teams, the same way.
        Department.SetRange("Budget No.", BudgetNo);
        if Department.FindSet() then
            repeat
                Team.SetRange("Budget No.", BudgetNo);
                Team.SetRange("Department Line No.", Department."Line No.");
                TeamWeightSum := 0;
                if Team.FindSet() then
                    repeat
                        TeamWeightSum += Team.Weight;
                    until Team.Next() = 0;

                if TeamWeightSum <> 0 then
                    if Team.FindSet() then
                        repeat
                            TeamAmount := Round(Department."Department Amount" * Team.Weight / TeamWeightSum, 0.01);
                            Team."Team Amount" := TeamAmount;
                            Team.Modify();
                        until Team.Next() = 0;
            until Department.Next() = 0;

        BudgetHeader.Allocated := true;
        BudgetHeader.Modify();
    end;

    /// <summary>
    /// Returns the sum of the department amounts already recorded on a
    /// budget, for reconciliation against the budget's own total amount.
    /// </summary>
    procedure GetAllocatedTotal(BudgetNo: Code[20]): Decimal
    var
        Department: Record "CG X150 Department";
    begin
        Department.SetRange("Budget No.", BudgetNo);
        Department.CalcSums("Department Amount");
        exit(Department."Department Amount");
    end;

    /// <summary>
    /// Returns the sum of the team amounts already recorded under one
    /// department of a budget, for reconciliation against that
    /// department's own recorded amount.
    /// </summary>
    procedure GetDepartmentAllocatedTotal(BudgetNo: Code[20]; DepartmentLineNo: Integer): Decimal
    var
        Team: Record "CG X150 Team";
    begin
        Team.SetRange("Budget No.", BudgetNo);
        Team.SetRange("Department Line No.", DepartmentLineNo);
        Team.CalcSums("Team Amount");
        exit(Team."Team Amount");
    end;
}
