codeunit 89471 "CG-AL-X249 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    // This oracle merges 5 independent modules' test suites into one
    // codeunit. Every test and helper procedure is prefixed with the module
    // it belongs to so identical helper names across the source suites cannot
    // collide. Assembled from already-gated donors; see NOTES.md.

    var
        Assert: Codeunit Assert;
        // The default test isolation persists writes between test methods, so
        // every test clears the table before seeding its own rows.
        // The default test isolation persists writes between test methods
        // (measured 2026-08-20, SOAP runner), so every record-driven test
        // clears the table before seeding its own rows. Untouched claims are
        // seeded with a nonzero sentinel amount so "untouched" and
        // "recalculated to zero" stay distinguishable.
        // (measured 2026-08-20, SOAP runner), so every test clears both tables
        // before seeding its own rows.
        // (measured, SOAP runner), so every test clears the table before
        // seeding its own rows.
        // every test clears its own tables before seeding its own rows.

    // ==========================================================
    // X106 - donor CG-AL-X106
    // ==========================================================

    local procedure X106_Seed(No: Code[20]; BaseTotal: Integer)
    var
        Doc: Record "CG X106 Document";
    begin
        Doc.Init();
        Doc."No." := No;
        Doc."Base Total" := BaseTotal;
        Doc.Insert();
    end;

    [Test]
    procedure X106_ArchivingAQualifyingDocumentKeepsTheEnrichmentNoteAndTheArchiveTag()
    var
        Doc: Record "CG X106 Document";
        ArchiveMgt: Codeunit "CG X106 Archive Mgt";
    begin
        Doc.DeleteAll();
        X106_Seed('DOC001', 100);

        ArchiveMgt.ArchiveDocument('DOC001');

        Doc.Get('DOC001');
        Assert.AreEqual('NOTE-100', Doc."Enrichment Note", 'The archived document must keep the note describing its total');
        Assert.AreEqual('PRIORITY', Doc."Archive Tag", 'A document at the qualifying total must be tagged as priority');
        Assert.AreEqual(100, Doc."Base Total", 'Archiving must not change the document''s recorded total');
    end;

    [Test]
    procedure X106_ArchivingABelowThresholdDocumentKeepsTheEnrichmentNoteAndTheArchiveTag()
    var
        Doc: Record "CG X106 Document";
        ArchiveMgt: Codeunit "CG X106 Archive Mgt";
    begin
        Doc.DeleteAll();
        X106_Seed('DOC002', 99);

        ArchiveMgt.ArchiveDocument('DOC002');

        Doc.Get('DOC002');
        Assert.AreEqual('NOTE-99', Doc."Enrichment Note", 'The archived document must keep the note describing its total');
        Assert.AreEqual('STANDARD', Doc."Archive Tag", 'A document below the qualifying total must be tagged as standard');
    end;

    [Test]
    procedure X106_ArchivingOneDocumentDoesNotChangeAnother()
    var
        Target: Record "CG X106 Document";
        Other: Record "CG X106 Document";
        ArchiveMgt: Codeunit "CG X106 Archive Mgt";
    begin
        Target.DeleteAll();
        Target.Init();
        Target."No." := 'TARGET';
        Target."Base Total" := 250;
        Target.Insert();

        Other.Init();
        Other."No." := 'OTHER';
        Other."Base Total" := 555;
        Other."Enrichment Note" := 'UNTOUCHED-NOTE';
        Other."Archive Tag" := 'UNTOUCHED-TAG';
        Other.Insert();

        ArchiveMgt.ArchiveDocument('TARGET');

        Other.Get('OTHER');
        Assert.AreEqual(555, Other."Base Total", 'An unrelated document''s total must not change');
        Assert.AreEqual('UNTOUCHED-NOTE', Other."Enrichment Note", 'An unrelated document''s enrichment note must not change');
        Assert.AreEqual('UNTOUCHED-TAG', Other."Archive Tag", 'An unrelated document''s archive tag must not change');
    end;

    [Test]
    procedure X106_RefreshingTheArchiveTagAloneLeavesTheEnrichmentNoteUntouched()
    var
        Doc: Record "CG X106 Document";
        ArchiveMgt: Codeunit "CG X106 Archive Mgt";
    begin
        Doc.DeleteAll();
        Doc.Init();
        Doc."No." := 'DOC003';
        Doc."Base Total" := 400;
        Doc."Enrichment Note" := 'PRESEEDED-NOTE';
        Doc.Insert();

        ArchiveMgt.RefreshArchiveTag('DOC003');

        Doc.Get('DOC003');
        Assert.AreEqual('PRIORITY', Doc."Archive Tag", 'A document at or above the qualifying total must be tagged as priority');
        Assert.AreEqual('PRESEEDED-NOTE', Doc."Enrichment Note", 'Refreshing the archive tag alone must not touch the enrichment note');
    end;

    [Test]
    procedure X106_RefreshingTheArchiveTagAloneHandlesTheStandardCase()
    var
        Doc: Record "CG X106 Document";
        ArchiveMgt: Codeunit "CG X106 Archive Mgt";
    begin
        Doc.DeleteAll();
        Doc.Init();
        Doc."No." := 'DOC004';
        Doc."Base Total" := 20;
        Doc."Enrichment Note" := 'PRESEEDED-NOTE-2';
        Doc.Insert();

        ArchiveMgt.RefreshArchiveTag('DOC004');

        Doc.Get('DOC004');
        Assert.AreEqual('STANDARD', Doc."Archive Tag", 'A document below the qualifying total must be tagged as standard');
        Assert.AreEqual('PRESEEDED-NOTE-2', Doc."Enrichment Note", 'Refreshing the archive tag alone must not touch the enrichment note');
    end;

    // ==========================================================
    // X114 - donor CG-AL-X114
    // ==========================================================

    local procedure X114_Seed(EntryNo: Integer; AwayMinutes: Integer; InitialAmount: Integer)
    var
        Claim: Record "CG X114 Travel Claim";
    begin
        Claim.Init();
        Claim."Entry No." := EntryNo;
        Claim."Away Minutes" := AwayMinutes;
        Claim."Allowance Amount" := InitialAmount;
        Claim.Insert();
    end;

    local procedure X114_Recalc(EntryNo: Integer)
    var
        Claim: Record "CG X114 Travel Claim";
        AllowanceCalc: Codeunit "CG X114 Allowance Calc";
    begin
        Claim.Get(EntryNo);
        AllowanceCalc.RecalculateClaim(Claim);
    end;

    local procedure X114_AmountOf(EntryNo: Integer): Integer
    var
        Claim: Record "CG X114 Travel Claim";
    begin
        Claim.Get(EntryNo);
        exit(Claim."Allowance Amount");
    end;

    // Independent reference ladder the sweeps below grade against -
    // deliberately not shared with the application code under test.
    local procedure X114_ExpectedAmountFor(AwayMinutes: Integer): Integer
    begin
        if AwayMinutes >= 720 then
            exit(500);
        if AwayMinutes > 360 then
            exit(250);
        exit(0);
    end;

    [Test]
    procedure X114_CalculatedAmountsMatchTheConfirmedBandNearSixHours()
    var
        AllowanceCalc: Codeunit "CG X114 Allowance Calc";
        AwayMinutes: Integer;
    begin
        for AwayMinutes := 350 to 370 do
            Assert.AreEqual(
              X114_ExpectedAmountFor(AwayMinutes),
              AllowanceCalc.CalculateAllowance(AwayMinutes),
              'The allowance amount must match the confirmed band for every away-time in this range');
    end;

    [Test]
    procedure X114_CalculatedAmountsMatchTheConfirmedBandNearTwelveHours()
    var
        AllowanceCalc: Codeunit "CG X114 Allowance Calc";
        AwayMinutes: Integer;
    begin
        for AwayMinutes := 710 to 730 do
            Assert.AreEqual(
              X114_ExpectedAmountFor(AwayMinutes),
              AllowanceCalc.CalculateAllowance(AwayMinutes),
              'The allowance amount must match the confirmed band for every away-time in this range');
    end;

    [Test]
    procedure X114_TheShortestAndLongestTripsResolveToTheOuterTiers()
    var
        AllowanceCalc: Codeunit "CG X114 Allowance Calc";
    begin
        Assert.AreEqual(0, AllowanceCalc.CalculateAllowance(-30), 'A negative away-time must resolve to no allowance');
        Assert.AreEqual(0, AllowanceCalc.CalculateAllowance(0), 'A zero-minute trip must resolve to no allowance');
        Assert.AreEqual(0, AllowanceCalc.CalculateAllowance(1), 'A 1-minute trip must resolve to no allowance');
        Assert.AreEqual(500, AllowanceCalc.CalculateAllowance(1440), 'A 1440-minute trip must resolve to the full allowance');
    end;

    [Test]
    procedure X114_TheOvertimeBandClassificationStaysCorrect()
    var
        AllowanceCalc: Codeunit "CG X114 Allowance Calc";
    begin
        Assert.AreEqual(0, AllowanceCalc.OvertimeBandOf(200), 'A 200-minute trip must classify into the no-allowance band');
        Assert.AreEqual(1, AllowanceCalc.OvertimeBandOf(500), 'A 500-minute trip must classify into the partial-allowance band');
        Assert.AreEqual(2, AllowanceCalc.OvertimeBandOf(800), 'An 800-minute trip must classify into the full-allowance band');

        // The statistics classification must keep matching the confirmed
        // amount schedule at the same away-times CalculateAllowance is
        // graded on - a rewrite that simplifies away how OvertimeBandOf
        // decides each side of these away-times must not go ungraded.
        Assert.AreEqual(0, AllowanceCalc.OvertimeBandOf(359), 'A 359-minute trip must classify into the no-allowance band');
        Assert.AreEqual(0, AllowanceCalc.OvertimeBandOf(360), 'A 360-minute trip must classify into the no-allowance band');
        Assert.AreEqual(1, AllowanceCalc.OvertimeBandOf(361), 'A 361-minute trip must classify into the partial-allowance band');
        Assert.AreEqual(1, AllowanceCalc.OvertimeBandOf(719), 'A 719-minute trip must classify into the partial-allowance band');
        Assert.AreEqual(2, AllowanceCalc.OvertimeBandOf(720), 'A 720-minute trip must classify into the full-allowance band');
        Assert.AreEqual(2, AllowanceCalc.OvertimeBandOf(721), 'A 721-minute trip must classify into the full-allowance band');
    end;

    [Test]
    procedure X114_RecalculatingAClaimWritesTheConfirmedAmountBackToTheRecord()
    var
        Claim: Record "CG X114 Travel Claim";
    begin
        Claim.DeleteAll();
        X114_Seed(1, 500, 999);

        X114_Recalc(1);

        Assert.AreEqual(250, X114_AmountOf(1), 'Recalculating a claim must store the confirmed allowance amount back onto the claim');
    end;

    [Test]
    procedure X114_RecalculatingOneClaimLeavesOtherClaimsUntouched()
    var
        Claim: Record "CG X114 Travel Claim";
    begin
        Claim.DeleteAll();
        X114_Seed(2, 500, 999);
        X114_Seed(3, 800, 777);

        X114_Recalc(2);

        Assert.AreEqual(250, X114_AmountOf(2), 'The recalculated claim must resolve to the confirmed allowance amount');
        Assert.AreEqual(777, X114_AmountOf(3), 'A claim that was not recalculated must keep its existing allowance amount');
    end;

    [Test]
    procedure X114_RecalculatingTheSameClaimTwiceIsStable()
    var
        Claim: Record "CG X114 Travel Claim";
    begin
        Claim.DeleteAll();
        X114_Seed(4, 500, 0);

        X114_Recalc(4);
        X114_Recalc(4);

        Assert.AreEqual(250, X114_AmountOf(4), 'Recalculating the same claim twice must not change the result');
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
    // X152 - donor CG-AL-X152
    // ==========================================================

    [Test]
    procedure X152_ImportingUniqueSettingsSavesEveryEntry()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P1', 'retries=3;timeout=30;endpoint=https://api.example.com');

        Assert.AreEqual('3', ConfigImporter.GetSetting('P1', 'retries'), 'A plain config with no repeated setting must save every entry.');
        Assert.AreEqual('30', ConfigImporter.GetSetting('P1', 'timeout'), 'A plain config with no repeated setting must save every entry.');
        Assert.AreEqual('https://api.example.com', ConfigImporter.GetSetting('P1', 'endpoint'), 'A plain config with no repeated setting must save every entry.');
    end;

    [Test]
    procedure X152_BlankSegmentsAreSkippedAndAnEmptyValueIsKept()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P2', ';present=set;;flag=;   ;another=data;');

        Setting.SetRange("Profile Code", 'P2');
        Assert.AreEqual(3, Setting.Count(), 'Blank and all-space segments must not produce extra saved settings.');
        Assert.AreEqual('set', ConfigImporter.GetSetting('P2', 'present'), 'A normal entry around blank segments must still save correctly.');
        Assert.IsTrue(ConfigImporter.SettingExists('P2', 'flag'), 'An entry with no value after the equals sign is still a valid setting.');
        Assert.AreEqual('', ConfigImporter.GetSetting('P2', 'flag'), 'An entry with no value after the equals sign must save as an empty value, not be dropped.');
        Assert.AreEqual('data', ConfigImporter.GetSetting('P2', 'another'), 'An entry following blank segments must still save correctly.');
    end;

    [Test]
    procedure X152_ARepeatedSettingAtTheEndOfTheStringKeepsTheLastValue()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P3', 'code=1;code=2;code=3');

        Assert.AreEqual('3', ConfigImporter.GetSetting('P3', 'code'), 'When a setting is listed three times, the last-listed value must be the one that is saved.');
    end;

    [Test]
    procedure X152_ARepeatedSettingKeepsItsOwnLastValueEvenWhenOtherSettingsFollowIt()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P4', 'code=1;code=2;other=9');

        Assert.AreEqual('2', ConfigImporter.GetSetting('P4', 'code'), 'The last-listed value for a repeated setting wins, regardless of where in the string its final occurrence sits relative to other settings.');
        Assert.AreEqual('9', ConfigImporter.GetSetting('P4', 'other'), 'A setting listed after a repeated one must still be saved with its own value.');
    end;

    [Test]
    procedure X152_AnInvalidEntryLeavesThePreviouslySavedSettingsAndSkipsTheRestOfTheFile()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P5', 'keep=100;stable=200');
        Commit();

        asserterror ConfigImporter.ImportConfig('P5', 'keep=999;fresh=555;badline');

        Assert.AreEqual('100', ConfigImporter.GetSetting('P5', 'keep'), 'A file that fails partway through must leave settings from an earlier successful import untouched.');
        Assert.AreEqual('200', ConfigImporter.GetSetting('P5', 'stable'), 'A file that fails partway through must leave settings from an earlier successful import untouched.');
        Assert.IsFalse(ConfigImporter.SettingExists('P5', 'fresh'), 'None of a failed file''s settings may be saved, including ones listed before the point of failure.');
    end;

    [Test]
    procedure X152_ImportingIntoOneProfileLeavesAnotherProfileUntouched()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P6A', 'shared=1');
        ConfigImporter.ImportConfig('P6B', 'shared=99;private=42');

        ConfigImporter.ImportConfig('P6A', 'shared=2;fresh=7');

        Assert.AreEqual('2', ConfigImporter.GetSetting('P6A', 'shared'), 'Re-importing into one profile must update that profile''s own settings.');
        Assert.AreEqual('7', ConfigImporter.GetSetting('P6A', 'fresh'), 'Re-importing into one profile must save new settings for that profile.');
        Assert.AreEqual('99', ConfigImporter.GetSetting('P6B', 'shared'), 'Importing into one profile must not change a same-named setting saved for a different profile.');
        Assert.AreEqual('42', ConfigImporter.GetSetting('P6B', 'private'), 'Importing into one profile must not touch a different profile''s other settings.');
    end;

    [Test]
    procedure X152_GetSettingOnAMissingKeyFails()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P7', 'present=1');

        asserterror ConfigImporter.GetSetting('P7', 'absent');
    end;

    [Test]
    procedure X152_SettingExistsReportsWhetherASettingWasSaved()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P8', 'present=1');

        Assert.IsTrue(ConfigImporter.SettingExists('P8', 'present'), 'A setting that was saved must be reported as existing.');
        Assert.IsFalse(ConfigImporter.SettingExists('P8', 'absent'), 'A setting that was never saved must be reported as not existing.');
        Assert.IsFalse(ConfigImporter.SettingExists('P8Other', 'present'), 'A setting saved for one profile must not be reported as existing under a different profile.');
    end;

    // ==========================================================
    // X157 - donor CG-AL-X157
    // ==========================================================

    local procedure X157_ClearAll()
    var
        CostCenter: Record "CG X157 Cost Center";
        CostEntry: Record "CG X157 Cost Entry";
        StatementLine: Record "CG X157 Statement Line";
    begin
        CostCenter.DeleteAll();
        CostEntry.DeleteAll();
        StatementLine.DeleteAll();
    end;

    local procedure X157_SeedCostCenter(CostCenterCode: Code[20])
    var
        CostCenter: Record "CG X157 Cost Center";
    begin
        CostCenter.Init();
        CostCenter."Code" := CostCenterCode;
        CostCenter.Insert();
    end;

    local procedure X157_SeedEntry(CostCenterCode: Code[20]; PostingDate: Date; Amount: Decimal)
    var
        CostEntry: Record "CG X157 Cost Entry";
    begin
        CostEntry.Init();
        CostEntry."Cost Center Code" := CostCenterCode;
        CostEntry."Posting Date" := PostingDate;
        CostEntry.Amount := Amount;
        CostEntry.Insert();
    end;

    local procedure X157_AssertStatementLine(CostCenterCode: Code[20]; PeriodStart: Date; ExpectedAmount: Decimal; MessagePrefix: Text)
    var
        StatementLine: Record "CG X157 Statement Line";
    begin
        Assert.IsTrue(StatementLine.Get(CostCenterCode, PeriodStart), MessagePrefix + ' - statement row exists');
        Assert.AreEqual(ExpectedAmount, StatementLine.Amount, MessagePrefix + ' - statement row amount');
    end;

    [Test]
    procedure X157_SinglePeriodWindowMatchingAllActivityReportsTheFullTotal()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260120D, 50);

        Result := Statement.GetPeriodAmount('CC1', 20260101D, 20260131D);

        Assert.AreEqual(150, Result, 'A window that covers a cost center''s only activity reports that activity''s full total');
    end;

    [Test]
    procedure X157_BuildStatementForOneCostCenterLeavesAnothersRowsAlone()
    var
        Statement: Codeunit "CG X157 Period Statement";
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedCostCenter('CC2');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC2', 20260115D, 70);

        Statement.BuildStatement('CC1', 20260101D, 20260131D);
        Statement.BuildStatement('CC2', 20260101D, 20260131D);

        X157_AssertStatementLine('CC1', 20260101D, 100, 'Another cost center''s statement rows must survive building this one''s');
        X157_AssertStatementLine('CC2', 20260101D, 70, 'The freshly built cost center''s own row must carry its own amount');
    end;

    [Test]
    procedure X157_StatementSpanningYearEndCarriesEachMonthsOwnFigure()
    var
        Statement: Codeunit "CG X157 Period Statement";
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20261210D, 90);
        X157_SeedEntry('CC1', 20270115D, 35);

        Statement.BuildStatement('CC1', 20261201D, 20270131D);

        X157_AssertStatementLine('CC1', 20261201D, 90, 'The December period of a statement spanning year end carries December''s own figure');
        X157_AssertStatementLine('CC1', 20270101D, 35, 'The January period of a statement spanning year end carries January''s own figure');
    end;

    [Test]
    procedure X157_MidYearWindowReportsOnlyThatMonthsActivity()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260120D, 50);
        X157_SeedEntry('CC1', 20260205D, 30);
        X157_SeedEntry('CC1', 20260225D, 70);
        X157_SeedEntry('CC1', 20260315D, 40);

        Result := Statement.GetPeriodAmount('CC1', 20260201D, 20260228D);

        Assert.AreEqual(100, Result, 'A mid-year window must report only that window''s own activity, not the cost center''s entire history');
    end;

    [Test]
    procedure X157_NonAlignedWindowReportsOnlyActivityWithinItsExactDates()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260120D, 50);
        X157_SeedEntry('CC1', 20260205D, 30);
        X157_SeedEntry('CC1', 20260225D, 70);
        X157_SeedEntry('CC1', 20260315D, 40);

        Result := Statement.GetPeriodAmount('CC1', 20260115D, 20260215D);

        Assert.AreEqual(80, Result, 'A window that does not line up with calendar month boundaries must still report only the activity that actually falls within it');
    end;

    [Test]
    procedure X157_StatementRowsCarryEachPeriodsOwnFigure()
    var
        Statement: Codeunit "CG X157 Period Statement";
        StatementLine: Record "CG X157 Statement Line";
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260120D, 50);
        X157_SeedEntry('CC1', 20260205D, 30);
        X157_SeedEntry('CC1', 20260225D, 70);
        X157_SeedEntry('CC1', 20260315D, 40);

        Statement.BuildStatement('CC1', 20260101D, 20260331D);

        StatementLine.SetRange("Cost Center Code", 'CC1');
        Assert.AreEqual(3, StatementLine.Count(), 'A statement spanning three calendar months produces exactly three rows');
        X157_AssertStatementLine('CC1', 20260101D, 150, 'The first month''s row');
        X157_AssertStatementLine('CC1', 20260201D, 100, 'The second month''s row');
        X157_AssertStatementLine('CC1', 20260301D, 40, 'The third month''s row');
    end;

    [Test]
    procedure X157_WindowWithNoActivityReportsZero()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260205D, 30);
        X157_SeedEntry('CC1', 20260315D, 40);

        Result := Statement.GetPeriodAmount('CC1', 20260401D, 20260430D);

        Assert.AreEqual(0, Result, 'A window with no activity in it must report zero, even though the cost center has activity elsewhere');
    end;

    [Test]
    procedure X157_AnotherCostCentersActivityDoesNotAffectThisOnesFigure()
    var
        Statement: Codeunit "CG X157 Period Statement";
        ResultCC1: Decimal;
        ResultCC2: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedCostCenter('CC2');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC2', 20260110D, 9999);

        ResultCC1 := Statement.GetPeriodAmount('CC1', 20260101D, 20260131D);
        ResultCC2 := Statement.GetPeriodAmount('CC2', 20260101D, 20260131D);

        Assert.AreEqual(100, ResultCC1, 'A cost center''s own figure must not include another cost center''s activity');
        Assert.AreEqual(9999, ResultCC2, 'The other cost center''s own figure must be unaffected by resolving the first one''s figure');
    end;

    [Test]
    procedure X157_ActivityOnTheWindowsFirstAndLastDayIsIncluded()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20251231D, 20);
        X157_SeedEntry('CC1', 20260101D, 100);
        X157_SeedEntry('CC1', 20260131D, 50);
        X157_SeedEntry('CC1', 20260201D, 30);

        Result := Statement.GetPeriodAmount('CC1', 20260101D, 20260131D);

        Assert.AreEqual(150, Result, 'Activity dated exactly on either edge of the window must be included, and activity just outside either edge must be excluded');
    end;

    [Test]
    procedure X157_RebuildingAStatementReplacesThePreviousRows()
    var
        Statement: Codeunit "CG X157 Period Statement";
        StatementLine: Record "CG X157 Statement Line";
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260120D, 50);
        X157_SeedEntry('CC1', 20260205D, 30);
        X157_SeedEntry('CC1', 20260225D, 70);
        X157_SeedEntry('CC1', 20260315D, 40);

        Statement.BuildStatement('CC1', 20260101D, 20260331D);
        Statement.BuildStatement('CC1', 20260201D, 20260228D);

        StatementLine.SetRange("Cost Center Code", 'CC1');
        Assert.AreEqual(1, StatementLine.Count(), 'Rebuilding a statement for a narrower window must replace the previous rows, not add to them');
        Assert.IsFalse(StatementLine.Get('CC1', 20260101D), 'A row from the earlier, wider statement must not survive a rebuild');
        Assert.IsFalse(StatementLine.Get('CC1', 20260301D), 'A row from the earlier, wider statement must not survive a rebuild');
        X157_AssertStatementLine('CC1', 20260201D, 100, 'The rebuilt statement''s only row');
    end;
}
