codeunit 89409 "CG-AL-X187 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    // This oracle merges 4 independent modules' test suites into one
    // codeunit. Every test and helper procedure is prefixed with the module
    // it belongs to so identical helper names across the source suites cannot
    // collide. Assembled from already-gated donors; see NOTES.md.

    var
        Assert: Codeunit Assert;
        // Every comparison below is built and asserted purely in memory - no
        // DateTime here is ever written to and read back from a table. A SQL
        // round trip can itself move a stored DateTime by a few milliseconds
        // (measured: up to 4 ms of drift between two round-tripped values),
        // which would be enough to shift a 9 ms boundary case across the
        // 10 ms line and make this oracle flaky.
        // The default test isolation persists writes between test methods
        // (measured 2026-08-20, SOAP runner), so every test clears both tables
        // before seeding its own rows.
        // (project convention, SOAP runner), so every test clears both tables
        LedgerMgt: Codeunit "CG X163 Ledger Mgt";
        GroupTotals: Codeunit "CG X163 Group Totals";
        // Companies are enumerated at runtime, never hardcoded, and every test
        // that touches the other company deletes what it seeded there BEFORE
        // asserting anything, then Commit()s that delete - so the cleanup is
        // durable even if a later assertion in the same test fails and raises
        // an error. A defensive clear also runs at the start of every
        // cross-company test in case a still-earlier run was aborted before it
        // could self-heal.

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
    // X104 - donor CG-AL-X104
    // ==========================================================

    local procedure X104_SeedList(ListCode: Code[20]; Description: Text[100]; LineCount: Integer)
    var
        List: Record "CG X104 Price List";
    begin
        List.Init();
        List.Code := ListCode;
        List.Description := CopyStr(Description, 1, MaxStrLen(List.Description));
        List."Line Count" := LineCount;
        List.Insert();
    end;

    local procedure X104_SeedLine(ListCode: Code[20]; LineNo: Integer; ItemNo: Code[20]; UnitPrice: Decimal)
    var
        Line: Record "CG X104 Price List Line";
    begin
        Line.Init();
        Line."List Code" := ListCode;
        Line."Line No." := LineNo;
        Line."Item No." := ItemNo;
        Line."Unit Price" := UnitPrice;
        Line.Insert();
    end;

    local procedure X104_LineCountFor(ListCode: Code[20]): Integer
    var
        Line: Record "CG X104 Price List Line";
    begin
        Line.SetRange("List Code", ListCode);
        exit(Line.Count());
    end;

    local procedure X104_FindLineByItem(ListCode: Code[20]; ItemNo: Code[20]; var Line: Record "CG X104 Price List Line"): Boolean
    begin
        Line.SetRange("List Code", ListCode);
        Line.SetRange("Item No.", ItemNo);
        exit(Line.FindFirst());
    end;

    local procedure X104_HappyPayload(): Text
    begin
        exit('{"items":[{"itemNo":"ITEM-A","unitPrice":12.5},{"itemNo":"ITEM-B","unitPrice":7.25},{"itemNo":"ITEM-C","unitPrice":3}]}');
    end;

    local procedure X104_EmptyItemsPayload(): Text
    begin
        exit('{"items":[]}');
    end;

    local procedure X104_PartiallyValidPayload(): Text
    begin
        exit('{"items":[{"itemNo":"FEED-A","unitPrice":1},{"itemNo":"FEED-B","unitPrice":2},{"itemNo":"FEED-BAD"}]}');
    end;

    local procedure X104_SingleItemPayload(): Text
    begin
        exit('{"items":[{"itemNo":"ITEM-SOLO","unitPrice":42}]}');
    end;

    [Test]
    procedure X104_HappyPathReplacesAllLines()
    var
        List: Record "CG X104 Price List";
        Line: Record "CG X104 Price List Line";
        NewLine: Record "CG X104 Price List Line";
        Sync: Codeunit "CG X104 Price Sync";
    begin
        List.DeleteAll();
        Line.DeleteAll();
        X104_SeedList('P1', 'Spring catalog', 1);
        X104_SeedLine('P1', 10000, 'OLD-ITEM', 1.11);

        Sync.SyncPriceList('P1', X104_HappyPayload());

        List.Get('P1');
        Assert.AreEqual(3, List."Line Count", 'The cached line count must match the number of items the feed sent');
        Assert.AreEqual(3, X104_LineCountFor('P1'), 'The list must hold exactly the lines the feed sent');
        Assert.IsFalse(X104_FindLineByItem('P1', 'OLD-ITEM', NewLine), 'A line the feed no longer lists must not survive the sync');
        Assert.IsTrue(X104_FindLineByItem('P1', 'ITEM-A', NewLine), 'ITEM-A from the feed must be present');
        Assert.AreEqual(12.5, NewLine."Unit Price", 'ITEM-A must carry the feed''s price');
        Assert.IsTrue(X104_FindLineByItem('P1', 'ITEM-B', NewLine), 'ITEM-B from the feed must be present');
        Assert.AreEqual(7.25, NewLine."Unit Price", 'ITEM-B must carry the feed''s price');
        Assert.IsTrue(X104_FindLineByItem('P1', 'ITEM-C', NewLine), 'ITEM-C from the feed must be present');
        Assert.AreEqual(3, NewLine."Unit Price", 'ITEM-C must carry the feed''s price');
    end;

    [Test]
    procedure X104_AResponseWithNoItemsIsRejectedAndPricesSurvive()
    var
        List: Record "CG X104 Price List";
        Line: Record "CG X104 Price List Line";
        Sync: Codeunit "CG X104 Price Sync";
    begin
        List.DeleteAll();
        Line.DeleteAll();
        X104_SeedList('P1', 'Spring catalog', 2);
        X104_SeedLine('P1', 10000, 'ITEM-A', 5.55);
        X104_SeedLine('P1', 20000, 'ITEM-B', 7.77);
        Commit();

        asserterror Sync.SyncPriceList('P1', X104_EmptyItemsPayload());

        List.Get('P1');
        Assert.AreEqual(2, List."Line Count", 'A feed response listing no items must not erase the cached line count');
        Assert.AreEqual(2, X104_LineCountFor('P1'), 'A feed response listing no items must not erase the existing lines');
        Assert.IsTrue(X104_FindLineByItem('P1', 'ITEM-A', Line), 'ITEM-A must survive a response listing no items');
        Assert.AreEqual(5.55, Line."Unit Price", 'ITEM-A''s price must be unchanged');
        Assert.IsTrue(X104_FindLineByItem('P1', 'ITEM-B', Line), 'ITEM-B must survive a response listing no items');
        Assert.AreEqual(7.77, Line."Unit Price", 'ITEM-B''s price must be unchanged');
    end;

    [Test]
    procedure X104_APartiallyValidResponseReplacesNothing()
    var
        List: Record "CG X104 Price List";
        Line: Record "CG X104 Price List Line";
        Sync: Codeunit "CG X104 Price Sync";
    begin
        List.DeleteAll();
        Line.DeleteAll();
        X104_SeedList('P1', 'Spring catalog', 2);
        X104_SeedLine('P1', 10000, 'ITEM-A', 5.55);
        X104_SeedLine('P1', 20000, 'ITEM-B', 7.77);
        Commit();

        asserterror Sync.SyncPriceList('P1', X104_PartiallyValidPayload());

        List.Get('P1');
        Assert.AreEqual(2, List."Line Count", 'A response that fails partway through must not leave a partial replacement');
        Assert.AreEqual(2, X104_LineCountFor('P1'), 'A response that fails partway through must not leave a partial replacement');
        Assert.IsTrue(X104_FindLineByItem('P1', 'ITEM-A', Line), 'The original item must survive a response that fails partway through');
        Assert.AreEqual(5.55, Line."Unit Price", 'The original item''s price must be unchanged by a response that fails partway through');
        Assert.IsFalse(X104_FindLineByItem('P1', 'FEED-A', Line), 'No item from a response that fails partway through may appear');
        Assert.IsFalse(X104_FindLineByItem('P1', 'FEED-B', Line), 'No item from a response that fails partway through may appear');
    end;

    [Test]
    procedure X104_SingleItemResponseStillReplacesTheList()
    var
        List: Record "CG X104 Price List";
        Line: Record "CG X104 Price List Line";
        Sync: Codeunit "CG X104 Price Sync";
    begin
        List.DeleteAll();
        Line.DeleteAll();
        X104_SeedList('P1', 'Spring catalog', 2);
        X104_SeedLine('P1', 10000, 'ITEM-A', 5.55);
        X104_SeedLine('P1', 20000, 'ITEM-B', 7.77);

        Sync.SyncPriceList('P1', X104_SingleItemPayload());

        List.Get('P1');
        Assert.AreEqual(1, List."Line Count", 'A single-item response must still replace the list, unlike one listing no items');
        Assert.AreEqual(1, X104_LineCountFor('P1'), 'A single-item response must still replace the list, unlike one listing no items');
        Assert.IsTrue(X104_FindLineByItem('P1', 'ITEM-SOLO', Line), 'The single item from the response must be present');
        Assert.AreEqual(42, Line."Unit Price", 'The single item must carry the response''s price');
        Assert.IsFalse(X104_FindLineByItem('P1', 'ITEM-A', Line), 'A single-item response must still remove lines it no longer lists');
    end;

    [Test]
    procedure X104_ASecondPriceListIsUntouchedByAScopedSync()
    var
        List: Record "CG X104 Price List";
        Line: Record "CG X104 Price List Line";
        Sync: Codeunit "CG X104 Price Sync";
    begin
        List.DeleteAll();
        Line.DeleteAll();
        X104_SeedList('P1', 'Spring catalog', 1);
        X104_SeedLine('P1', 10000, 'OLD-ITEM', 1.11);
        X104_SeedList('P2', 'Autumn catalog', 1);
        X104_SeedLine('P2', 10000, 'OTHER-ITEM', 9.99);

        Sync.SyncPriceList('P1', X104_HappyPayload());

        List.Get('P2');
        Assert.AreEqual(1, List."Line Count", 'Syncing one price list must not touch another list''s cached count');
        Assert.AreEqual(1, X104_LineCountFor('P2'), 'Syncing one price list must not touch another list''s lines');
        Assert.IsTrue(X104_FindLineByItem('P2', 'OTHER-ITEM', Line), 'The other list''s line must survive');
        Assert.AreEqual(9.99, Line."Unit Price", 'The other list''s price must be unchanged');
    end;

    [Test]
    procedure X104_SyncingAnUnknownPriceListIsRejected()
    var
        List: Record "CG X104 Price List";
        Line: Record "CG X104 Price List Line";
        Sync: Codeunit "CG X104 Price Sync";
    begin
        List.DeleteAll();
        Line.DeleteAll();

        asserterror Sync.SyncPriceList('NOPE', '');

        Assert.AreEqual(0, X104_LineCountFor('NOPE'), 'A sync against an unknown price list must not create any lines');
    end;

    // ==========================================================
    // X163 - donor CG-AL-X163
    // ==========================================================

    local procedure X163_GetOtherCompanyName(): Text[30]
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

    local procedure X163_ClearHomeLedger()
    var
        Ledger: Record "CG X163 Branch Ledger";
    begin
        Ledger.DeleteAll();
    end;

    local procedure X163_ClearOtherLedger(OtherName: Text[30])
    var
        Ledger: Record "CG X163 Branch Ledger";
    begin
        Ledger.ChangeCompany(OtherName);
        Ledger.DeleteAll();
    end;

    local procedure X163_ClearQueryLog()
    var
        QueryLog: Record "CG X163 Query Log";
    begin
        QueryLog.DeleteAll();
    end;

    local procedure X163_ClearBoth(OtherName: Text[30])
    begin
        X163_ClearHomeLedger();
        X163_ClearOtherLedger(OtherName);
        X163_ClearQueryLog();
        Commit();
    end;

    [Test]
    procedure X163_TheGroupTotalCombinesEachBranchsOwnAmountForAnAccount()
    var
        OtherName: Text[30];
        Total: Decimal;
    begin
        OtherName := X163_GetOtherCompanyName();
        X163_ClearBoth(OtherName);

        LedgerMgt.SetAmount(CompanyName(), 'ACCT-A', 40.5);
        LedgerMgt.SetAmount(OtherName, 'ACCT-A', 27.25);

        Total := GroupTotals.GetGroupTotal('ACCT-A');

        X163_ClearBoth(OtherName);

        Assert.AreEqual(67.75, Total,
            'Expected the group total for the account to combine every branch''s own configured amount for it');
    end;

    [Test]
    procedure X163_AnAccountHeldOnlyByTheOtherBranchStillContributesItsFullAmount()
    var
        OtherName: Text[30];
        Total: Decimal;
    begin
        OtherName := X163_GetOtherCompanyName();
        X163_ClearBoth(OtherName);

        LedgerMgt.SetAmount(OtherName, 'ACCT-B', 18.75);

        Total := GroupTotals.GetGroupTotal('ACCT-B');

        X163_ClearBoth(OtherName);

        Assert.AreEqual(18.75, Total,
            'Expected an account configured only on the other branch to still contribute its full amount to the group total');
    end;

    [Test]
    procedure X163_AnAccountHeldOnlyByTheHomeBranchStillContributesItsFullAmount()
    var
        OtherName: Text[30];
        Total: Decimal;
    begin
        OtherName := X163_GetOtherCompanyName();
        X163_ClearBoth(OtherName);

        LedgerMgt.SetAmount(CompanyName(), 'ACCT-C', 30.0);

        Total := GroupTotals.GetGroupTotal('ACCT-C');

        X163_ClearBoth(OtherName);

        Assert.AreEqual(30.0, Total,
            'Expected an account configured only on the home branch to still contribute its full amount to the group total');
    end;

    [Test]
    procedure X163_TheGroupTotalForOneAccountIsNotContaminatedByAnotherAccountInTheSameBranch()
    var
        OtherName: Text[30];
        Total: Decimal;
    begin
        OtherName := X163_GetOtherCompanyName();
        X163_ClearBoth(OtherName);

        LedgerMgt.SetAmount(CompanyName(), 'ACCT-P', 12.0);
        LedgerMgt.SetAmount(CompanyName(), 'ACCT-Q', 999.0);

        Total := GroupTotals.GetGroupTotal('ACCT-P');

        X163_ClearBoth(OtherName);

        Assert.AreEqual(12.0, Total,
            'Expected the group total for one account to be unaffected by a different account configured in the same branch');
    end;

    [Test]
    procedure X163_AnAccountWithNoConfiguredAmountAnywhereTotalsToZero()
    var
        OtherName: Text[30];
        Total: Decimal;
    begin
        OtherName := X163_GetOtherCompanyName();
        X163_ClearBoth(OtherName);

        Total := GroupTotals.GetGroupTotal('ACCT-Z');

        X163_ClearBoth(OtherName);

        Assert.AreEqual(0.0, Total,
            'Expected an account with no configured amount on any branch to total to zero');
    end;

    [Test]
    procedure X163_EachBranchsConfiguredAmountIsStoredOnItsOwnRecordUnaffectedByTheOtherBranch()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        HomeLedger: Record "CG X163 Branch Ledger";
        OtherLedger: Record "CG X163 Branch Ledger";
        HomeDirect: Decimal;
        OtherDirect: Decimal;
    begin
        OtherName := X163_GetOtherCompanyName();
        HomeName := CompanyName();
        X163_ClearBoth(OtherName);

        LedgerMgt.SetAmount(HomeName, 'ACCT-M', 17.0);
        LedgerMgt.SetAmount(OtherName, 'ACCT-M', 9.0);

        HomeDirect := LedgerMgt.GetAmountDirect(HomeName, 'ACCT-M');
        OtherDirect := LedgerMgt.GetAmountDirect(OtherName, 'ACCT-M');

        HomeLedger.Get('ACCT-M');
        OtherLedger.ChangeCompany(OtherName);
        OtherLedger.Get('ACCT-M');

        X163_ClearBoth(OtherName);

        Assert.AreEqual(17.0, HomeDirect,
            'Expected the home branch''s configured amount to be unaffected by the other branch''s configured amount for the same account');
        Assert.AreEqual(9.0, OtherDirect,
            'Expected the other branch''s configured amount to reflect what it configured for itself');
        Assert.AreEqual(17.0, HomeLedger.Amount,
            'Expected the home branch''s amount to be persisted with its own value on its own record');
        Assert.AreEqual(9.0, OtherLedger.Amount,
            'Expected the other branch''s amount to be persisted with its own value on its own record');
    end;

    [Test]
    procedure X163_ABranchWithNoConfiguredAmountForAGivenAccountIsTreatedAsZero()
    var
        OtherName: Text[30];
        Direct: Decimal;
    begin
        OtherName := X163_GetOtherCompanyName();
        X163_ClearBoth(OtherName);

        Direct := LedgerMgt.GetAmountDirect(CompanyName(), 'ACCT-N');

        Assert.AreEqual(0.0, Direct,
            'Expected no configured amount for an account on a branch to read as zero rather than an arbitrary leftover value');
    end;
}
