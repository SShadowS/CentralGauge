codeunit 89440 "CG-AL-X218 Test"
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
        // every test clears both tables before seeding its own rows. Grades are
        // random text rather than fixed literals so a fix cannot special-case a
        // hardcoded value.
        // The default test isolation persists writes between test methods
        // (measured 2026-08-20, SOAP runner), so every test clears both tables
        // before seeding its own contracts. Contract numbers are unique per
        // test regardless, but the tables are still cleared up front per the
        // house convention.
        // before seeding its own rows.
        // A block list kept in memory for the rest of the session does not roll
        // back with the test transaction, so every test clears both the table
        // and that in-memory copy before seeding its own data.

    // ==========================================================
    // X081 - donor CG-AL-X081
    // ==========================================================

    local procedure X081_Reset()
    var
        OrderLine: Record "CG X081 Order Line";
        Item: Record "CG X081 Item";
    begin
        OrderLine.DeleteAll();
        Item.DeleteAll();
    end;

    local procedure X081_CreateItem(var Item: Record "CG X081 Item"; No: Code[20]; Grade: Code[10])
    begin
        Item.Init();
        Item."No." := No;
        Item."Quality Grade" := Grade;
        Item.Insert(true);
    end;

    local procedure X081_RandomGrade(var Any: Codeunit Any): Code[10]
    begin
        exit(CopyStr(Any.AlphabeticText(10), 1, 10));
    end;

    local procedure X081_CreateLine(var OrderLine: Record "CG X081 Order Line"; EntryNo: Integer; ItemNo: Code[20])
    begin
        OrderLine.Init();
        OrderLine."Entry No." := EntryNo;
        OrderLine.Insert(true);
        OrderLine.Validate("Item No.", ItemNo);
        OrderLine.Modify(true);
    end;

    [Test]
    procedure X081_NewLineForAGradedItemGetsTheGrade()
    var
        Item: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        Grade: Code[10];
        Any: Codeunit Any;
    begin
        X081_Reset();
        Grade := X081_RandomGrade(Any);
        X081_CreateItem(Item, 'ITEM-A', Grade);

        X081_CreateLine(OrderLine, 1, Item."No.");

        Assert.AreEqual(Grade, OrderLine."Quality Grade",
            'Expected validating "Item No." with a graded item to copy that item''s grade onto the line');
    end;

    [Test]
    procedure X081_NewLineForAGradelessItemStaysBlank()
    var
        Item: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
    begin
        X081_Reset();
        X081_CreateItem(Item, 'ITEM-B', '');

        X081_CreateLine(OrderLine, 2, Item."No.");

        Assert.AreEqual('', OrderLine."Quality Grade",
            'Expected the line''s grade to stay blank when the item on it has none');
    end;

    [Test]
    procedure X081_RevalidatingToAnotherGradedItemOverwritesTheGrade()
    var
        FirstItem: Record "CG X081 Item";
        SecondItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        SecondGrade: Code[10];
        Any: Codeunit Any;
    begin
        X081_Reset();
        X081_CreateItem(FirstItem, 'ITEM-C', X081_RandomGrade(Any));
        SecondGrade := X081_RandomGrade(Any);
        X081_CreateItem(SecondItem, 'ITEM-D', SecondGrade);
        X081_CreateLine(OrderLine, 3, FirstItem."No.");

        OrderLine.Validate("Item No.", SecondItem."No.");
        OrderLine.Modify(true);

        Assert.AreEqual(SecondGrade, OrderLine."Quality Grade",
            'Expected re-validating "Item No." to another graded item to overwrite the line''s grade with the new item''s grade');
    end;

    [Test]
    procedure X081_RevalidatingToAGradelessItemClearsTheLine()
    var
        GradedItem: Record "CG X081 Item";
        GradelessItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        Any: Codeunit Any;
    begin
        X081_Reset();
        X081_CreateItem(GradedItem, 'ITEM-E', X081_RandomGrade(Any));
        X081_CreateItem(GradelessItem, 'ITEM-F', '');
        X081_CreateLine(OrderLine, 4, GradedItem."No.");

        OrderLine.Validate("Item No.", GradelessItem."No.");
        OrderLine.Modify(true);

        Assert.AreEqual('', OrderLine."Quality Grade",
            'Expected the line''s grade to be cleared when "Item No." is re-validated to an item with no grade - the line must always mirror the item that is on it');
    end;

    [Test]
    procedure X081_ClearingTheItemNoAlsoClearsTheGrade()
    var
        GradedItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        Any: Codeunit Any;
    begin
        X081_Reset();
        X081_CreateItem(GradedItem, 'ITEM-M', X081_RandomGrade(Any));
        X081_CreateLine(OrderLine, 8, GradedItem."No.");

        OrderLine.Validate("Item No.", '');
        OrderLine.Modify(true);

        Assert.AreEqual('', OrderLine."Quality Grade",
            'Expected the line''s grade to be cleared when "Item No." is re-validated to blank - the line must always mirror the item that is on it');
    end;

    [Test]
    procedure X081_RevalidatingBackToAGradedItemAfterClearingSetsTheNewGrade()
    var
        FirstGradedItem: Record "CG X081 Item";
        GradelessItem: Record "CG X081 Item";
        SecondGradedItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        SecondGrade: Code[10];
        Any: Codeunit Any;
    begin
        X081_Reset();
        X081_CreateItem(FirstGradedItem, 'ITEM-G', X081_RandomGrade(Any));
        X081_CreateItem(GradelessItem, 'ITEM-H', '');
        SecondGrade := X081_RandomGrade(Any);
        X081_CreateItem(SecondGradedItem, 'ITEM-I', SecondGrade);
        X081_CreateLine(OrderLine, 5, FirstGradedItem."No.");

        OrderLine.Validate("Item No.", GradelessItem."No.");
        OrderLine.Modify(true);
        OrderLine.Validate("Item No.", SecondGradedItem."No.");
        OrderLine.Modify(true);

        Assert.AreEqual(SecondGrade, OrderLine."Quality Grade",
            'Expected re-validating "Item No." back to a graded item after a gradeless item to set the new item''s grade');
    end;

    [Test]
    procedure X081_AssigningItemValuesDirectlyAlsoClearsAStaleGrade()
    var
        GradelessItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        LineDefaultsMgt: Codeunit "CG X081 Line Defaults Mgt";
    begin
        X081_Reset();
        X081_CreateItem(GradelessItem, 'ITEM-J', '');
        OrderLine.Init();
        OrderLine."Entry No." := 6;
        OrderLine."Item No." := GradelessItem."No.";
        OrderLine."Quality Grade" := 'STALE';
        OrderLine.Insert(true);

        LineDefaultsMgt.AssignItemValues(OrderLine);
        OrderLine.Modify(true);

        Assert.AreEqual('', OrderLine."Quality Grade",
            'Expected assigning item values for a line pointed at a gradeless item to leave the line''s grade blank, matching what that item carries');
    end;

    [Test]
    procedure X081_UnrelatedLinesAreNeverTouched()
    var
        GradedItem: Record "CG X081 Item";
        GradelessItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        OtherLine: Record "CG X081 Order Line";
        Any: Codeunit Any;
    begin
        X081_Reset();
        X081_CreateItem(GradedItem, 'ITEM-K', X081_RandomGrade(Any));
        X081_CreateItem(GradelessItem, 'ITEM-L', '');

        OtherLine.Init();
        OtherLine."Entry No." := 100;
        OtherLine."Quality Grade" := 'SENTINEL9';
        OtherLine.Insert(true);

        X081_CreateLine(OrderLine, 7, GradedItem."No.");
        OrderLine.Validate("Item No.", GradelessItem."No.");
        OrderLine.Modify(true);

        OtherLine.Get(100);
        Assert.AreEqual('SENTINEL9', Format(OtherLine."Quality Grade"),
            'Expected a line never re-validated in this test to keep its original grade untouched');
    end;

    // ==========================================================
    // X121 - donor CG-AL-X121
    // ==========================================================

    local procedure X121_CreateContract(var Header: Record "CG X121 Contract Header"; No: Code[20]; PlanCode: Code[10]; RegionCode: Code[10]; ContactName: Text[50])
    var
        ContractMgt: Codeunit "CG X121 Contract Mgt";
    begin
        Header.Init();
        Header."No." := No;
        Header."Plan Code" := PlanCode;
        Header."Region Code" := RegionCode;
        Header."Contact Name" := ContactName;
        Header.Insert();
        ContractMgt.GenerateInitialLines(Header);
    end;

    local procedure X121_AssertAllLinesHaveAmount(ContractNo: Code[20]; ExpectedAmount: Decimal; Msg: Text)
    var
        Line: Record "CG X121 Contract Line";
        LineCount: Integer;
    begin
        Line.SetRange("Contract No.", ContractNo);
        if Line.FindSet() then
            repeat
                Assert.AreEqual(ExpectedAmount, Line.Amount, Msg);
                LineCount += 1;
            until Line.Next() = 0;
        Assert.AreEqual(3, LineCount, 'Expected exactly three billing lines for the contract');
    end;

    [Test]
    procedure X121_PlanCodeChangeRefreshesLines()
    var
        Header: Record "CG X121 Contract Header";
        Line: Record "CG X121 Contract Line";
        ContractMgt: Codeunit "CG X121 Contract Mgt";
    begin
        Header.DeleteAll();
        Line.DeleteAll();
        X121_CreateContract(Header, 'C001', 'BASIC', 'EAST', 'Alice');

        Header.Validate("Plan Code", 'PLUS');
        Header.Modify();
        ContractMgt.RefreshLines(Header);
        Header.Get('C001');

        X121_AssertAllLinesHaveAmount('C001', 200, 'Billing lines must reflect the new plan after the lines are refreshed');
        Assert.AreEqual(6, Header."Last Line Entry No.", 'Refreshing the billing lines after a plan change must rebuild them, not just adjust their amounts in place');

        Line.SetRange("Contract No.", 'C001');
        Assert.IsTrue(Line.FindSet(), 'The contract must still have billing lines after the plan change');
        Assert.AreEqual(1, Line."Period No.", 'The first billing line must keep its position in the billing schedule after the lines are refreshed');
        Line.FindLast();
        Assert.AreEqual(3, Line."Period No.", 'The third billing line must keep its position in the billing schedule after the lines are refreshed');
    end;

    [Test]
    procedure X121_RegionCodeChangeRefreshesLines()
    var
        Header: Record "CG X121 Contract Header";
        Line: Record "CG X121 Contract Line";
        ContractMgt: Codeunit "CG X121 Contract Mgt";
    begin
        Header.DeleteAll();
        Line.DeleteAll();
        X121_CreateContract(Header, 'C002', 'BASIC', 'EAST', 'Bob');

        Header.Validate("Region Code", 'WEST');
        Header.Modify();
        ContractMgt.RefreshLines(Header);
        Header.Get('C002');

        X121_AssertAllLinesHaveAmount('C002', 110, 'Billing lines must reflect the new region after the lines are refreshed');
    end;

    [Test]
    procedure X121_ContactNameChangeDoesNotRebuildLines()
    var
        Header: Record "CG X121 Contract Header";
        Line: Record "CG X121 Contract Line";
        ContractMgt: Codeunit "CG X121 Contract Mgt";
    begin
        Header.DeleteAll();
        Line.DeleteAll();
        X121_CreateContract(Header, 'C003', 'BASIC', 'EAST', 'Carol');

        Assert.IsTrue(Line.Get('C003', 1), 'Billing line 1 for the contract must exist right after it is created');
        Line.Amount := 777;
        Line.Modify();

        Header.Validate("Contact Name", 'Caroline');
        Header.Modify();
        ContractMgt.RefreshLines(Header);
        Header.Get('C003');

        Assert.AreEqual(3, Header."Last Line Entry No.", 'The billing lines must not be rebuilt when only the contact name changes');

        Assert.IsTrue(Line.Get('C003', 1), 'Billing line 1 for the contract must still exist when only the contact name changes');
        Assert.AreEqual(777, Line.Amount, 'A billing line''s recorded amount must survive when only the contact name changes');
        Assert.IsTrue(Line.Get('C003', 2), 'Billing line 2 for the contract must still exist when only the contact name changes');
        Assert.AreEqual(100, Line.Amount, 'The second billing line must be untouched when only the contact name changes');
        Assert.IsTrue(Line.Get('C003', 3), 'Billing line 3 for the contract must still exist when only the contact name changes');
        Assert.AreEqual(100, Line.Amount, 'The third billing line must be untouched when only the contact name changes');
    end;

    [Test]
    procedure X121_PlanCodeRefreshDoesNotTouchOtherContracts()
    var
        HeaderA: Record "CG X121 Contract Header";
        HeaderB: Record "CG X121 Contract Header";
        Line: Record "CG X121 Contract Line";
        ContractMgt: Codeunit "CG X121 Contract Mgt";
    begin
        HeaderA.DeleteAll();
        Line.DeleteAll();
        X121_CreateContract(HeaderA, 'C004A', 'BASIC', 'EAST', 'Dave');
        X121_CreateContract(HeaderB, 'C004B', 'PLUS', 'NORTH', 'Erin');

        HeaderA.Validate("Plan Code", 'PREMIUM');
        HeaderA.Modify();
        ContractMgt.RefreshLines(HeaderA);
        HeaderB.Get('C004B');

        X121_AssertAllLinesHaveAmount('C004A', 300, 'Billing lines for the edited contract must reflect its new plan');
        X121_AssertAllLinesHaveAmount('C004B', 240, 'Billing lines for an unrelated contract must not change when another contract is refreshed');
        Assert.AreEqual(3, HeaderB."Last Line Entry No.", 'An unrelated contract''s billing lines must not be renumbered when another contract is refreshed');
    end;

    [Test]
    procedure X121_RegionCodeRefreshDoesNotTouchOtherContracts()
    var
        HeaderA: Record "CG X121 Contract Header";
        HeaderB: Record "CG X121 Contract Header";
        Line: Record "CG X121 Contract Line";
        ContractMgt: Codeunit "CG X121 Contract Mgt";
    begin
        HeaderA.DeleteAll();
        Line.DeleteAll();
        X121_CreateContract(HeaderA, 'C005A', 'PLUS', 'EAST', 'Frank');
        X121_CreateContract(HeaderB, 'C005B', 'PLUS', 'WEST', 'Grace');

        HeaderA.Validate("Region Code", 'NORTH');
        HeaderA.Modify();
        ContractMgt.RefreshLines(HeaderA);
        HeaderB.Get('C005B');

        X121_AssertAllLinesHaveAmount('C005A', 240, 'Billing lines for the edited contract must reflect its new region');
        X121_AssertAllLinesHaveAmount('C005B', 220, 'Billing lines for an unrelated contract must not change when another contract is refreshed');
        Assert.AreEqual(3, HeaderB."Last Line Entry No.", 'An unrelated contract''s billing lines must not be renumbered when another contract is refreshed');
    end;

    [Test]
    procedure X121_PricingFormulaAppliesAcrossPlanAndRegionCodes()
    var
        Header: Record "CG X121 Contract Header";
        PlanHeader: Record "CG X121 Contract Header";
        Line: Record "CG X121 Contract Line";
        ContractMgt: Codeunit "CG X121 Contract Mgt";
        RegionCodes: List of [Code[10]];
        ExpectedRegionFactors: List of [Decimal];
        PlanCodes: List of [Code[10]];
        ExpectedPlanRates: List of [Decimal];
        Index: Integer;
    begin
        Header.DeleteAll();
        Line.DeleteAll();

        RegionCodes.Add('WEST');
        RegionCodes.Add('NORTH');
        RegionCodes.Add('EAST');
        RegionCodes.Add('SOUTH');
        ExpectedRegionFactors.Add(1.1);
        ExpectedRegionFactors.Add(1.2);
        ExpectedRegionFactors.Add(1.0);
        ExpectedRegionFactors.Add(1.0);

        X121_CreateContract(Header, 'C006', 'PLUS', 'EAST', 'Holly');

        for Index := 1 to RegionCodes.Count() do begin
            Header.Get('C006');
            Header.Validate("Region Code", RegionCodes.Get(Index));
            Header.Modify();
            ContractMgt.RefreshLines(Header);
            X121_AssertAllLinesHaveAmount('C006', 200 * ExpectedRegionFactors.Get(Index), 'Billing lines must reflect the region currently on the header');
        end;

        PlanCodes.Add('GOLD');
        ExpectedPlanRates.Add(100);

        X121_CreateContract(PlanHeader, 'C007', 'BASIC', 'EAST', 'Ivan');

        for Index := 1 to PlanCodes.Count() do begin
            PlanHeader.Get('C007');
            PlanHeader.Validate("Plan Code", PlanCodes.Get(Index));
            PlanHeader.Modify();
            ContractMgt.RefreshLines(PlanHeader);
            X121_AssertAllLinesHaveAmount('C007', ExpectedPlanRates.Get(Index) * 1.0, 'Billing lines must reflect the plan currently on the header');
        end;
    end;

    // ==========================================================
    // X140 - donor CG-AL-X140
    // ==========================================================

    local procedure X140_ClearAllData()
    var
        RebateHeader: Record "CG X140 Rebate Header";
        RebateLine: Record "CG X140 Rebate Line";
    begin
        RebateLine.DeleteAll();
        RebateHeader.DeleteAll();
    end;

    local procedure X140_SeedHeader(DocumentNo: Code[20]; TotalAmount: Decimal)
    var
        RebateHeader: Record "CG X140 Rebate Header";
    begin
        RebateHeader.Init();
        RebateHeader."No." := DocumentNo;
        RebateHeader."Rebate Description" := 'Test rebate';
        RebateHeader."Total Rebate Amount" := TotalAmount;
        RebateHeader.Insert();
    end;

    local procedure X140_SeedLine(DocumentNo: Code[20]; LineNo: Integer; ItemDescription: Text[100]; LineWeight: Decimal)
    var
        RebateLine: Record "CG X140 Rebate Line";
    begin
        RebateLine.Init();
        RebateLine."Document No." := DocumentNo;
        RebateLine."Line No." := LineNo;
        RebateLine."Item Description" := ItemDescription;
        RebateLine."Allocation Weight" := LineWeight;
        RebateLine.Insert();
    end;

    local procedure X140_SeedLineWithSentinel(DocumentNo: Code[20]; LineNo: Integer; LineWeight: Decimal; SentinelAmount: Decimal)
    var
        RebateLine: Record "CG X140 Rebate Line";
    begin
        RebateLine.Init();
        RebateLine."Document No." := DocumentNo;
        RebateLine."Line No." := LineNo;
        RebateLine."Allocation Weight" := LineWeight;
        RebateLine."Rebate Amount" := SentinelAmount;
        RebateLine.Insert();
    end;

    local procedure X140_GetLineAmount(DocumentNo: Code[20]; LineNo: Integer): Decimal
    var
        RebateLine: Record "CG X140 Rebate Line";
    begin
        RebateLine.Get(DocumentNo, LineNo);
        exit(RebateLine."Rebate Amount");
    end;

    // Independently reconstructs the allocation every correct implementation
    // must produce: floor everyone's exact proportional share to the cent,
    // then hand out whatever the floors left on the table one cent at a time
    // to the lines closest to rounding up, tie-broken by the lower line
    // number. A zero-weight line's remainder is always exactly zero, so it
    // never competes for a leftover cent. This mirrors the allocator's own
    // fix - it is the definition of "correct" this oracle grades against,
    // not a re-implementation that happens to agree with one particular
    // solution.
    local procedure X140_ComputeExpectedShares(Weight: array[10] of Decimal; LineNo: array[10] of Integer; LineCount: Integer; TotalAmount: Decimal; var ExpectedShare: array[10] of Decimal)
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
        for i := 1 to LineCount do
            WeightSum += Weight[i];

        FloorSum := 0;
        for i := 1 to LineCount do begin
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
            for i := 1 to LineCount do
                if (Weight[i] <> 0) and (not Awarded[i]) then
                    // AL's "or" does not short-circuit, so evaluating
                    // Remainder[WinnerIndex] in the same condition as
                    // "WinnerIndex = 0" indexes Remainder[0] on the first
                    // candidate - guard it with a nested if instead.
                    if WinnerIndex = 0 then
                        WinnerIndex := i
                    else
                        if (Remainder[i] > Remainder[WinnerIndex]) or
                           ((Remainder[i] = Remainder[WinnerIndex]) and (LineNo[i] < LineNo[WinnerIndex]))
                        then
                            WinnerIndex := i;
            ExpectedShare[WinnerIndex] += 0.01;
            Awarded[WinnerIndex] := true;
            RemainingResidual -= 0.01;
        end;
    end;

    [Test]
    procedure X140_SingleNonzeroWeightLineGetsTheEntireTotal()
    var
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        X140_ClearAllData();
        X140_SeedHeader('SL01', 123.45);
        X140_SeedLine('SL01', 1, 'Widget', 7.5);

        Allocator.AllocateRebate('SL01');

        Assert.AreEqual(123.45, X140_GetLineAmount('SL01', 1), 'Expected a document with a single line to allocate its entire total to that line');
    end;

    [Test]
    procedure X140_TwoEvenlyWeightedLinesSplitCleanlyAndLeaveAnotherDocumentUntouched()
    var
        RebateHeader: Record "CG X140 Rebate Header";
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        X140_ClearAllData();
        X140_SeedHeader('EV01', 10.00);
        X140_SeedLine('EV01', 1, 'Widget A', 1);
        X140_SeedLine('EV01', 2, 'Widget B', 1);

        // A second, unrelated document is seeded with its own nonzero
        // sentinel amounts and left alone - allocating EV01 must not
        // touch it.
        X140_SeedHeader('EV02', 250.00);
        X140_SeedLineWithSentinel('EV02', 1, 1, 111.11);
        X140_SeedLineWithSentinel('EV02', 2, 1, 222.22);

        Allocator.AllocateRebate('EV01');

        Assert.AreEqual(5.00, X140_GetLineAmount('EV01', 1), 'Expected an even two-line split to allocate exactly half the total to each line');
        Assert.AreEqual(5.00, X140_GetLineAmount('EV01', 2), 'Expected an even two-line split to allocate exactly half the total to each line');
        Assert.AreEqual(10.00, Allocator.GetAllocatedTotal('EV01'), 'Expected the reconciliation total to equal the header total after allocating');

        RebateHeader.Get('EV02');
        Assert.IsFalse(RebateHeader.Allocated, 'Expected an untouched document to stay unallocated');
        Assert.AreEqual(111.11, X140_GetLineAmount('EV02', 1), 'Expected another document''s line amount to be left untouched by allocating a different document');
        Assert.AreEqual(222.22, X140_GetLineAmount('EV02', 2), 'Expected another document''s line amount to be left untouched by allocating a different document');
        // EV02's own lines (333.33) do not reconcile with its own header
        // total (250.00) by design - it was never allocated. Pinning the
        // reconciliation total against the lines' own sum here, not the
        // header total, catches a GetAllocatedTotal that just echoes the
        // header field instead of actually reading the lines.
        Assert.AreEqual(333.33, Allocator.GetAllocatedTotal('EV02'), 'Expected the reconciliation total to reflect the document''s own recorded line amounts');
    end;

    [Test]
    procedure X140_AZeroWeightLineAlwaysReceivesExactlyZero()
    var
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        // Weights chosen so every nonzero-weight line's exact share has a
        // distinct rounding remainder (no ties), so this fixture pins an
        // outcome that does not depend on any particular tie-break policy.
        X140_ClearAllData();
        X140_SeedHeader('ZL01', 77.77);
        X140_SeedLine('ZL01', 1, 'Item P', 2.3);
        X140_SeedLine('ZL01', 2, 'Item Q', 5.7);
        X140_SeedLine('ZL01', 3, 'Item R', 3.1);
        X140_SeedLine('ZL01', 4, 'Item S', 1.9);
        X140_SeedLine('ZL01', 5, 'Sample T (FOC)', 0);

        Allocator.AllocateRebate('ZL01');

        Assert.AreEqual(13.76, X140_GetLineAmount('ZL01', 1), 'Expected a weighted line''s allocated amount to depend only on the document''s weights and total');
        Assert.AreEqual(34.10, X140_GetLineAmount('ZL01', 2), 'Expected a weighted line''s allocated amount to depend only on the document''s weights and total');
        Assert.AreEqual(18.54, X140_GetLineAmount('ZL01', 3), 'Expected a weighted line''s allocated amount to depend only on the document''s weights and total');
        Assert.AreEqual(11.37, X140_GetLineAmount('ZL01', 4), 'Expected a weighted line''s allocated amount to depend only on the document''s weights and total');
        Assert.AreEqual(0.00, X140_GetLineAmount('ZL01', 5), 'Expected a line with no allocation weight to receive exactly zero');
        Assert.AreEqual(77.77, Allocator.GetAllocatedTotal('ZL01'), 'Expected the recorded amounts to sum to exactly the document total');
    end;

    [Test]
    procedure X140_ReorderingTheSameLinesNeverChangesTheirRebateAmount()
    var
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        X140_ClearAllData();

        // Document PM01: lines entered P, Q, R, S.
        X140_SeedHeader('PM01', 77.77);
        X140_SeedLine('PM01', 1, 'Item P', 2.3);
        X140_SeedLine('PM01', 2, 'Item Q', 5.7);
        X140_SeedLine('PM01', 3, 'Item R', 3.1);
        X140_SeedLine('PM01', 4, 'Item S', 1.9);

        // Document PM02: the exact same four items, same weights, same
        // total - only Item R and Item S swap which line number they
        // were entered on.
        X140_SeedHeader('PM02', 77.77);
        X140_SeedLine('PM02', 1, 'Item P', 2.3);
        X140_SeedLine('PM02', 2, 'Item Q', 5.7);
        X140_SeedLine('PM02', 3, 'Item S', 1.9);
        X140_SeedLine('PM02', 4, 'Item R', 3.1);

        Allocator.AllocateRebate('PM01');
        Allocator.AllocateRebate('PM02');

        // Item P and Item Q are entered in the same position on both
        // documents, so their assertions alone already pin an unambiguous
        // per-item split for this set of weights and total.
        Assert.AreEqual(13.76, X140_GetLineAmount('PM01', 1), 'Expected Item P''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(34.10, X140_GetLineAmount('PM01', 2), 'Expected Item Q''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(18.54, X140_GetLineAmount('PM01', 3), 'Expected Item R''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(11.37, X140_GetLineAmount('PM01', 4), 'Expected Item S''s allocated amount to depend only on the document''s weights and total, never on line order');

        Assert.AreEqual(13.76, X140_GetLineAmount('PM02', 1), 'Expected Item P''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(34.10, X140_GetLineAmount('PM02', 2), 'Expected Item Q''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(11.37, X140_GetLineAmount('PM02', 3), 'Expected Item S''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(18.54, X140_GetLineAmount('PM02', 4), 'Expected Item R''s allocated amount to depend only on the document''s weights and total, never on line order');

        // Item R and Item S get the same amount no matter which line
        // number they were entered on - the split must not depend on the
        // order the lines were imported in.
        Assert.AreEqual(X140_GetLineAmount('PM01', 3), X140_GetLineAmount('PM02', 4), 'Expected Item R to receive the same rebate amount whichever line number it was entered on');
        Assert.AreEqual(X140_GetLineAmount('PM01', 4), X140_GetLineAmount('PM02', 3), 'Expected Item S to receive the same rebate amount whichever line number it was entered on');

        Assert.AreEqual(77.77, Allocator.GetAllocatedTotal('PM01'), 'Expected the recorded amounts to sum to exactly the document total');
        Assert.AreEqual(77.77, Allocator.GetAllocatedTotal('PM02'), 'Expected the recorded amounts to sum to exactly the document total');
    end;

    [Test]
    procedure X140_ALineWithNoWeightAtAllOnTheWholeDocumentIsLeftUnallocated()
    var
        RebateHeader: Record "CG X140 Rebate Header";
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        X140_ClearAllData();
        X140_SeedHeader('NW01', 50.00);
        X140_SeedLineWithSentinel('NW01', 1, 0, 555.55);
        X140_SeedLineWithSentinel('NW01', 2, 0, 444.44);

        Allocator.AllocateRebate('NW01');

        RebateHeader.Get('NW01');
        Assert.IsFalse(RebateHeader.Allocated, 'Expected a document with no weight on any line to be left unallocated');
        Assert.AreEqual(555.55, X140_GetLineAmount('NW01', 1), 'Expected a line''s existing amount to be left untouched when the document has no weight to allocate');
        Assert.AreEqual(444.44, X140_GetLineAmount('NW01', 2), 'Expected a line''s existing amount to be left untouched when the document has no weight to allocate');
    end;

    [Test]
    procedure X140_SuccessfulAllocationMarksTheDocumentAllocated()
    var
        RebateHeader: Record "CG X140 Rebate Header";
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        X140_ClearAllData();
        X140_SeedHeader('MK01', 40.00);
        X140_SeedLine('MK01', 1, 'Widget A', 1);
        X140_SeedLine('MK01', 2, 'Widget B', 1);

        Allocator.AllocateRebate('MK01');

        RebateHeader.Get('MK01');
        Assert.IsTrue(RebateHeader.Allocated, 'Expected a document with at least one weighted line to be marked allocated');
    end;

    [Test]
    procedure X140_DeterministicSweepMatchesTheReferenceAllocationAcrossManyPartitions()
    var
        Allocator: Codeunit "CG X140 Rebate Allocator";
        Any: Codeunit Any;
        LineNo: array[10] of Integer;
        Weight: array[10] of Decimal;
        ExpectedShare: array[10] of Decimal;
        DocumentNo: Code[20];
        TotalAmount: Decimal;
        SumOfAmounts: Decimal;
        LineCount: Integer;
        Partition: Integer;
        i: Integer;
    begin
        Any.SetSeed(140);

        for Partition := 1 to 8 do begin
            X140_ClearAllData();
            DocumentNo := 'SW' + Format(Partition);
            LineCount := Any.IntegerInRange(3, 9);
            TotalAmount := Any.IntegerInRange(100, 99999) / 100;
            X140_SeedHeader(DocumentNo, TotalAmount);

            for i := 1 to LineCount do begin
                LineNo[i] := i;
                // Roughly every fourth line on a sweep partition is a
                // free-of-charge sample carrying no allocation weight.
                if i mod 4 = 0 then
                    Weight[i] := 0
                else
                    Weight[i] := Any.DecimalInRange(1, 500, 3);
                X140_SeedLine(DocumentNo, i, StrSubstNo('Sweep line %1', i), Weight[i]);
            end;

            Allocator.AllocateRebate(DocumentNo);
            X140_ComputeExpectedShares(Weight, LineNo, LineCount, TotalAmount, ExpectedShare);

            SumOfAmounts := 0;
            for i := 1 to LineCount do begin
                Assert.AreEqual(
                  ExpectedShare[i], X140_GetLineAmount(DocumentNo, LineNo[i]),
                  StrSubstNo('Expected line %1 of sweep partition %2 to depend only on that document''s own weights and total', LineNo[i], Partition));
                SumOfAmounts += X140_GetLineAmount(DocumentNo, LineNo[i]);
            end;
            Assert.AreEqual(
              TotalAmount, SumOfAmounts,
              StrSubstNo('Expected the recorded amounts on sweep partition %1 to sum to exactly its total', Partition));
        end;
    end;

    // ==========================================================
    // X151 - donor CG-AL-X151
    // ==========================================================

    local procedure X151_Initialize()
    var
        BlockEntry: Record "CG X151 Block Entry";
        BlockList: Codeunit "CG X151 Block List";
    begin
        BlockEntry.DeleteAll();
        BlockList.Invalidate();
    end;

    [Test]
    procedure X151_BlockingACodeTakesEffectImmediately()
    var
        BlockList: Codeunit "CG X151 Block List";
    begin
        X151_Initialize();

        Assert.IsFalse(BlockList.IsBlocked('ALPHA'), 'A code with no history must not be reported as blocked');

        BlockList.SetBlocked('ALPHA');

        Assert.IsTrue(BlockList.IsBlocked('ALPHA'), 'Blocking a code must be reported immediately');
    end;

    [Test]
    procedure X151_ClearingABlockedCodeMustStopReportingItAsBlocked()
    var
        BlockEntry: Record "CG X151 Block Entry";
        BlockList: Codeunit "CG X151 Block List";
    begin
        X151_Initialize();
        BlockList.SetBlocked('ALPHA');
        Assert.IsTrue(BlockList.IsBlocked('ALPHA'), 'Blocking a code must be reported immediately');

        BlockList.ClearBlocked('ALPHA');

        Assert.IsFalse(BlockList.IsBlocked('ALPHA'),
            'Clearing a code must stop it being reported as blocked, the same way blocking one starts it');

        BlockEntry.Get('ALPHA');
        Assert.IsFalse(BlockEntry.Blocked,
            'A cleared code must show as cleared on the block list itself');
    end;

    [Test]
    procedure X151_ClearingOneCodeLeavesAnotherBlockedCodeUntouched()
    var
        BlockList: Codeunit "CG X151 Block List";
    begin
        X151_Initialize();
        BlockList.SetBlocked('ALPHA');
        BlockList.SetBlocked('BETA');
        Assert.IsTrue(BlockList.IsBlocked('ALPHA'), 'ALPHA must be reported as blocked after being blocked');
        Assert.IsTrue(BlockList.IsBlocked('BETA'), 'BETA must be reported as blocked after being blocked');

        BlockList.ClearBlocked('BETA');

        Assert.IsTrue(BlockList.IsBlocked('ALPHA'), 'Clearing BETA must not change ALPHA''s blocked status');
        Assert.IsFalse(BlockList.IsBlocked('BETA'), 'BETA must stop being reported as blocked once it has been cleared');
    end;

    [Test]
    procedure X151_AChangeMadeOutsideEitherActionDoesNotShowUpOnItsOwn()
    var
        BlockEntry: Record "CG X151 Block Entry";
        BlockList: Codeunit "CG X151 Block List";
    begin
        X151_Initialize();
        BlockEntry.Init();
        BlockEntry."Code" := 'GAMMA';
        BlockEntry.Blocked := false;
        BlockEntry.Insert();

        Assert.IsFalse(BlockList.IsBlocked('GAMMA'),
            'GAMMA must not be reported as blocked before either action has ever run against it');

        BlockEntry.Get('GAMMA');
        BlockEntry.Blocked := true;
        BlockEntry.Modify();

        Assert.IsFalse(BlockList.IsBlocked('GAMMA'),
            'A record edited outside of SetBlocked and ClearBlocked is not expected to change what IsBlocked reports until one of those two actions runs');
    end;

    [Test]
    procedure X151_BlockingAgainAfterClearingTakesEffectImmediately()
    var
        BlockList: Codeunit "CG X151 Block List";
    begin
        X151_Initialize();
        BlockList.SetBlocked('DELTA');
        Assert.IsTrue(BlockList.IsBlocked('DELTA'), 'DELTA must be reported as blocked after being blocked');
        BlockList.ClearBlocked('DELTA');

        BlockList.SetBlocked('DELTA');

        Assert.IsTrue(BlockList.IsBlocked('DELTA'),
            'Blocking DELTA again must be reported immediately, even right after clearing it');
    end;

    [Test]
    procedure X151_ClearingACodeThatWasNeverBlockedLeavesItUnblocked()
    var
        BlockList: Codeunit "CG X151 Block List";
    begin
        X151_Initialize();
        Assert.IsFalse(BlockList.IsBlocked('EPSILON'), 'A code with no history must not be reported as blocked');

        BlockList.ClearBlocked('EPSILON');

        Assert.IsFalse(BlockList.IsBlocked('EPSILON'), 'Clearing a code that was never blocked must leave it unblocked');
    end;
}
