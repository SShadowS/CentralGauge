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
        DeptWeightSum: Decimal;
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

        AllocateDepartments(BudgetNo, BudgetHeader."Total Amount", DeptWeightSum);
        AllocateAllTeams(BudgetNo);

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

    // Floors every department's exact share of the total to whole cents,
    // then hands out whatever the floors left on the table one cent at a
    // time to whichever not-yet-topped-up department's exact entitlement
    // was rounded down by the most - so the department amounts always sum
    // to exactly the budget total, whatever the weights.
    local procedure AllocateDepartments(BudgetNo: Code[20]; TotalAmount: Decimal; WeightSum: Decimal)
    var
        Department: Record "CG X150 Department";
        Winner: Record "CG X150 Department";
        ExactShare: Decimal;
        FloorShare: Decimal;
        FloorSum: Decimal;
        RemainingResidual: Decimal;
        CandidateRemainder: Decimal;
        BestRemainder: Decimal;
        Found: Boolean;
    begin
        FloorSum := 0;
        Department.SetRange("Budget No.", BudgetNo);
        if Department.FindSet() then
            repeat
                if Department.Weight = 0 then
                    FloorShare := 0
                else
                    FloorShare := Round(TotalAmount * Department.Weight / WeightSum, 0.01, '<');
                Department."Department Amount" := FloorShare;
                Department.Modify();
                FloorSum += FloorShare;
            until Department.Next() = 0;

        RemainingResidual := TotalAmount - FloorSum;
        while RemainingResidual >= 0.005 do begin
            Found := false;
            Department.SetRange("Budget No.", BudgetNo);
            if Department.FindSet() then
                repeat
                    if Department.Weight <> 0 then begin
                        ExactShare := TotalAmount * Department.Weight / WeightSum;
                        FloorShare := Round(ExactShare, 0.01, '<');
                        if Department."Department Amount" = FloorShare then begin
                            CandidateRemainder := ExactShare - FloorShare;
                            if (not Found) or (CandidateRemainder > BestRemainder) then begin
                                Winner := Department;
                                BestRemainder := CandidateRemainder;
                                Found := true;
                            end;
                        end;
                    end;
                until Department.Next() = 0;

            Winner."Department Amount" += 0.01;
            Winner.Modify();
            RemainingResidual -= 0.01;
        end;
    end;

    local procedure AllocateAllTeams(BudgetNo: Code[20])
    var
        Department: Record "CG X150 Department";
    begin
        Department.SetRange("Budget No.", BudgetNo);
        if Department.FindSet() then
            repeat
                AllocateTeamsForDepartment(BudgetNo, Department."Line No.", Department."Department Amount");
            until Department.Next() = 0;
    end;

    // Same largest-remainder distribution as AllocateDepartments, applied
    // within one department: the teams under it always sum to exactly
    // that department's own (already cent-exact) Department Amount.
    local procedure AllocateTeamsForDepartment(BudgetNo: Code[20]; DepartmentLineNo: Integer; DepartmentAmount: Decimal)
    var
        Team: Record "CG X150 Team";
        Winner: Record "CG X150 Team";
        TeamWeightSum: Decimal;
        ExactShare: Decimal;
        FloorShare: Decimal;
        FloorSum: Decimal;
        RemainingResidual: Decimal;
        CandidateRemainder: Decimal;
        BestRemainder: Decimal;
        Found: Boolean;
    begin
        Team.SetRange("Budget No.", BudgetNo);
        Team.SetRange("Department Line No.", DepartmentLineNo);
        TeamWeightSum := 0;
        if Team.FindSet() then
            repeat
                TeamWeightSum += Team.Weight;
            until Team.Next() = 0;

        if TeamWeightSum = 0 then
            exit;

        FloorSum := 0;
        Team.SetRange("Budget No.", BudgetNo);
        Team.SetRange("Department Line No.", DepartmentLineNo);
        if Team.FindSet() then
            repeat
                if Team.Weight = 0 then
                    FloorShare := 0
                else
                    FloorShare := Round(DepartmentAmount * Team.Weight / TeamWeightSum, 0.01, '<');
                Team."Team Amount" := FloorShare;
                Team.Modify();
                FloorSum += FloorShare;
            until Team.Next() = 0;

        RemainingResidual := DepartmentAmount - FloorSum;
        while RemainingResidual >= 0.005 do begin
            Found := false;
            Team.SetRange("Budget No.", BudgetNo);
            Team.SetRange("Department Line No.", DepartmentLineNo);
            if Team.FindSet() then
                repeat
                    if Team.Weight <> 0 then begin
                        ExactShare := DepartmentAmount * Team.Weight / TeamWeightSum;
                        FloorShare := Round(ExactShare, 0.01, '<');
                        if Team."Team Amount" = FloorShare then begin
                            CandidateRemainder := ExactShare - FloorShare;
                            if (not Found) or (CandidateRemainder > BestRemainder) then begin
                                Winner := Team;
                                BestRemainder := CandidateRemainder;
                                Found := true;
                            end;
                        end;
                    end;
                until Team.Next() = 0;

            Winner."Team Amount" += 0.01;
            Winner.Modify();
            RemainingResidual -= 0.01;
        end;
    end;
}
