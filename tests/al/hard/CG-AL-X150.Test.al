codeunit 89370 "CG-AL-X150 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every test clears all three
    // tables before seeding its own rows.

    local procedure ClearAllData()
    var
        Team: Record "CG X150 Team";
        Department: Record "CG X150 Department";
        BudgetHeader: Record "CG X150 Budget Header";
    begin
        Team.DeleteAll();
        Department.DeleteAll();
        BudgetHeader.DeleteAll();
    end;

    local procedure SeedBudget(BudgetNo: Code[20]; TotalAmount: Decimal)
    var
        BudgetHeader: Record "CG X150 Budget Header";
    begin
        BudgetHeader.Init();
        BudgetHeader."No." := BudgetNo;
        BudgetHeader."Budget Description" := 'Test budget';
        BudgetHeader."Total Amount" := TotalAmount;
        BudgetHeader.Insert();
    end;

    local procedure SeedDepartment(BudgetNo: Code[20]; LineNo: Integer; DepartmentName: Text[100]; DeptWeight: Decimal)
    var
        Department: Record "CG X150 Department";
    begin
        Department.Init();
        Department."Budget No." := BudgetNo;
        Department."Line No." := LineNo;
        Department."Department Name" := DepartmentName;
        Department.Weight := DeptWeight;
        Department.Insert();
    end;

    local procedure SeedDepartmentWithSentinel(BudgetNo: Code[20]; LineNo: Integer; DepartmentName: Text[100]; DeptWeight: Decimal; SentinelAmount: Decimal)
    var
        Department: Record "CG X150 Department";
    begin
        Department.Init();
        Department."Budget No." := BudgetNo;
        Department."Line No." := LineNo;
        Department."Department Name" := DepartmentName;
        Department.Weight := DeptWeight;
        Department."Department Amount" := SentinelAmount;
        Department.Insert();
    end;

    local procedure SeedTeam(BudgetNo: Code[20]; DepartmentLineNo: Integer; TeamLineNo: Integer; TeamName: Text[100]; TeamWeight: Decimal)
    var
        Team: Record "CG X150 Team";
    begin
        Team.Init();
        Team."Budget No." := BudgetNo;
        Team."Department Line No." := DepartmentLineNo;
        Team."Team Line No." := TeamLineNo;
        Team."Team Name" := TeamName;
        Team.Weight := TeamWeight;
        Team.Insert();
    end;

    local procedure SeedTeamWithSentinel(BudgetNo: Code[20]; DepartmentLineNo: Integer; TeamLineNo: Integer; TeamName: Text[100]; TeamWeight: Decimal; SentinelAmount: Decimal)
    var
        Team: Record "CG X150 Team";
    begin
        Team.Init();
        Team."Budget No." := BudgetNo;
        Team."Department Line No." := DepartmentLineNo;
        Team."Team Line No." := TeamLineNo;
        Team."Team Name" := TeamName;
        Team.Weight := TeamWeight;
        Team."Team Amount" := SentinelAmount;
        Team.Insert();
    end;

    local procedure GetDeptAmount(BudgetNo: Code[20]; LineNo: Integer): Decimal
    var
        Department: Record "CG X150 Department";
    begin
        Department.Get(BudgetNo, LineNo);
        exit(Department."Department Amount");
    end;

    local procedure GetTeamAmount(BudgetNo: Code[20]; DepartmentLineNo: Integer; TeamLineNo: Integer): Decimal
    var
        Team: Record "CG X150 Team";
    begin
        Team.Get(BudgetNo, DepartmentLineNo, TeamLineNo);
        exit(Team."Team Amount");
    end;

    // Independently reconstructs the allocation every correct
    // implementation must produce at ONE level: floor everyone's exact
    // proportional share to the cent, then hand out whatever the floors
    // left on the table one cent at a time to whichever entity's exact
    // entitlement was rounded down by the most, tie-broken by the lower
    // array index. A zero-weight entity's remainder is always exactly
    // zero, so it never competes for a leftover cent. Called once for a
    // budget's departments and once per department for its teams - this
    // mirrors the allocator's own fix, it is the definition of "correct"
    // this oracle grades against, not a re-implementation that happens to
    // agree with one particular solution.
    local procedure ComputeLevelShares(Weight: array[10] of Decimal; ItemCount: Integer; TotalAmount: Decimal; var ExpectedShare: array[10] of Decimal)
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
                ExpectedShare[i] := 0;
                Remainder[i] := 0;
            end else begin
                ExactShare := TotalAmount * Weight[i] / WeightSum;
                ExpectedShare[i] := Round(ExactShare, 0.01, '<');
                Remainder[i] := ExactShare - ExpectedShare[i];
                FloorSum += ExpectedShare[i];
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
            ExpectedShare[WinnerIndex] += 0.01;
            Awarded[WinnerIndex] := true;
            RemainingResidual -= 0.01;
        end;
    end;

    [Test]
    procedure SingleDepartmentSingleTeamGetsTheEntireBudget()
    var
        Allocator: Codeunit "CG X150 Budget Allocator";
    begin
        ClearAllData();
        SeedBudget('SP01', 246.80);
        SeedDepartment('SP01', 1, 'Solo Department', 4);
        SeedTeam('SP01', 1, 1, 'Solo Team', 17);

        Allocator.AllocateBudget('SP01');

        Assert.AreEqual(246.80, GetDeptAmount('SP01', 1), 'Expected a budget with a single department to allocate its entire total to that department');
        Assert.AreEqual(246.80, GetTeamAmount('SP01', 1, 1), 'Expected a department with a single team to allocate its entire amount to that team');
    end;

    [Test]
    procedure CleanTwoDepartmentTwoTeamSplitReconcilesExactlyAndLeavesAnotherBudgetUntouched()
    var
        BudgetHeader: Record "CG X150 Budget Header";
        Allocator: Codeunit "CG X150 Budget Allocator";
    begin
        ClearAllData();
        SeedBudget('CD01', 200.00);
        SeedDepartment('CD01', 1, 'Dept East', 1);
        SeedDepartment('CD01', 2, 'Dept West', 1);
        SeedTeam('CD01', 1, 1, 'Team A', 1);
        SeedTeam('CD01', 1, 2, 'Team B', 1);
        SeedTeam('CD01', 2, 1, 'Team C', 1);
        SeedTeam('CD01', 2, 2, 'Team D', 1);

        // A second, unrelated budget is seeded with its own nonzero
        // sentinel amounts, at every level, and left alone - allocating
        // CD01 must not touch it.
        SeedBudget('XB01', 999.00);
        SeedDepartmentWithSentinel('XB01', 1, 'Dept Untouched', 1, 555.55);
        SeedTeamWithSentinel('XB01', 1, 1, 'Team Untouched A', 1, 111.11);
        SeedTeamWithSentinel('XB01', 1, 2, 'Team Untouched B', 1, 222.22);

        Allocator.AllocateBudget('CD01');

        Assert.AreEqual(100.00, GetDeptAmount('CD01', 1), 'Expected an even two-department split to allocate exactly half the total to each department');
        Assert.AreEqual(100.00, GetDeptAmount('CD01', 2), 'Expected an even two-department split to allocate exactly half the total to each department');
        Assert.AreEqual(50.00, GetTeamAmount('CD01', 1, 1), 'Expected an even two-team split to allocate exactly half the department amount to each team');
        Assert.AreEqual(50.00, GetTeamAmount('CD01', 1, 2), 'Expected an even two-team split to allocate exactly half the department amount to each team');
        Assert.AreEqual(50.00, GetTeamAmount('CD01', 2, 1), 'Expected an even two-team split to allocate exactly half the department amount to each team');
        Assert.AreEqual(50.00, GetTeamAmount('CD01', 2, 2), 'Expected an even two-team split to allocate exactly half the department amount to each team');
        Assert.AreEqual(200.00, Allocator.GetAllocatedTotal('CD01'), 'Expected the budget-level reconciliation total to equal the budget total after allocating');
        Assert.AreEqual(100.00, Allocator.GetDepartmentAllocatedTotal('CD01', 1), 'Expected the department-level reconciliation total to equal the department amount after allocating');

        BudgetHeader.Get('XB01');
        Assert.IsFalse(BudgetHeader.Allocated, 'Expected an untouched budget to stay unallocated');
        Assert.AreEqual(555.55, GetDeptAmount('XB01', 1), 'Expected another budget''s department amount to be left untouched by allocating a different budget');
        Assert.AreEqual(111.11, GetTeamAmount('XB01', 1, 1), 'Expected another budget''s team amount to be left untouched by allocating a different budget');
        Assert.AreEqual(222.22, GetTeamAmount('XB01', 1, 2), 'Expected another budget''s team amount to be left untouched by allocating a different budget');
        // XB01's own teams (333.33) do not reconcile with its own department
        // amount (555.55) or its department with the budget total (999.00)
        // by design - it was never allocated. Pinning the reconciliation
        // totals against the lines' own recorded amounts here, not the
        // header or department fields, catches a reconciliation procedure
        // that just echoes another field instead of reading the table it
        // is supposed to.
        Assert.AreEqual(555.55, Allocator.GetAllocatedTotal('XB01'), 'Expected the budget-level reconciliation total to reflect the budget''s own recorded department amounts');
        Assert.AreEqual(333.33, Allocator.GetDepartmentAllocatedTotal('XB01', 1), 'Expected the department-level reconciliation total to reflect the department''s own recorded team amounts');
    end;

    [Test]
    procedure AdversarialFourDepartmentAllocationClosesExactlyAtEveryLevel()
    var
        Allocator: Codeunit "CG X150 Budget Allocator";
        DeptTeamTotal: Decimal;
        GrandTotal: Decimal;
        i: Integer;
    begin
        // Weights chosen so every department's and every team's exact
        // share has a distinct rounding remainder within its own
        // competition (no ties), so this fixture pins outcomes that do
        // not depend on any particular tie-break policy.
        ClearAllData();
        SeedBudget('AD01', 500.00);
        SeedDepartment('AD01', 1, 'Dept Alpha', 26);
        SeedDepartment('AD01', 2, 'Dept Beta', 21);
        SeedDepartment('AD01', 3, 'Dept Gamma', 30);
        SeedDepartment('AD01', 4, 'Dept Delta', 19);

        SeedTeam('AD01', 1, 1, 'Team Alpha-1', 8);
        SeedTeam('AD01', 1, 2, 'Team Alpha-2', 5);
        SeedTeam('AD01', 1, 3, 'Team Alpha-3', 4);

        SeedTeam('AD01', 2, 1, 'Team Beta-1', 1);
        SeedTeam('AD01', 2, 2, 'Team Beta-2', 10);

        SeedTeam('AD01', 3, 1, 'Team Gamma-1', 2);
        SeedTeam('AD01', 3, 2, 'Team Gamma-2', 6);
        SeedTeam('AD01', 3, 3, 'Team Gamma-3', 3);

        SeedTeam('AD01', 4, 1, 'Team Delta-1', 10);
        SeedTeam('AD01', 4, 2, 'Team Delta-2', 9);
        SeedTeam('AD01', 4, 3, 'Team Delta-3', 11);

        Allocator.AllocateBudget('AD01');

        Assert.AreEqual(135.42, GetDeptAmount('AD01', 1), 'Expected Dept Alpha''s recorded amount to depend only on the budget''s weights and total');
        Assert.AreEqual(109.37, GetDeptAmount('AD01', 2), 'Expected Dept Beta''s recorded amount to depend only on the budget''s weights and total');
        Assert.AreEqual(156.25, GetDeptAmount('AD01', 3), 'Expected Dept Gamma''s recorded amount to depend only on the budget''s weights and total');
        Assert.AreEqual(98.96, GetDeptAmount('AD01', 4), 'Expected Dept Delta''s recorded amount to depend only on the budget''s weights and total');

        Assert.AreEqual(63.73, GetTeamAmount('AD01', 1, 1), 'Expected Team Alpha-1''s recorded amount to depend only on its department''s amount and weights');
        Assert.AreEqual(39.83, GetTeamAmount('AD01', 1, 2), 'Expected Team Alpha-2''s recorded amount to depend only on its department''s amount and weights');
        Assert.AreEqual(31.86, GetTeamAmount('AD01', 1, 3), 'Expected Team Alpha-3''s recorded amount to depend only on its department''s amount and weights');

        Assert.AreEqual(9.94, GetTeamAmount('AD01', 2, 1), 'Expected Team Beta-1''s recorded amount to depend only on its department''s amount and weights');
        Assert.AreEqual(99.43, GetTeamAmount('AD01', 2, 2), 'Expected Team Beta-2''s recorded amount to depend only on its department''s amount and weights');

        Assert.AreEqual(28.41, GetTeamAmount('AD01', 3, 1), 'Expected Team Gamma-1''s recorded amount to depend only on its department''s amount and weights');
        Assert.AreEqual(85.23, GetTeamAmount('AD01', 3, 2), 'Expected Team Gamma-2''s recorded amount to depend only on its department''s amount and weights');
        Assert.AreEqual(42.61, GetTeamAmount('AD01', 3, 3), 'Expected Team Gamma-3''s recorded amount to depend only on its department''s amount and weights');

        Assert.AreEqual(32.99, GetTeamAmount('AD01', 4, 1), 'Expected Team Delta-1''s recorded amount to depend only on its department''s amount and weights');
        Assert.AreEqual(29.69, GetTeamAmount('AD01', 4, 2), 'Expected Team Delta-2''s recorded amount to depend only on its department''s amount and weights');
        Assert.AreEqual(36.28, GetTeamAmount('AD01', 4, 3), 'Expected Team Delta-3''s recorded amount to depend only on its department''s amount and weights');

        GrandTotal := 0;
        for i := 1 to 4 do begin
            DeptTeamTotal := GetTeamAmount('AD01', i, 1) + GetTeamAmount('AD01', i, 2);
            // Every department has three teams except Dept Beta (i = 2),
            // which has only two.
            if i <> 2 then
                DeptTeamTotal += GetTeamAmount('AD01', i, 3);
            Assert.AreEqual(
              GetDeptAmount('AD01', i), DeptTeamTotal,
              StrSubstNo('Expected department %1''s teams to sum to exactly that department''s own recorded amount', i));
            GrandTotal += GetDeptAmount('AD01', i);
        end;
        Assert.AreEqual(500.00, GrandTotal, 'Expected every department''s recorded amount to sum to exactly the budget''s total amount');
    end;

    [Test]
    procedure ZeroWeightDepartmentAndZeroWeightTeamAlwaysReceiveExactlyZero()
    var
        Allocator: Codeunit "CG X150 Budget Allocator";
    begin
        ClearAllData();
        SeedBudget('ZW01', 90.00);
        SeedDepartment('ZW01', 1, 'Dept Live', 5);
        SeedDepartment('ZW01', 2, 'Dept Sample', 0);
        SeedTeam('ZW01', 1, 1, 'Team Regular', 3);
        SeedTeam('ZW01', 1, 2, 'Team Comp', 0);
        SeedTeam('ZW01', 2, 1, 'Team No Budget', 7);

        Allocator.AllocateBudget('ZW01');

        Assert.AreEqual(90.00, GetDeptAmount('ZW01', 1), 'Expected a department with weight to receive its full proportional share when the only other department has none');
        Assert.AreEqual(0.00, GetDeptAmount('ZW01', 2), 'Expected a department with no weight to receive exactly zero, even though another department on the same budget carries a nonzero total');
        Assert.AreEqual(90.00, GetTeamAmount('ZW01', 1, 1), 'Expected a team with weight to receive its full proportional share when the only other team on its department has none');
        Assert.AreEqual(0.00, GetTeamAmount('ZW01', 1, 2), 'Expected a team with no weight to receive exactly zero, even though another team on the same department carries a nonzero amount');
        Assert.AreEqual(0.00, GetTeamAmount('ZW01', 2, 1), 'Expected a team under a department that itself received zero to receive exactly zero, regardless of the team''s own weight');
    end;

    [Test]
    procedure DepartmentWithNoTeamWeightLeavesItsTeamsUntouched()
    var
        Allocator: Codeunit "CG X150 Budget Allocator";
    begin
        ClearAllData();
        SeedBudget('NT01', 80.00);
        SeedDepartment('NT01', 1, 'Dept Funded', 1);
        SeedDepartment('NT01', 2, 'Dept Empty', 1);
        SeedTeam('NT01', 1, 1, 'Team Live', 1);
        SeedTeamWithSentinel('NT01', 2, 1, 'Team Idle 1', 0, 77.77);
        SeedTeamWithSentinel('NT01', 2, 2, 'Team Idle 2', 0, 88.88);

        Allocator.AllocateBudget('NT01');

        Assert.AreEqual(40.00, GetDeptAmount('NT01', 1), 'Expected a funded department to receive its proportional share of the total');
        Assert.AreEqual(40.00, GetDeptAmount('NT01', 2), 'Expected a department with weight to receive its proportional share of the total even when its own teams have none');
        Assert.AreEqual(40.00, GetTeamAmount('NT01', 1, 1), 'Expected the only team on a funded department to receive that department''s entire amount');

        Assert.AreEqual(
          77.77, GetTeamAmount('NT01', 2, 1),
          'Expected a team''s existing amount to be left untouched when its department has nothing to allocate among its teams, even though the department itself received a nonzero amount');
        Assert.AreEqual(
          88.88, GetTeamAmount('NT01', 2, 2),
          'Expected a team''s existing amount to be left untouched when its department has nothing to allocate among its teams, even though the department itself received a nonzero amount');
    end;

    [Test]
    procedure WholeBudgetWithNoWeightAnywhereIsLeftUnallocated()
    var
        BudgetHeader: Record "CG X150 Budget Header";
        Allocator: Codeunit "CG X150 Budget Allocator";
    begin
        ClearAllData();
        SeedBudget('NB01', 60.00);
        SeedDepartmentWithSentinel('NB01', 1, 'Dept Idle A', 0, 11.11);
        SeedTeamWithSentinel('NB01', 1, 1, 'Team Idle A1', 0, 22.22);
        SeedDepartmentWithSentinel('NB01', 2, 'Dept Idle B', 0, 33.33);
        SeedTeamWithSentinel('NB01', 2, 1, 'Team Idle B1', 0, 44.44);

        Allocator.AllocateBudget('NB01');

        BudgetHeader.Get('NB01');
        Assert.IsFalse(BudgetHeader.Allocated, 'Expected a budget with no weight on any department to be left unallocated');
        Assert.AreEqual(11.11, GetDeptAmount('NB01', 1), 'Expected a department''s existing amount to be left untouched when the budget has no weight to allocate');
        Assert.AreEqual(33.33, GetDeptAmount('NB01', 2), 'Expected a department''s existing amount to be left untouched when the budget has no weight to allocate');
        Assert.AreEqual(22.22, GetTeamAmount('NB01', 1, 1), 'Expected a team''s existing amount to be left untouched when the budget has no weight to allocate');
        Assert.AreEqual(44.44, GetTeamAmount('NB01', 2, 1), 'Expected a team''s existing amount to be left untouched when the budget has no weight to allocate');
    end;

    [Test]
    procedure ReorderingDepartmentsAndTeamsNeverChangesTheirAmount()
    var
        Allocator: Codeunit "CG X150 Budget Allocator";
    begin
        // Same four department weights and the same three team weights
        // under "Alpha" as the adversarial fixture above, entered in the
        // opposite order on the second budget - both at the department
        // level and, within Alpha, at the team level.
        ClearAllData();

        SeedBudget('PM01', 500.00);
        SeedDepartment('PM01', 1, 'Dept Alpha', 26);
        SeedDepartment('PM01', 2, 'Dept Beta', 21);
        SeedDepartment('PM01', 3, 'Dept Gamma', 30);
        SeedDepartment('PM01', 4, 'Dept Delta', 19);
        SeedTeam('PM01', 1, 1, 'Team Alpha-1', 8);
        SeedTeam('PM01', 1, 2, 'Team Alpha-2', 5);
        SeedTeam('PM01', 1, 3, 'Team Alpha-3', 4);

        SeedBudget('PM02', 500.00);
        SeedDepartment('PM02', 1, 'Dept Delta', 19);
        SeedDepartment('PM02', 2, 'Dept Gamma', 30);
        SeedDepartment('PM02', 3, 'Dept Beta', 21);
        SeedDepartment('PM02', 4, 'Dept Alpha', 26);
        SeedTeam('PM02', 4, 1, 'Team Alpha-3', 4);
        SeedTeam('PM02', 4, 2, 'Team Alpha-2', 5);
        SeedTeam('PM02', 4, 3, 'Team Alpha-1', 8);

        Allocator.AllocateBudget('PM01');
        Allocator.AllocateBudget('PM02');

        Assert.AreEqual(135.42, GetDeptAmount('PM01', 1), 'Expected Dept Alpha''s amount to depend only on the budget''s weights and total, never on entry order');
        Assert.AreEqual(135.42, GetDeptAmount('PM02', 4), 'Expected Dept Alpha''s amount to depend only on the budget''s weights and total, never on entry order');
        Assert.AreEqual(109.37, GetDeptAmount('PM01', 2), 'Expected Dept Beta''s amount to depend only on the budget''s weights and total, never on entry order');
        Assert.AreEqual(109.37, GetDeptAmount('PM02', 3), 'Expected Dept Beta''s amount to depend only on the budget''s weights and total, never on entry order');
        Assert.AreEqual(156.25, GetDeptAmount('PM01', 3), 'Expected Dept Gamma''s amount to depend only on the budget''s weights and total, never on entry order');
        Assert.AreEqual(156.25, GetDeptAmount('PM02', 2), 'Expected Dept Gamma''s amount to depend only on the budget''s weights and total, never on entry order');
        Assert.AreEqual(98.96, GetDeptAmount('PM01', 4), 'Expected Dept Delta''s amount to depend only on the budget''s weights and total, never on entry order');
        Assert.AreEqual(98.96, GetDeptAmount('PM02', 1), 'Expected Dept Delta''s amount to depend only on the budget''s weights and total, never on entry order');

        Assert.AreEqual(63.73, GetTeamAmount('PM01', 1, 1), 'Expected Team Alpha-1''s amount to depend only on its department''s amount and weights, never on entry order');
        Assert.AreEqual(63.73, GetTeamAmount('PM02', 4, 3), 'Expected Team Alpha-1''s amount to depend only on its department''s amount and weights, never on entry order');
        Assert.AreEqual(39.83, GetTeamAmount('PM01', 1, 2), 'Expected Team Alpha-2''s amount to depend only on its department''s amount and weights, never on entry order');
        Assert.AreEqual(39.83, GetTeamAmount('PM02', 4, 2), 'Expected Team Alpha-2''s amount to depend only on its department''s amount and weights, never on entry order');
        Assert.AreEqual(31.86, GetTeamAmount('PM01', 1, 3), 'Expected Team Alpha-3''s amount to depend only on its department''s amount and weights, never on entry order');
        Assert.AreEqual(31.86, GetTeamAmount('PM02', 4, 1), 'Expected Team Alpha-3''s amount to depend only on its department''s amount and weights, never on entry order');
    end;

    [Test]
    procedure SuccessfulAllocationMarksTheBudgetAllocated()
    var
        BudgetHeader: Record "CG X150 Budget Header";
        Allocator: Codeunit "CG X150 Budget Allocator";
    begin
        ClearAllData();
        SeedBudget('MK01', 10.00);
        SeedDepartment('MK01', 1, 'Dept Only', 1);
        SeedTeam('MK01', 1, 1, 'Team Only', 1);

        Allocator.AllocateBudget('MK01');

        BudgetHeader.Get('MK01');
        Assert.IsTrue(BudgetHeader.Allocated, 'Expected a budget with at least one weighted department to be marked allocated');
    end;

    [Test]
    procedure DeterministicSweepMatchesTheTwoLevelReferenceAcrossManyPartitions()
    var
        Department: Record "CG X150 Department";
        Team: Record "CG X150 Team";
        Allocator: Codeunit "CG X150 Budget Allocator";
        Any: Codeunit Any;
        DeptWeight: array[10] of Decimal;
        ExpectedDeptShare: array[10] of Decimal;
        TeamWeightRow: array[10] of Decimal;
        TeamShareRow: array[10] of Decimal;
        ExpectedTeamShare: array[10, 10] of Decimal;
        TeamCount: array[10] of Integer;
        BudgetNo: Code[20];
        TotalAmount: Decimal;
        DeptTeamSum: Decimal;
        GrandSum: Decimal;
        DeptCount: Integer;
        Partition: Integer;
        i: Integer;
        j: Integer;
    begin
        Any.SetSeed(150);

        for Partition := 1 to 6 do begin
            ClearAllData();
            BudgetNo := 'SW' + Format(Partition);
            DeptCount := Any.IntegerInRange(3, 6);
            TotalAmount := Any.IntegerInRange(100, 99999) / 100;
            SeedBudget(BudgetNo, TotalAmount);

            for i := 1 to DeptCount do begin
                // Roughly every fourth department on a sweep partition
                // carries no weight to allocate.
                if i mod 4 = 0 then
                    DeptWeight[i] := 0
                else
                    DeptWeight[i] := Any.DecimalInRange(1, 500, 3);
                SeedDepartment(BudgetNo, i, StrSubstNo('Sweep dept %1', i), DeptWeight[i]);
            end;

            ComputeLevelShares(DeptWeight, DeptCount, TotalAmount, ExpectedDeptShare);

            for i := 1 to DeptCount do begin
                TeamCount[i] := Any.IntegerInRange(2, 5);
                for j := 1 to TeamCount[i] do begin
                    if j mod 3 = 0 then
                        TeamWeightRow[j] := 0
                    else
                        TeamWeightRow[j] := Any.DecimalInRange(1, 300, 3);
                    SeedTeam(BudgetNo, i, j, StrSubstNo('Sweep dept %1 team %2', i, j), TeamWeightRow[j]);
                end;
                ComputeLevelShares(TeamWeightRow, TeamCount[i], ExpectedDeptShare[i], TeamShareRow);
                for j := 1 to TeamCount[i] do
                    ExpectedTeamShare[i, j] := TeamShareRow[j];
            end;

            Allocator.AllocateBudget(BudgetNo);

            GrandSum := 0;
            for i := 1 to DeptCount do begin
                Department.Get(BudgetNo, i);
                Assert.AreEqual(
                  ExpectedDeptShare[i], Department."Department Amount",
                  StrSubstNo('Expected department %1 of sweep partition %2 to depend only on that budget''s own weights and total', i, Partition));

                DeptTeamSum := 0;
                for j := 1 to TeamCount[i] do begin
                    Team.Get(BudgetNo, i, j);
                    Assert.AreEqual(
                      ExpectedTeamShare[i, j], Team."Team Amount",
                      StrSubstNo('Expected team %1 of department %2 of sweep partition %3 to depend only on its department''s amount and weights', j, i, Partition));
                    DeptTeamSum += Team."Team Amount";
                end;
                Assert.AreEqual(
                  Department."Department Amount", DeptTeamSum,
                  StrSubstNo('Expected the teams under department %1 of sweep partition %2 to sum to exactly that department''s own recorded amount', i, Partition));

                GrandSum += Department."Department Amount";
            end;
            Assert.AreEqual(
              TotalAmount, GrandSum,
              StrSubstNo('Expected every department''s recorded amount on sweep partition %1 to sum to exactly the budget''s total amount', Partition));
        end;
    end;
}
