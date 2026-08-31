codeunit 89433 "CG-AL-X211 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    // This oracle merges 4 independent modules' test suites into one
    // codeunit. Every test and helper procedure is prefixed with the module
    // it belongs to so identical helper names across the source suites cannot
    // collide. Assembled from already-gated donors; see NOTES.md.

    var
        Assert: Codeunit Assert;
        // The default test isolation persists writes between test methods, so
        // every test clears the table before seeding its own rows.
        // Every comparison below is built and asserted purely in memory - no
        // DateTime here is ever written to and read back from a table. A SQL
        // round trip can itself move a stored DateTime by a few milliseconds
        // (measured: up to 4 ms of drift between two round-tripped values),
        // which would be enough to shift a 9 ms boundary case across the
        // 10 ms line and make this oracle flaky.
        // The default test isolation persists writes between test methods
        // (measured 2026-08-20, SOAP runner), so every test clears all three
        // tables before seeding its own rows.
        Consolidator: Codeunit "CG X162 Consolidator";
        SetupMgt: Codeunit "CG X162 Setup Mgt";
        // Companies are enumerated at runtime, never hardcoded. Every test that
        // touches the other company clears both companies' source readings and
        // the collected list BEFORE seeding and AGAIN before asserting, and
        // Commit()s each clear - so cleanup is durable even if an assertion in
        // the same test raises an error. Meter numbers are prefixed per
        // company (H.. / O..) so a run never has to overwrite one company's row
        // with the other's value, keeping row-count and total assertions
        // independent of which company a reading ends up filed under.

    // ==========================================================
    // X076 - donor CG-AL-X076
    // ==========================================================

    local procedure X076_Reset()
    var
        LegacyAmount: Record "CG X076 Legacy Amount";
    begin
        LegacyAmount.DeleteAll();
    end;

    local procedure X076_EntryExists(EntryCode: Code[20]): Boolean
    var
        LegacyAmount: Record "CG X076 Legacy Amount";
    begin
        exit(LegacyAmount.Get(EntryCode));
    end;

    local procedure X076_AmountOf(EntryCode: Code[20]): Decimal
    var
        LegacyAmount: Record "CG X076 Legacy Amount";
    begin
        LegacyAmount.Get(EntryCode);
        exit(LegacyAmount.Amount);
    end;

    [Test]
    procedure X076_ParseAmountReturnsTheValueOfAValidAmountText()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        Any: Codeunit Any;
        Amount: Decimal;
    begin
        Amount := Any.DecimalInRange(1, 900, 2);

        Assert.AreEqual(Amount, Importer.ParseAmount(Format(Amount)),
            'Expected ParseAmount to return the decimal value of a well-formed amount text');
    end;

    [Test]
    procedure X076_ParseAmountAcceptsZero()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
    begin
        Assert.AreEqual(0.0, Importer.ParseAmount('0'),
            'Expected ParseAmount to accept zero - only negative amounts are invalid');
    end;

    [Test]
    procedure X076_ParseAmountErrorsOnTextThatIsNotANumber()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
    begin
        asserterror Importer.ParseAmount('X76-garbage');

        Assert.ExpectedError('''X76-garbage'' is not a valid amount');
    end;

    [Test]
    procedure X076_ParseAmountErrorsOnANegativeAmount()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        Any: Codeunit Any;
        NegativeText: Text;
    begin
        NegativeText := Format(-Any.DecimalInRange(1, 900, 2));

        asserterror Importer.ParseAmount(NegativeText);

        Assert.ExpectedError(StrSubstNo('''%1'' is not a valid amount', NegativeText));
    end;

    [Test]
    procedure X076_TryParseAmountReturnsTrueAndTheValueForAValidText()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        Any: Codeunit Any;
        Expected: Decimal;
        Amount: Decimal;
        FailureReason: Text;
    begin
        Expected := Any.DecimalInRange(1, 900, 2);

        Assert.IsTrue(Importer.TryParseAmount(Format(Expected), Amount, FailureReason),
            'Expected TryParseAmount to return true for a well-formed amount text');
        Assert.AreEqual(Expected, Amount, 'Expected TryParseAmount to put the parsed value into Amount');
        Assert.AreEqual('', FailureReason, 'Expected an empty FailureReason after a successful conversion');
    end;

    [Test]
    procedure X076_TryParseAmountReturnsFalseWithTheReasonInsteadOfFailing()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        Amount: Decimal;
        FailureReason: Text;
    begin
        // No asserterror: TryParseAmount must never raise, whatever the input.
        Assert.IsFalse(Importer.TryParseAmount('X76-not-a-number', Amount, FailureReason),
            'Expected TryParseAmount to return false for text that does not parse as an amount');
        Assert.IsTrue(FailureReason.Contains('''X76-not-a-number'' is not a valid amount'),
            StrSubstNo('Expected FailureReason to carry the conversion error text, got "%1"', FailureReason));
    end;

    [Test]
    procedure X076_TryParseAmountReportsTheLatestFailure()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        Amount: Decimal;
        FailureReason: Text;
    begin
        Importer.TryParseAmount('X76-first-bad', Amount, FailureReason);

        Importer.TryParseAmount('X76-second-bad', Amount, FailureReason);

        Assert.IsTrue(FailureReason.Contains('X76-second-bad'),
            StrSubstNo('Expected FailureReason to describe the latest failed input, got "%1"', FailureReason));
        Assert.IsFalse(FailureReason.Contains('X76-first-bad'),
            StrSubstNo('Expected FailureReason to no longer mention the earlier failed input, got "%1"', FailureReason));
    end;

    [Test]
    procedure X076_ImportLineLeavesNoRowBehindForANonNumericAmount()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
    begin
        X076_Reset();

        Assert.IsFalse(Importer.ImportLine('X76-BAD1', 'X76-not-a-number'),
            'Expected ImportLine to return false for text that does not parse as an amount');
        Assert.IsFalse(X076_EntryExists('X76-BAD1'), 'Expected no stored entry for an amount that failed to parse');
    end;

    [Test]
    procedure X076_ImportLineLeavesNoRowBehindForANegativeAmount()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        Any: Codeunit Any;
    begin
        X076_Reset();

        Assert.IsFalse(Importer.ImportLine('X76-BAD2', Format(-Any.DecimalInRange(1, 900, 2))),
            'Expected ImportLine to return false for a negative amount');
        Assert.IsFalse(X076_EntryExists('X76-BAD2'), 'Expected no stored entry for a rejected negative amount');
    end;

    [Test]
    procedure X076_ImportLineImportsAWellFormedAmount()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        Any: Codeunit Any;
        Amount: Decimal;
    begin
        X076_Reset();
        Amount := Any.DecimalInRange(1, 900, 2);

        Assert.IsTrue(Importer.ImportLine('X76-V1', Format(Amount)),
            'Expected a well-formed, non-negative amount to be reported as imported');
        Assert.IsTrue(X076_EntryExists('X76-V1'), 'Expected a stored entry for the imported line');
        Assert.AreEqual(Amount, X076_AmountOf('X76-V1'), 'Expected the stored entry to carry the parsed amount');
    end;

    [Test]
    procedure X076_ImportLineAcceptsZeroAsAWellFormedAmount()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
    begin
        X076_Reset();

        Assert.IsTrue(Importer.ImportLine('X76-ZERO', '0'),
            'Expected a zero amount to be reported as imported, not rejected - zero is well-formed and non-negative');
        Assert.IsTrue(X076_EntryExists('X76-ZERO'), 'Expected a stored entry for the zero-amount line');
        Assert.AreEqual(0, X076_AmountOf('X76-ZERO'), 'Expected the stored entry to carry an amount of exactly zero');
    end;

    [Test]
    procedure X076_BatchSkipsEveryBadLineAndImportsNothing()
    var
        Job: Codeunit "CG X076 Import Job";
        Codes: List of [Code[20]];
        Texts: List of [Text];
        Any: Codeunit Any;
    begin
        X076_Reset();
        Codes.Add('X76-B1A');
        Texts.Add('X76-not-a-number');
        Codes.Add('X76-B1B');
        Texts.Add(Format(-Any.DecimalInRange(1, 900, 2)));

        Assert.AreEqual(0, Job.ImportBatch(Codes, Texts),
            'Expected a batch of only malformed or negative lines to import nothing');
        Assert.IsFalse(X076_EntryExists('X76-B1A'), 'Expected no stored entry for the malformed line');
        Assert.IsFalse(X076_EntryExists('X76-B1B'), 'Expected no stored entry for the negative line');
    end;

    [Test]
    procedure X076_BatchImportsEveryWellFormedLineAndCountsThem()
    var
        Job: Codeunit "CG X076 Import Job";
        Codes: List of [Code[20]];
        Texts: List of [Text];
        Any: Codeunit Any;
        Amount1: Decimal;
        Amount2: Decimal;
        Amount3: Decimal;
    begin
        X076_Reset();
        Amount1 := Any.DecimalInRange(1, 300, 2);
        Amount2 := Any.DecimalInRange(1, 300, 2);
        Amount3 := Any.DecimalInRange(1, 300, 2);
        Codes.Add('X76-B2A');
        Texts.Add(Format(Amount1));
        Codes.Add('X76-B2B');
        Texts.Add(Format(Amount2));
        Codes.Add('X76-B2C');
        Texts.Add(Format(Amount3));

        Assert.AreEqual(3, Job.ImportBatch(Codes, Texts),
            'Expected every well-formed line in the batch to be counted as imported');
        Assert.AreEqual(Amount1, X076_AmountOf('X76-B2A'), 'Expected the first line''s parsed amount to be stored');
        Assert.AreEqual(Amount2, X076_AmountOf('X76-B2B'), 'Expected the second line''s parsed amount to be stored');
        Assert.AreEqual(Amount3, X076_AmountOf('X76-B2C'), 'Expected the third line''s parsed amount to be stored');
    end;

    [Test]
    procedure X076_BatchCountsOnlyTheWellFormedLinesInAMixedBatch()
    var
        Job: Codeunit "CG X076 Import Job";
        Codes: List of [Code[20]];
        Texts: List of [Text];
        Any: Codeunit Any;
        GoodAmount: Decimal;
    begin
        X076_Reset();
        GoodAmount := Any.DecimalInRange(1, 300, 2);
        Codes.Add('X76-B3BAD');
        Texts.Add('X76-still-not-a-number');
        Codes.Add('X76-B3GOOD');
        Texts.Add(Format(GoodAmount));

        Assert.AreEqual(1, Job.ImportBatch(Codes, Texts),
            'Expected only the well-formed line to be counted as imported');
        Assert.IsFalse(X076_EntryExists('X76-B3BAD'), 'Expected no stored entry for the malformed line');
        Assert.IsTrue(X076_EntryExists('X76-B3GOOD'), 'Expected a stored entry for the well-formed line');
        Assert.AreEqual(GoodAmount, X076_AmountOf('X76-B3GOOD'), 'Expected the well-formed line''s parsed amount to be stored');
    end;

    // ==========================================================
    // X115 - donor CG-AL-X115
    // ==========================================================

    local procedure X115_BaseMoment(): DateTime
    begin
        exit(CreateDateTime(20260615D, 093000T));
    end;

    [Test]
    procedure X115_ZeroDriftIsTheSameMoment()
    var
        Detector: Codeunit "CG X115 Change Detector";
        Moment: DateTime;
    begin
        Moment := X115_BaseMoment();
        Assert.IsTrue(Detector.IsSameMoment(Moment, Moment),
            'Expected two identical timestamps to be the same moment');
    end;

    [Test]
    procedure X115_NineMillisecondDriftIsTheSameMomentReversedOrder()
    var
        Detector: Codeunit "CG X115 Change Detector";
        Moment: DateTime;
    begin
        Moment := X115_BaseMoment();
        Assert.IsTrue(Detector.IsSameMoment(Moment + 9, Moment),
            'Expected timestamps 9 milliseconds apart to be the same moment regardless of argument order');
    end;

    [Test]
    procedure X115_TenMillisecondGapIsADifferentMoment()
    var
        Detector: Codeunit "CG X115 Change Detector";
        Moment: DateTime;
    begin
        Moment := X115_BaseMoment();
        Assert.IsFalse(Detector.IsSameMoment(Moment, Moment + 10),
            'Expected timestamps exactly 10 milliseconds apart to be different moments');
    end;

    [Test]
    procedure X115_TwentyMillisecondGapIsADifferentMomentReversedOrder()
    var
        Detector: Codeunit "CG X115 Change Detector";
        Moment: DateTime;
    begin
        Moment := X115_BaseMoment();
        Assert.IsFalse(Detector.IsSameMoment(Moment + 20, Moment),
            'Expected timestamps 20 milliseconds apart to be different moments regardless of argument order');
    end;

    // Not disclosed anywhere: a model that only memorized the shown 0/3/9
    // (same) and 10/20 (different) millisecond examples fails somewhere in
    // this range instead of generalizing the rule. AL stops at the first
    // failing assertion, so a failing sweep discloses exactly one drift
    // value per attempt rather than the whole hidden set at once.
    [Test]
    procedure X115_IsSameMomentMatchesTheDisclosedRuleAcrossTheFullDriftRange()
    var
        Detector: Codeunit "CG X115 Change Detector";
        Moment: DateTime;
        DriftMs: Integer;
    begin
        Moment := X115_BaseMoment();
        for DriftMs := 0 to 40 do begin
            Assert.AreEqual(DriftMs < 10, Detector.IsSameMoment(Moment, Moment + DriftMs),
                StrSubstNo('Expected IsSameMoment to follow the confirmed drift rule for a %1 millisecond gap', DriftMs));
            Assert.AreEqual(DriftMs < 10, Detector.IsSameMoment(Moment + DriftMs, Moment),
                StrSubstNo('Expected IsSameMoment to follow the confirmed drift rule for a %1 millisecond gap with the later timestamp passed first', DriftMs));
        end;
    end;

    [Test]
    procedure X115_UndefinedFirstArgumentDiffersFromARealTimestamp()
    var
        Detector: Codeunit "CG X115 Change Detector";
        Moment: DateTime;
    begin
        Moment := X115_BaseMoment();
        Assert.IsFalse(Detector.IsSameMoment(0DT, Moment),
            'Expected an undefined timestamp as the first argument to differ from a real timestamp');
    end;

    [Test]
    procedure X115_UndefinedSecondArgumentDiffersFromARealTimestamp()
    var
        Detector: Codeunit "CG X115 Change Detector";
        Moment: DateTime;
    begin
        Moment := X115_BaseMoment();
        Assert.IsFalse(Detector.IsSameMoment(Moment, 0DT),
            'Expected an undefined timestamp as the second argument to differ from a real timestamp');
    end;

    [Test]
    procedure X115_TwoUndefinedTimestampsAreTheSameMoment()
    var
        Detector: Codeunit "CG X115 Change Detector";
    begin
        Assert.IsTrue(Detector.IsSameMoment(0DT, 0DT),
            'Expected two undefined timestamps to be the same moment');
    end;

    [Test]
    procedure X115_ATenMillisecondGapTriggersAResync()
    var
        Detector: Codeunit "CG X115 Change Detector";
        Moment: DateTime;
    begin
        Moment := X115_BaseMoment();
        Assert.IsTrue(Detector.ShouldResync(Moment + 10, Moment),
            'Expected a resync for a current timestamp exactly 10 milliseconds after the last synced one');
    end;

    // Signed sweep so the false/true split is exercised in both directions
    // (current ahead of last synced, and current behind it) without pinning
    // any single undisclosed drift value to its own named assertion.
    [Test]
    procedure X115_ResyncDecisionMatchesTheDisclosedRuleAcrossTheFullDriftRange()
    var
        Detector: Codeunit "CG X115 Change Detector";
        Moment: DateTime;
        DriftMs: Integer;
    begin
        Moment := X115_BaseMoment();
        for DriftMs := 0 to 40 do begin
            Assert.AreEqual(DriftMs >= 10, Detector.ShouldResync(Moment + DriftMs, Moment),
                StrSubstNo('Expected ShouldResync to follow the confirmed drift rule for a current timestamp %1 milliseconds ahead of the last synced one', DriftMs));
            Assert.AreEqual(DriftMs >= 10, Detector.ShouldResync(Moment, Moment + DriftMs),
                StrSubstNo('Expected ShouldResync to follow the confirmed drift rule for a current timestamp %1 milliseconds behind the last synced one', DriftMs));
        end;
    end;

    [Test]
    procedure X115_AnUndefinedCurrentStampAgainstARealStoredStampTriggersAResync()
    var
        Detector: Codeunit "CG X115 Change Detector";
        Moment: DateTime;
    begin
        Moment := X115_BaseMoment();
        Assert.IsTrue(Detector.ShouldResync(0DT, Moment),
            'Expected a resync when the current timestamp is undefined but the last synced timestamp is real');
    end;

    [Test]
    procedure X115_ANeverSyncedRecordAlwaysTriggersAResync()
    var
        Detector: Codeunit "CG X115 Change Detector";
        Moment: DateTime;
    begin
        Moment := X115_BaseMoment();
        Assert.IsTrue(Detector.ShouldResync(Moment, 0DT),
            'Expected a resync when the last synced timestamp is undefined, meaning the record has never been synced');
    end;

    [Test]
    procedure X115_ANeverSyncedRecordTriggersAResyncEvenWithAnUndefinedCurrentStamp()
    var
        Detector: Codeunit "CG X115 Change Detector";
    begin
        Assert.IsTrue(Detector.ShouldResync(0DT, 0DT),
            'Expected a resync when the last synced timestamp is undefined, even if the current timestamp is undefined too');
    end;

    // ==========================================================
    // X150 - donor CG-AL-X150
    // ==========================================================

    local procedure X150_ClearAllData()
    var
        Team: Record "CG X150 Team";
        Department: Record "CG X150 Department";
        BudgetHeader: Record "CG X150 Budget Header";
    begin
        Team.DeleteAll();
        Department.DeleteAll();
        BudgetHeader.DeleteAll();
    end;

    local procedure X150_SeedBudget(BudgetNo: Code[20]; TotalAmount: Decimal)
    var
        BudgetHeader: Record "CG X150 Budget Header";
    begin
        BudgetHeader.Init();
        BudgetHeader."No." := BudgetNo;
        BudgetHeader."Budget Description" := 'Test budget';
        BudgetHeader."Total Amount" := TotalAmount;
        BudgetHeader.Insert();
    end;

    local procedure X150_SeedDepartment(BudgetNo: Code[20]; LineNo: Integer; DepartmentName: Text[100]; DeptWeight: Decimal)
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

    local procedure X150_SeedDepartmentWithSentinel(BudgetNo: Code[20]; LineNo: Integer; DepartmentName: Text[100]; DeptWeight: Decimal; SentinelAmount: Decimal)
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

    local procedure X150_SeedTeam(BudgetNo: Code[20]; DepartmentLineNo: Integer; TeamLineNo: Integer; TeamName: Text[100]; TeamWeight: Decimal)
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

    local procedure X150_SeedTeamWithSentinel(BudgetNo: Code[20]; DepartmentLineNo: Integer; TeamLineNo: Integer; TeamName: Text[100]; TeamWeight: Decimal; SentinelAmount: Decimal)
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

    local procedure X150_GetDeptAmount(BudgetNo: Code[20]; LineNo: Integer): Decimal
    var
        Department: Record "CG X150 Department";
    begin
        Department.Get(BudgetNo, LineNo);
        exit(Department."Department Amount");
    end;

    local procedure X150_GetTeamAmount(BudgetNo: Code[20]; DepartmentLineNo: Integer; TeamLineNo: Integer): Decimal
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
    local procedure X150_ComputeLevelShares(Weight: array[10] of Decimal; ItemCount: Integer; TotalAmount: Decimal; var ExpectedShare: array[10] of Decimal)
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
    procedure X150_SingleDepartmentSingleTeamGetsTheEntireBudget()
    var
        Allocator: Codeunit "CG X150 Budget Allocator";
    begin
        X150_ClearAllData();
        X150_SeedBudget('SP01', 246.80);
        X150_SeedDepartment('SP01', 1, 'Solo Department', 4);
        X150_SeedTeam('SP01', 1, 1, 'Solo Team', 17);

        Allocator.AllocateBudget('SP01');

        Assert.AreEqual(246.80, X150_GetDeptAmount('SP01', 1), 'Expected a budget with a single department to allocate its entire total to that department');
        Assert.AreEqual(246.80, X150_GetTeamAmount('SP01', 1, 1), 'Expected a department with a single team to allocate its entire amount to that team');
    end;

    [Test]
    procedure X150_CleanTwoDepartmentTwoTeamSplitReconcilesExactlyAndLeavesAnotherBudgetUntouched()
    var
        BudgetHeader: Record "CG X150 Budget Header";
        Allocator: Codeunit "CG X150 Budget Allocator";
    begin
        X150_ClearAllData();
        X150_SeedBudget('CD01', 200.00);
        X150_SeedDepartment('CD01', 1, 'Dept East', 1);
        X150_SeedDepartment('CD01', 2, 'Dept West', 1);
        X150_SeedTeam('CD01', 1, 1, 'Team A', 1);
        X150_SeedTeam('CD01', 1, 2, 'Team B', 1);
        X150_SeedTeam('CD01', 2, 1, 'Team C', 1);
        X150_SeedTeam('CD01', 2, 2, 'Team D', 1);

        // A second, unrelated budget is seeded with its own nonzero
        // sentinel amounts, at every level, and left alone - allocating
        // CD01 must not touch it.
        X150_SeedBudget('XB01', 999.00);
        X150_SeedDepartmentWithSentinel('XB01', 1, 'Dept Untouched', 1, 555.55);
        X150_SeedTeamWithSentinel('XB01', 1, 1, 'Team Untouched A', 1, 111.11);
        X150_SeedTeamWithSentinel('XB01', 1, 2, 'Team Untouched B', 1, 222.22);

        Allocator.AllocateBudget('CD01');

        Assert.AreEqual(100.00, X150_GetDeptAmount('CD01', 1), 'Expected an even two-department split to allocate exactly half the total to each department');
        Assert.AreEqual(100.00, X150_GetDeptAmount('CD01', 2), 'Expected an even two-department split to allocate exactly half the total to each department');
        Assert.AreEqual(50.00, X150_GetTeamAmount('CD01', 1, 1), 'Expected an even two-team split to allocate exactly half the department amount to each team');
        Assert.AreEqual(50.00, X150_GetTeamAmount('CD01', 1, 2), 'Expected an even two-team split to allocate exactly half the department amount to each team');
        Assert.AreEqual(50.00, X150_GetTeamAmount('CD01', 2, 1), 'Expected an even two-team split to allocate exactly half the department amount to each team');
        Assert.AreEqual(50.00, X150_GetTeamAmount('CD01', 2, 2), 'Expected an even two-team split to allocate exactly half the department amount to each team');
        Assert.AreEqual(200.00, Allocator.GetAllocatedTotal('CD01'), 'Expected the budget-level reconciliation total to equal the budget total after allocating');
        Assert.AreEqual(100.00, Allocator.GetDepartmentAllocatedTotal('CD01', 1), 'Expected the department-level reconciliation total to equal the department amount after allocating');

        BudgetHeader.Get('XB01');
        Assert.IsFalse(BudgetHeader.Allocated, 'Expected an untouched budget to stay unallocated');
        Assert.AreEqual(555.55, X150_GetDeptAmount('XB01', 1), 'Expected another budget''s department amount to be left untouched by allocating a different budget');
        Assert.AreEqual(111.11, X150_GetTeamAmount('XB01', 1, 1), 'Expected another budget''s team amount to be left untouched by allocating a different budget');
        Assert.AreEqual(222.22, X150_GetTeamAmount('XB01', 1, 2), 'Expected another budget''s team amount to be left untouched by allocating a different budget');
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
    procedure X150_AdversarialFourDepartmentAllocationClosesExactlyAtEveryLevel()
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
        X150_ClearAllData();
        X150_SeedBudget('AD01', 500.00);
        X150_SeedDepartment('AD01', 1, 'Dept Alpha', 26);
        X150_SeedDepartment('AD01', 2, 'Dept Beta', 21);
        X150_SeedDepartment('AD01', 3, 'Dept Gamma', 30);
        X150_SeedDepartment('AD01', 4, 'Dept Delta', 19);

        X150_SeedTeam('AD01', 1, 1, 'Team Alpha-1', 8);
        X150_SeedTeam('AD01', 1, 2, 'Team Alpha-2', 5);
        X150_SeedTeam('AD01', 1, 3, 'Team Alpha-3', 4);

        X150_SeedTeam('AD01', 2, 1, 'Team Beta-1', 1);
        X150_SeedTeam('AD01', 2, 2, 'Team Beta-2', 10);

        X150_SeedTeam('AD01', 3, 1, 'Team Gamma-1', 2);
        X150_SeedTeam('AD01', 3, 2, 'Team Gamma-2', 6);
        X150_SeedTeam('AD01', 3, 3, 'Team Gamma-3', 3);

        X150_SeedTeam('AD01', 4, 1, 'Team Delta-1', 10);
        X150_SeedTeam('AD01', 4, 2, 'Team Delta-2', 9);
        X150_SeedTeam('AD01', 4, 3, 'Team Delta-3', 11);

        Allocator.AllocateBudget('AD01');

        Assert.AreEqual(135.42, X150_GetDeptAmount('AD01', 1), 'Expected Dept Alpha''s recorded amount to depend only on the budget''s weights and total');
        Assert.AreEqual(109.37, X150_GetDeptAmount('AD01', 2), 'Expected Dept Beta''s recorded amount to depend only on the budget''s weights and total');
        Assert.AreEqual(156.25, X150_GetDeptAmount('AD01', 3), 'Expected Dept Gamma''s recorded amount to depend only on the budget''s weights and total');
        Assert.AreEqual(98.96, X150_GetDeptAmount('AD01', 4), 'Expected Dept Delta''s recorded amount to depend only on the budget''s weights and total');

        Assert.AreEqual(63.73, X150_GetTeamAmount('AD01', 1, 1), 'Expected Team Alpha-1''s recorded amount to depend only on its department''s amount and weights');
        Assert.AreEqual(39.83, X150_GetTeamAmount('AD01', 1, 2), 'Expected Team Alpha-2''s recorded amount to depend only on its department''s amount and weights');
        Assert.AreEqual(31.86, X150_GetTeamAmount('AD01', 1, 3), 'Expected Team Alpha-3''s recorded amount to depend only on its department''s amount and weights');

        Assert.AreEqual(9.94, X150_GetTeamAmount('AD01', 2, 1), 'Expected Team Beta-1''s recorded amount to depend only on its department''s amount and weights');
        Assert.AreEqual(99.43, X150_GetTeamAmount('AD01', 2, 2), 'Expected Team Beta-2''s recorded amount to depend only on its department''s amount and weights');

        Assert.AreEqual(28.41, X150_GetTeamAmount('AD01', 3, 1), 'Expected Team Gamma-1''s recorded amount to depend only on its department''s amount and weights');
        Assert.AreEqual(85.23, X150_GetTeamAmount('AD01', 3, 2), 'Expected Team Gamma-2''s recorded amount to depend only on its department''s amount and weights');
        Assert.AreEqual(42.61, X150_GetTeamAmount('AD01', 3, 3), 'Expected Team Gamma-3''s recorded amount to depend only on its department''s amount and weights');

        Assert.AreEqual(32.99, X150_GetTeamAmount('AD01', 4, 1), 'Expected Team Delta-1''s recorded amount to depend only on its department''s amount and weights');
        Assert.AreEqual(29.69, X150_GetTeamAmount('AD01', 4, 2), 'Expected Team Delta-2''s recorded amount to depend only on its department''s amount and weights');
        Assert.AreEqual(36.28, X150_GetTeamAmount('AD01', 4, 3), 'Expected Team Delta-3''s recorded amount to depend only on its department''s amount and weights');

        GrandTotal := 0;
        for i := 1 to 4 do begin
            DeptTeamTotal := X150_GetTeamAmount('AD01', i, 1) + X150_GetTeamAmount('AD01', i, 2);
            // Every department has three teams except Dept Beta (i = 2),
            // which has only two.
            if i <> 2 then
                DeptTeamTotal += X150_GetTeamAmount('AD01', i, 3);
            Assert.AreEqual(
              X150_GetDeptAmount('AD01', i), DeptTeamTotal,
              StrSubstNo('Expected department %1''s teams to sum to exactly that department''s own recorded amount', i));
            GrandTotal += X150_GetDeptAmount('AD01', i);
        end;
        Assert.AreEqual(500.00, GrandTotal, 'Expected every department''s recorded amount to sum to exactly the budget''s total amount');
    end;

    [Test]
    procedure X150_ZeroWeightDepartmentAndZeroWeightTeamAlwaysReceiveExactlyZero()
    var
        Allocator: Codeunit "CG X150 Budget Allocator";
    begin
        X150_ClearAllData();
        X150_SeedBudget('ZW01', 90.00);
        X150_SeedDepartment('ZW01', 1, 'Dept Live', 5);
        X150_SeedDepartment('ZW01', 2, 'Dept Sample', 0);
        X150_SeedTeam('ZW01', 1, 1, 'Team Regular', 3);
        X150_SeedTeam('ZW01', 1, 2, 'Team Comp', 0);
        X150_SeedTeam('ZW01', 2, 1, 'Team No Budget', 7);

        Allocator.AllocateBudget('ZW01');

        Assert.AreEqual(90.00, X150_GetDeptAmount('ZW01', 1), 'Expected a department with weight to receive its full proportional share when the only other department has none');
        Assert.AreEqual(0.00, X150_GetDeptAmount('ZW01', 2), 'Expected a department with no weight to receive exactly zero, even though another department on the same budget carries a nonzero total');
        Assert.AreEqual(90.00, X150_GetTeamAmount('ZW01', 1, 1), 'Expected a team with weight to receive its full proportional share when the only other team on its department has none');
        Assert.AreEqual(0.00, X150_GetTeamAmount('ZW01', 1, 2), 'Expected a team with no weight to receive exactly zero, even though another team on the same department carries a nonzero amount');
        Assert.AreEqual(0.00, X150_GetTeamAmount('ZW01', 2, 1), 'Expected a team under a department that itself received zero to receive exactly zero, regardless of the team''s own weight');
    end;

    [Test]
    procedure X150_DepartmentWithNoTeamWeightLeavesItsTeamsUntouched()
    var
        Allocator: Codeunit "CG X150 Budget Allocator";
    begin
        X150_ClearAllData();
        X150_SeedBudget('NT01', 80.00);
        X150_SeedDepartment('NT01', 1, 'Dept Funded', 1);
        X150_SeedDepartment('NT01', 2, 'Dept Empty', 1);
        X150_SeedTeam('NT01', 1, 1, 'Team Live', 1);
        X150_SeedTeamWithSentinel('NT01', 2, 1, 'Team Idle 1', 0, 77.77);
        X150_SeedTeamWithSentinel('NT01', 2, 2, 'Team Idle 2', 0, 88.88);

        Allocator.AllocateBudget('NT01');

        Assert.AreEqual(40.00, X150_GetDeptAmount('NT01', 1), 'Expected a funded department to receive its proportional share of the total');
        Assert.AreEqual(40.00, X150_GetDeptAmount('NT01', 2), 'Expected a department with weight to receive its proportional share of the total even when its own teams have none');
        Assert.AreEqual(40.00, X150_GetTeamAmount('NT01', 1, 1), 'Expected the only team on a funded department to receive that department''s entire amount');

        Assert.AreEqual(
          77.77, X150_GetTeamAmount('NT01', 2, 1),
          'Expected a team''s existing amount to be left untouched when its department has nothing to allocate among its teams, even though the department itself received a nonzero amount');
        Assert.AreEqual(
          88.88, X150_GetTeamAmount('NT01', 2, 2),
          'Expected a team''s existing amount to be left untouched when its department has nothing to allocate among its teams, even though the department itself received a nonzero amount');
    end;

    [Test]
    procedure X150_WholeBudgetWithNoWeightAnywhereIsLeftUnallocated()
    var
        BudgetHeader: Record "CG X150 Budget Header";
        Allocator: Codeunit "CG X150 Budget Allocator";
    begin
        X150_ClearAllData();
        X150_SeedBudget('NB01', 60.00);
        X150_SeedDepartmentWithSentinel('NB01', 1, 'Dept Idle A', 0, 11.11);
        X150_SeedTeamWithSentinel('NB01', 1, 1, 'Team Idle A1', 0, 22.22);
        X150_SeedDepartmentWithSentinel('NB01', 2, 'Dept Idle B', 0, 33.33);
        X150_SeedTeamWithSentinel('NB01', 2, 1, 'Team Idle B1', 0, 44.44);

        Allocator.AllocateBudget('NB01');

        BudgetHeader.Get('NB01');
        Assert.IsFalse(BudgetHeader.Allocated, 'Expected a budget with no weight on any department to be left unallocated');
        Assert.AreEqual(11.11, X150_GetDeptAmount('NB01', 1), 'Expected a department''s existing amount to be left untouched when the budget has no weight to allocate');
        Assert.AreEqual(33.33, X150_GetDeptAmount('NB01', 2), 'Expected a department''s existing amount to be left untouched when the budget has no weight to allocate');
        Assert.AreEqual(22.22, X150_GetTeamAmount('NB01', 1, 1), 'Expected a team''s existing amount to be left untouched when the budget has no weight to allocate');
        Assert.AreEqual(44.44, X150_GetTeamAmount('NB01', 2, 1), 'Expected a team''s existing amount to be left untouched when the budget has no weight to allocate');
    end;

    [Test]
    procedure X150_ReorderingDepartmentsAndTeamsNeverChangesTheirAmount()
    var
        Allocator: Codeunit "CG X150 Budget Allocator";
    begin
        // Same four department weights and the same three team weights
        // under "Alpha" as the adversarial fixture above, entered in the
        // opposite order on the second budget - both at the department
        // level and, within Alpha, at the team level.
        X150_ClearAllData();

        X150_SeedBudget('PM01', 500.00);
        X150_SeedDepartment('PM01', 1, 'Dept Alpha', 26);
        X150_SeedDepartment('PM01', 2, 'Dept Beta', 21);
        X150_SeedDepartment('PM01', 3, 'Dept Gamma', 30);
        X150_SeedDepartment('PM01', 4, 'Dept Delta', 19);
        X150_SeedTeam('PM01', 1, 1, 'Team Alpha-1', 8);
        X150_SeedTeam('PM01', 1, 2, 'Team Alpha-2', 5);
        X150_SeedTeam('PM01', 1, 3, 'Team Alpha-3', 4);

        X150_SeedBudget('PM02', 500.00);
        X150_SeedDepartment('PM02', 1, 'Dept Delta', 19);
        X150_SeedDepartment('PM02', 2, 'Dept Gamma', 30);
        X150_SeedDepartment('PM02', 3, 'Dept Beta', 21);
        X150_SeedDepartment('PM02', 4, 'Dept Alpha', 26);
        X150_SeedTeam('PM02', 4, 1, 'Team Alpha-3', 4);
        X150_SeedTeam('PM02', 4, 2, 'Team Alpha-2', 5);
        X150_SeedTeam('PM02', 4, 3, 'Team Alpha-1', 8);

        Allocator.AllocateBudget('PM01');
        Allocator.AllocateBudget('PM02');

        Assert.AreEqual(135.42, X150_GetDeptAmount('PM01', 1), 'Expected Dept Alpha''s amount to depend only on the budget''s weights and total, never on entry order');
        Assert.AreEqual(135.42, X150_GetDeptAmount('PM02', 4), 'Expected Dept Alpha''s amount to depend only on the budget''s weights and total, never on entry order');
        Assert.AreEqual(109.37, X150_GetDeptAmount('PM01', 2), 'Expected Dept Beta''s amount to depend only on the budget''s weights and total, never on entry order');
        Assert.AreEqual(109.37, X150_GetDeptAmount('PM02', 3), 'Expected Dept Beta''s amount to depend only on the budget''s weights and total, never on entry order');
        Assert.AreEqual(156.25, X150_GetDeptAmount('PM01', 3), 'Expected Dept Gamma''s amount to depend only on the budget''s weights and total, never on entry order');
        Assert.AreEqual(156.25, X150_GetDeptAmount('PM02', 2), 'Expected Dept Gamma''s amount to depend only on the budget''s weights and total, never on entry order');
        Assert.AreEqual(98.96, X150_GetDeptAmount('PM01', 4), 'Expected Dept Delta''s amount to depend only on the budget''s weights and total, never on entry order');
        Assert.AreEqual(98.96, X150_GetDeptAmount('PM02', 1), 'Expected Dept Delta''s amount to depend only on the budget''s weights and total, never on entry order');

        Assert.AreEqual(63.73, X150_GetTeamAmount('PM01', 1, 1), 'Expected Team Alpha-1''s amount to depend only on its department''s amount and weights, never on entry order');
        Assert.AreEqual(63.73, X150_GetTeamAmount('PM02', 4, 3), 'Expected Team Alpha-1''s amount to depend only on its department''s amount and weights, never on entry order');
        Assert.AreEqual(39.83, X150_GetTeamAmount('PM01', 1, 2), 'Expected Team Alpha-2''s amount to depend only on its department''s amount and weights, never on entry order');
        Assert.AreEqual(39.83, X150_GetTeamAmount('PM02', 4, 2), 'Expected Team Alpha-2''s amount to depend only on its department''s amount and weights, never on entry order');
        Assert.AreEqual(31.86, X150_GetTeamAmount('PM01', 1, 3), 'Expected Team Alpha-3''s amount to depend only on its department''s amount and weights, never on entry order');
        Assert.AreEqual(31.86, X150_GetTeamAmount('PM02', 4, 1), 'Expected Team Alpha-3''s amount to depend only on its department''s amount and weights, never on entry order');
    end;

    [Test]
    procedure X150_SuccessfulAllocationMarksTheBudgetAllocated()
    var
        BudgetHeader: Record "CG X150 Budget Header";
        Allocator: Codeunit "CG X150 Budget Allocator";
    begin
        X150_ClearAllData();
        X150_SeedBudget('MK01', 10.00);
        X150_SeedDepartment('MK01', 1, 'Dept Only', 1);
        X150_SeedTeam('MK01', 1, 1, 'Team Only', 1);

        Allocator.AllocateBudget('MK01');

        BudgetHeader.Get('MK01');
        Assert.IsTrue(BudgetHeader.Allocated, 'Expected a budget with at least one weighted department to be marked allocated');
    end;

    [Test]
    procedure X150_DeterministicSweepMatchesTheTwoLevelReferenceAcrossManyPartitions()
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
            X150_ClearAllData();
            BudgetNo := 'SW' + Format(Partition);
            DeptCount := Any.IntegerInRange(3, 6);
            TotalAmount := Any.IntegerInRange(100, 99999) / 100;
            X150_SeedBudget(BudgetNo, TotalAmount);

            for i := 1 to DeptCount do begin
                // Roughly every fourth department on a sweep partition
                // carries no weight to allocate.
                if i mod 4 = 0 then
                    DeptWeight[i] := 0
                else
                    DeptWeight[i] := Any.DecimalInRange(1, 500, 3);
                X150_SeedDepartment(BudgetNo, i, StrSubstNo('Sweep dept %1', i), DeptWeight[i]);
            end;

            X150_ComputeLevelShares(DeptWeight, DeptCount, TotalAmount, ExpectedDeptShare);

            for i := 1 to DeptCount do begin
                TeamCount[i] := Any.IntegerInRange(2, 5);
                for j := 1 to TeamCount[i] do begin
                    if j mod 3 = 0 then
                        TeamWeightRow[j] := 0
                    else
                        TeamWeightRow[j] := Any.DecimalInRange(1, 300, 3);
                    X150_SeedTeam(BudgetNo, i, j, StrSubstNo('Sweep dept %1 team %2', i, j), TeamWeightRow[j]);
                end;
                X150_ComputeLevelShares(TeamWeightRow, TeamCount[i], ExpectedDeptShare[i], TeamShareRow);
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

    // ==========================================================
    // X162 - donor CG-AL-X162
    // ==========================================================

    local procedure X162_GetOtherCompanyName(): Text[30]
    var
        Company: Record Company;
        HereName: Text[30];
    begin
        HereName := CompanyName();
        Company.SetFilter(Name, '<>%1', HereName);
        if Company.FindFirst() then
            exit(Company.Name);
        Error('Expected at least one other company to exist on this container to verify cross-company isolation');
    end;

    local procedure X162_ClearHomeMeterReadings()
    var
        MeterReading: Record "CG X162 Meter Reading";
    begin
        MeterReading.DeleteAll();
    end;

    local procedure X162_ClearOtherMeterReadings(OtherName: Text[30])
    var
        MeterReading: Record "CG X162 Meter Reading";
    begin
        MeterReading.ChangeCompany(OtherName);
        MeterReading.DeleteAll();
    end;

    local procedure X162_ClearCollected()
    var
        CollectedReading: Record "CG X162 Collected Reading";
    begin
        CollectedReading.DeleteAll();
    end;

    local procedure X162_ClearAll(OtherName: Text[30])
    begin
        X162_ClearHomeMeterReadings();
        X162_ClearOtherMeterReadings(OtherName);
        X162_ClearCollected();
        Commit();
    end;

    local procedure X162_SumAllCollected(): Decimal
    var
        CollectedReading: Record "CG X162 Collected Reading";
        Total: Decimal;
    begin
        if CollectedReading.FindSet() then
            repeat
                Total += CollectedReading.Quantity;
            until CollectedReading.Next() = 0;
        exit(Total);
    end;

    local procedure X162_SumCollectedForCompany(SourceCompanyName: Text[30]): Decimal
    var
        CollectedReading: Record "CG X162 Collected Reading";
        Total: Decimal;
    begin
        CollectedReading.SetRange("Source Company", SourceCompanyName);
        if CollectedReading.FindSet() then
            repeat
                Total += CollectedReading.Quantity;
            until CollectedReading.Next() = 0;
        exit(Total);
    end;

    local procedure X162_CountAllCollected(): Integer
    var
        CollectedReading: Record "CG X162 Collected Reading";
    begin
        exit(CollectedReading.Count());
    end;

    [Test]
    procedure X162_TheOverallCollectedTotalIsCorrect()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        Total: Decimal;
    begin
        OtherName := X162_GetOtherCompanyName();
        HomeName := CompanyName();
        X162_ClearAll(OtherName);

        SetupMgt.SetMeterReading(HomeName, 'H1', 5);
        SetupMgt.SetMeterReading(HomeName, 'H2', 3);
        SetupMgt.SetMeterReading(OtherName, 'O1', 9);
        SetupMgt.SetMeterReading(OtherName, 'O2', 2);

        Consolidator.CollectReadings();

        Total := X162_SumAllCollected();

        X162_ClearAll(OtherName);

        Assert.AreEqual(19.0, Total,
            'Expected the collected list''s total quantity to equal the sum of every reading collected from every company');
    end;

    [Test]
    procedure X162_ReadingsFromTheOtherCompanyAreFiledUnderTheCompanyTheyCameFrom()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        CollectedReading: Record "CG X162 Collected Reading";
        FiledUnderOther: Boolean;
        MisfiledUnderHome: Boolean;
        OtherQty: Decimal;
    begin
        OtherName := X162_GetOtherCompanyName();
        HomeName := CompanyName();
        X162_ClearAll(OtherName);

        SetupMgt.SetMeterReading(HomeName, 'H1', 5);
        SetupMgt.SetMeterReading(OtherName, 'O1', 9);

        Consolidator.CollectReadings();

        FiledUnderOther := CollectedReading.Get(OtherName, 'O1');
        if FiledUnderOther then
            OtherQty := CollectedReading.Quantity;
        MisfiledUnderHome := CollectedReading.Get(HomeName, 'O1');

        X162_ClearAll(OtherName);

        Assert.IsTrue(FiledUnderOther,
            'Expected the reading recorded by the other company to be filed in the collected list under the other company');
        Assert.AreEqual(9.0, OtherQty,
            'Expected the reading filed under the other company to keep its own recorded quantity');
        Assert.IsFalse(MisfiledUnderHome,
            'Expected the reading recorded by the other company not to be filed under this company');
    end;

    [Test]
    procedure X162_TheHomeCompanysOwnReadingIsFiledUnderItself()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        CollectedReading: Record "CG X162 Collected Reading";
        Filed: Boolean;
    begin
        OtherName := X162_GetOtherCompanyName();
        HomeName := CompanyName();
        X162_ClearAll(OtherName);

        SetupMgt.SetMeterReading(HomeName, 'H1', 5);

        Consolidator.CollectReadings();

        Filed := CollectedReading.Get(HomeName, 'H1');

        X162_ClearAll(OtherName);

        Assert.IsTrue(Filed,
            'Expected this company''s own reading to be filed under this company');
        Assert.AreEqual(5.0, CollectedReading.Quantity,
            'Expected this company''s own reading to keep its own recorded quantity');
    end;

    [Test]
    procedure X162_SubtotalsPerCompanyReflectWhereEachReadingCameFrom()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        HomeSubtotal: Decimal;
        OtherSubtotal: Decimal;
    begin
        OtherName := X162_GetOtherCompanyName();
        HomeName := CompanyName();
        X162_ClearAll(OtherName);

        SetupMgt.SetMeterReading(HomeName, 'H1', 5);
        SetupMgt.SetMeterReading(HomeName, 'H2', 3);
        SetupMgt.SetMeterReading(OtherName, 'O1', 9);
        SetupMgt.SetMeterReading(OtherName, 'O2', 2);

        Consolidator.CollectReadings();

        HomeSubtotal := X162_SumCollectedForCompany(HomeName);
        OtherSubtotal := X162_SumCollectedForCompany(OtherName);

        X162_ClearAll(OtherName);

        Assert.AreEqual(8.0, HomeSubtotal,
            'Expected the subtotal filed under this company to equal only the readings this company recorded');
        Assert.AreEqual(11.0, OtherSubtotal,
            'Expected the subtotal filed under the other company to equal only the readings the other company recorded');
    end;

    [Test]
    procedure X162_ACompanyWithNoReadingsContributesNothingToTheCollectedList()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        RowCount: Integer;
    begin
        OtherName := X162_GetOtherCompanyName();
        HomeName := CompanyName();
        X162_ClearAll(OtherName);

        SetupMgt.SetMeterReading(HomeName, 'H1', 5);

        Consolidator.CollectReadings();

        RowCount := X162_CountAllCollected();

        X162_ClearAll(OtherName);

        Assert.AreEqual(1, RowCount,
            'Expected a company with no readings to add nothing to the collected list');
    end;

    [Test]
    procedure X162_SourceMeterReadingsAreUnchangedAfterCollection()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        HomeQtyAfter: Decimal;
        OtherQtyAfter: Decimal;
    begin
        OtherName := X162_GetOtherCompanyName();
        HomeName := CompanyName();
        X162_ClearAll(OtherName);

        SetupMgt.SetMeterReading(HomeName, 'H1', 5);
        SetupMgt.SetMeterReading(OtherName, 'O1', 9);

        Consolidator.CollectReadings();

        HomeQtyAfter := SetupMgt.GetMeterReading(HomeName, 'H1');
        OtherQtyAfter := SetupMgt.GetMeterReading(OtherName, 'O1');

        X162_ClearAll(OtherName);

        Assert.AreEqual(5.0, HomeQtyAfter,
            'Expected this company''s recorded meter reading to be unchanged by collecting it into the list');
        Assert.AreEqual(9.0, OtherQtyAfter,
            'Expected the other company''s recorded meter reading to be unchanged by collecting it into the list');
    end;

    [Test]
    procedure X162_RunningCollectionAgainReplacesEachReadingRatherThanDuplicatingIt()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        RowCountAfterFirstRun: Integer;
        RowCountAfterSecondRun: Integer;
        TotalAfterFirstRun: Decimal;
        TotalAfterSecondRun: Decimal;
    begin
        OtherName := X162_GetOtherCompanyName();
        HomeName := CompanyName();
        X162_ClearAll(OtherName);

        SetupMgt.SetMeterReading(HomeName, 'H1', 5);
        SetupMgt.SetMeterReading(OtherName, 'O1', 9);

        Consolidator.CollectReadings();
        RowCountAfterFirstRun := X162_CountAllCollected();
        TotalAfterFirstRun := X162_SumAllCollected();

        SetupMgt.SetMeterReading(HomeName, 'H1', 8);
        Consolidator.CollectReadings();
        RowCountAfterSecondRun := X162_CountAllCollected();
        TotalAfterSecondRun := X162_SumAllCollected();

        X162_ClearAll(OtherName);

        Assert.AreEqual(RowCountAfterFirstRun, RowCountAfterSecondRun,
            'Expected running the collection again to replace each company''s reading rather than adding another row for it');
        Assert.AreEqual(14.0, TotalAfterFirstRun,
            'Expected the first collection to total the readings recorded at that point');
        Assert.AreEqual(17.0, TotalAfterSecondRun,
            'Expected collecting again after a reading changed to reflect its newly recorded quantity rather than the old one');
    end;
}
