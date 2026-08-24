codeunit 89193 "CG-AL-X097 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // === Shared helpers: price-validity module (temporary buffers only, no DeleteAll needed) ===

    local procedure AddLine(var PriceLine: Record "CG X077 Price Validity Line" temporary; LineNo: Integer; StartDate: Date; EndDate: Date)
    begin
        PriceLine.Init();
        PriceLine."Line No." := LineNo;
        PriceLine."Starting Date" := StartDate;
        PriceLine."Ending Date" := EndDate;
        PriceLine.Insert();
    end;

    // === Shared helpers: costing module ===

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every costing test clears its
    // tables before seeding its own rows.
    local procedure ClearX066Data()
    var
        LedgerEntry: Record "CG X066 Ledger Entry";
        ShipmentCost: Record "CG X066 Shipment Cost";
    begin
        LedgerEntry.DeleteAll();
        ShipmentCost.DeleteAll();
    end;

    // "Entry No." is an AutoIncrement key, so entries are seeded with it
    // left at zero and the platform-assigned value is read back and
    // returned - the returned number is what later ties a shipment back to
    // its recorded "CG X066 Shipment Cost" row.
    local procedure SeedEntry(ItemNo: Code[20]; Qty: Decimal; UnitCost: Decimal): Integer
    var
        LedgerEntry: Record "CG X066 Ledger Entry";
    begin
        LedgerEntry.Init();
        LedgerEntry."Item No." := ItemNo;
        LedgerEntry."Posting Date" := WorkDate();
        LedgerEntry.Quantity := Qty;
        LedgerEntry."Unit Cost" := UnitCost;
        LedgerEntry.Insert(true);
        exit(LedgerEntry."Entry No.");
    end;

    local procedure ShipmentCostOf(LedgerEntryNo: Integer): Decimal
    var
        ShipmentCost: Record "CG X066 Shipment Cost";
    begin
        ShipmentCost.Get(LedgerEntryNo);
        exit(ShipmentCost."Shipment Cost");
    end;

    local procedure ShipmentCostRowCount(ItemNo: Code[20]): Integer
    var
        ShipmentCost: Record "CG X066 Shipment Cost";
    begin
        ShipmentCost.SetRange("Item No.", ItemNo);
        exit(ShipmentCost.Count());
    end;

    // === Shared helpers: charge-allocation module ===

    // Same isolation note as the costing module above - every
    // charge-allocation test clears its own tables before seeding.
    local procedure ClearX079Data()
    var
        ChargeHeader: Record "CG X079 Charge Header";
        ChargeLine: Record "CG X079 Charge Line";
    begin
        ChargeLine.DeleteAll();
        ChargeHeader.DeleteAll();
    end;

    local procedure SeedHeader(DocumentNo: Code[20]; TotalAmount: Decimal)
    var
        ChargeHeader: Record "CG X079 Charge Header";
    begin
        ChargeHeader.Init();
        ChargeHeader."No." := DocumentNo;
        ChargeHeader."Charge Description" := 'Test charge';
        ChargeHeader."Total Charge Amount" := TotalAmount;
        ChargeHeader.Insert();
    end;

    local procedure SeedLine(DocumentNo: Code[20]; LineNo: Integer; LineWeight: Decimal)
    var
        ChargeLine: Record "CG X079 Charge Line";
    begin
        ChargeLine.Init();
        ChargeLine."Document No." := DocumentNo;
        ChargeLine."Line No." := LineNo;
        ChargeLine.Weight := LineWeight;
        ChargeLine.Insert();
    end;

    local procedure SeedLineWithSentinel(DocumentNo: Code[20]; LineNo: Integer; LineWeight: Decimal; SentinelAmount: Decimal)
    var
        ChargeLine: Record "CG X079 Charge Line";
    begin
        ChargeLine.Init();
        ChargeLine."Document No." := DocumentNo;
        ChargeLine."Line No." := LineNo;
        ChargeLine.Weight := LineWeight;
        ChargeLine."Allocated Amount" := SentinelAmount;
        ChargeLine.Insert();
    end;

    // Re-reads the header and all of its lines from the database and checks
    // every guarantee an allocation must satisfy: the recorded amounts sum
    // to exactly the header total, every amount is a whole number of cents,
    // and every line stays within a cent of its exact proportional share -
    // so neither a naive independent rounding nor a fix that dumps the
    // whole correction onto a single line can pass.
    local procedure VerifyAllocationBalances(DocumentNo: Code[20]; TotalAmount: Decimal)
    var
        ChargeLine: Record "CG X079 Charge Line";
        WeightSum: Decimal;
        SumOfAmounts: Decimal;
        ExactShare: Decimal;
    begin
        ChargeLine.SetRange("Document No.", DocumentNo);
        if ChargeLine.FindSet() then
            repeat
                WeightSum += ChargeLine.Weight;
            until ChargeLine.Next() = 0;

        ChargeLine.SetRange("Document No.", DocumentNo);
        if ChargeLine.FindSet() then
            repeat
                SumOfAmounts += ChargeLine."Allocated Amount";
            until ChargeLine.Next() = 0;

        Assert.AreEqual(
          TotalAmount, SumOfAmounts,
          StrSubstNo('Expected the allocated amounts on charge %1 to sum to exactly its total %2, not a cent more or less', DocumentNo, TotalAmount));

        ChargeLine.SetRange("Document No.", DocumentNo);
        if ChargeLine.FindSet() then
            repeat
                Assert.AreEqual(
                  Round(ChargeLine."Allocated Amount", 0.01), ChargeLine."Allocated Amount",
                  StrSubstNo('Expected the amount on line %1 of charge %2 to be a whole number of cents', ChargeLine."Line No.", DocumentNo));
                ExactShare := TotalAmount * ChargeLine.Weight / WeightSum;
                Assert.IsTrue(
                  Abs(ChargeLine."Allocated Amount" - ExactShare) < 0.01,
                  StrSubstNo(
                    'Expected line %1 of charge %2 to stay within a cent of its fair share %3, got %4',
                    ChargeLine."Line No.", DocumentNo, ExactShare, ChargeLine."Allocated Amount"));
            until ChargeLine.Next() = 0;
    end;

    // ============================================================
    // Price-validity module tests
    // ============================================================

    [Test]
    procedure MergeCombinesOverlappingWindowsIntoOnePeriod()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        MergedPeriod: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] Two windows sharing several days combine into one continuous coverage period
        AddLine(PriceLine, 10000, DMY2Date(1, 1, 2027), DMY2Date(20, 1, 2027));
        AddLine(PriceLine, 20000, DMY2Date(10, 1, 2027), DMY2Date(5, 2, 2027));

        Analyzer.MergeValidityPeriods(PriceLine, MergedPeriod);

        Assert.AreEqual(1, MergedPeriod.Count(), 'Two overlapping windows must merge into a single continuous coverage period');
        MergedPeriod.Get(10000);
        Assert.AreEqual(DMY2Date(1, 1, 2027), MergedPeriod."Starting Date", 'The merged coverage period must start on the earliest window''s starting date');
        Assert.AreEqual(DMY2Date(5, 2, 2027), MergedPeriod."Ending Date", 'The merged coverage period must end on the latest window''s ending date');
    end;

    [Test]
    procedure MergeKeepsOpenEndedWindowOutputUnbounded()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        MergedPeriod: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] A blank ending date means "valid forever", so a later window is absorbed and the coverage period stays open-ended
        AddLine(PriceLine, 10000, DMY2Date(1, 1, 2027), 0D);
        AddLine(PriceLine, 20000, DMY2Date(1, 3, 2027), DMY2Date(31, 3, 2027));

        Analyzer.MergeValidityPeriods(PriceLine, MergedPeriod);

        Assert.AreEqual(1, MergedPeriod.Count(), 'An open-ended window must absorb every later window into one coverage period');
        MergedPeriod.Get(10000);
        Assert.AreEqual(0D, MergedPeriod."Ending Date", 'A coverage period built from an open-ended window must itself stay open-ended, not switch to a concrete ending date');
    end;

    [Test]
    procedure DisjointConcretePeriodsAreNotConflicting()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] Windows with a real gap between them are no conflict
        AddLine(PriceLine, 10000, DMY2Date(1, 1, 2027), DMY2Date(31, 1, 2027));
        AddLine(PriceLine, 20000, DMY2Date(1, 3, 2027), DMY2Date(31, 3, 2027));

        Assert.AreEqual(0, Analyzer.CountConflictingPairs(PriceLine), 'Windows with a real gap between them must not count as a conflicting pair');
    end;

    [Test]
    procedure AdjacentConcretePeriodsAreNotConflicting()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] Touching windows share no day, so they are NOT a conflict
        AddLine(PriceLine, 10000, DMY2Date(1, 1, 2027), DMY2Date(10, 1, 2027));
        AddLine(PriceLine, 20000, DMY2Date(11, 1, 2027), DMY2Date(20, 1, 2027));

        Assert.AreEqual(0, Analyzer.CountConflictingPairs(PriceLine), 'Windows that touch but share no calendar day must not count as a conflicting pair');
    end;

    [Test]
    procedure PeriodsSharingExactlyOneDayAreConflicting()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] One window ends on the exact day the next begins - one shared day is a conflict
        AddLine(PriceLine, 10000, DMY2Date(1, 1, 2027), DMY2Date(10, 1, 2027));
        AddLine(PriceLine, 20000, DMY2Date(10, 1, 2027), DMY2Date(20, 1, 2027));

        Assert.AreEqual(1, Analyzer.CountConflictingPairs(PriceLine), 'Windows sharing exactly one calendar day must count as one conflicting pair');
    end;

    [Test]
    procedure OverlappingConcretePeriodsAreConflicting()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] Two ordinary dated windows sharing several days are one conflicting pair
        AddLine(PriceLine, 10000, DMY2Date(1, 1, 2027), DMY2Date(20, 1, 2027));
        AddLine(PriceLine, 20000, DMY2Date(15, 1, 2027), DMY2Date(31, 1, 2027));

        Assert.AreEqual(1, Analyzer.CountConflictingPairs(PriceLine), 'Two windows sharing several days must count as one conflicting pair');
    end;

    [Test]
    procedure ContainedPeriodIsConflicting()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] A window fully inside another is a conflict too
        AddLine(PriceLine, 10000, DMY2Date(1, 1, 2027), DMY2Date(31, 12, 2027));
        AddLine(PriceLine, 20000, DMY2Date(1, 3, 2027), DMY2Date(31, 3, 2027));

        Assert.AreEqual(1, Analyzer.CountConflictingPairs(PriceLine), 'A window fully inside another window must count as one conflicting pair');
    end;

    [Test]
    procedure IdenticalPeriodsAreConflicting()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] Two lines with the same window are the classic duplicate import - one conflicting pair
        AddLine(PriceLine, 10000, DMY2Date(1, 4, 2027), DMY2Date(30, 4, 2027));
        AddLine(PriceLine, 20000, DMY2Date(1, 4, 2027), DMY2Date(30, 4, 2027));

        Assert.AreEqual(1, Analyzer.CountConflictingPairs(PriceLine), 'Two lines with identical validity windows must count as one conflicting pair');
    end;

    [Test]
    procedure ConflictCountReflectsPairsNotLines()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] A year-long window against two disjoint short ones is 2 pairs, though 3 lines are involved
        AddLine(PriceLine, 10000, DMY2Date(1, 1, 2027), DMY2Date(31, 12, 2027));
        AddLine(PriceLine, 20000, DMY2Date(10, 1, 2027), DMY2Date(20, 1, 2027));
        AddLine(PriceLine, 30000, DMY2Date(1, 3, 2027), DMY2Date(10, 3, 2027));

        Assert.AreEqual(2, Analyzer.CountConflictingPairs(PriceLine), 'A year-long window conflicting with two disjoint shorter windows must count as 2 pairs, not the number of lines involved');
    end;

    [Test]
    procedure OpenEndedWindowConflictsWithMuchLaterWindow()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] A window with no ending date never expires - it conflicts with a window starting years later
        AddLine(PriceLine, 10000, DMY2Date(1, 6, 2027), 0D);
        AddLine(PriceLine, 20000, DMY2Date(1, 12, 2029), DMY2Date(31, 12, 2029));

        Assert.AreEqual(1, Analyzer.CountConflictingPairs(PriceLine), 'A window with no ending date must count as conflicting with a window starting years later - it never expires');
    end;

    [Test]
    procedure OpenEndedWindowOnHigherLineNoConflictsWithEarlierWindow()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] An open-ended window is not only ever the earlier-numbered line of a pair - it must still count as conflicting when it is the later-numbered one
        AddLine(PriceLine, 10000, DMY2Date(1, 1, 2027), DMY2Date(31, 1, 2027));
        AddLine(PriceLine, 20000, DMY2Date(15, 1, 2027), 0D);

        Assert.AreEqual(1, Analyzer.CountConflictingPairs(PriceLine), 'A window with no ending date must count as conflicting with an earlier window, regardless of which of the two lines has the higher line number');
    end;

    [Test]
    procedure OpenEndedWindowDoesNotConflictWithEarlierDisjointWindow()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] A window with no ending date still has a real starting date - it must not conflict with a window that ended before it even started
        AddLine(PriceLine, 10000, DMY2Date(1, 3, 2028), 0D);
        AddLine(PriceLine, 20000, DMY2Date(1, 1, 2027), DMY2Date(31, 1, 2027));

        Assert.AreEqual(0, Analyzer.CountConflictingPairs(PriceLine), 'A window with no ending date must not count as conflicting with a window that ended entirely before it starts');
    end;

    [Test]
    procedure MergeRejectsEndingDateBeforeStartingDate()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        MergedPeriod: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] A reversed validity window fails the merge with the promised message
        AddLine(PriceLine, 10000, DMY2Date(10, 5, 2027), DMY2Date(1, 5, 2027));

        asserterror Analyzer.MergeValidityPeriods(PriceLine, MergedPeriod);
        Assert.ExpectedError('before the starting date');
    end;

    [Test]
    procedure ConflictCountRejectsEndingDateBeforeStartingDate()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] A reversed validity window fails the conflict count with the promised message
        AddLine(PriceLine, 10000, DMY2Date(1, 7, 2027), DMY2Date(31, 7, 2027));
        AddLine(PriceLine, 20000, DMY2Date(10, 7, 2027), DMY2Date(5, 7, 2027));

        asserterror Analyzer.CountConflictingPairs(PriceLine);
        Assert.ExpectedError('before the starting date');
    end;

    [Test]
    procedure PeriodsSharingExactlyOneDayAreConflictingWhicheverLineComesFirst()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] A shared day is a conflict whichever line comes first - the lower-numbered line starts later and shares only its first day with the higher-numbered line's last day
        AddLine(PriceLine, 10000, DMY2Date(10, 1, 2027), DMY2Date(20, 1, 2027));
        AddLine(PriceLine, 20000, DMY2Date(1, 1, 2027), DMY2Date(10, 1, 2027));

        Assert.AreEqual(1, Analyzer.CountConflictingPairs(PriceLine), 'A shared day is a conflict whichever line comes first');
    end;

    [Test]
    procedure MergeProducesSeparatePeriodsAcrossARealGap()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        MergedPeriod: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] Two windows merge into one continuous period, but a third window with a real gap after them must stay a separate second period
        AddLine(PriceLine, 10000, DMY2Date(1, 1, 2027), DMY2Date(10, 1, 2027));
        AddLine(PriceLine, 20000, DMY2Date(5, 1, 2027), DMY2Date(15, 1, 2027));
        AddLine(PriceLine, 30000, DMY2Date(1, 3, 2027), DMY2Date(10, 3, 2027));

        Analyzer.MergeValidityPeriods(PriceLine, MergedPeriod);

        Assert.AreEqual(2, MergedPeriod.Count(), 'A real gap after a merged group must start a new, separate coverage period rather than folding everything into one');
        MergedPeriod.Get(10000);
        Assert.AreEqual(DMY2Date(1, 1, 2027), MergedPeriod."Starting Date", 'The first coverage period must start on the earliest window''s starting date');
        Assert.AreEqual(DMY2Date(15, 1, 2027), MergedPeriod."Ending Date", 'The first coverage period must end on the later of the two overlapping windows'' ending dates');
        MergedPeriod.Get(20000);
        Assert.AreEqual(DMY2Date(1, 3, 2027), MergedPeriod."Starting Date", 'The second coverage period must start on the gapped window''s own starting date');
        Assert.AreEqual(DMY2Date(10, 3, 2027), MergedPeriod."Ending Date", 'The second coverage period must end on the gapped window''s own ending date');
    end;

    [Test]
    procedure MergeCombinesTouchingWindowsWithNoGapIntoOnePeriod()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        MergedPeriod: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] One window ends the exact day before the next begins - no gap day between them, so they merge into one continuous coverage period
        AddLine(PriceLine, 10000, DMY2Date(1, 1, 2027), DMY2Date(10, 1, 2027));
        AddLine(PriceLine, 20000, DMY2Date(11, 1, 2027), DMY2Date(20, 1, 2027));

        Analyzer.MergeValidityPeriods(PriceLine, MergedPeriod);

        Assert.AreEqual(1, MergedPeriod.Count(), 'Touching windows with no gap day between them must merge into a single continuous coverage period');
        MergedPeriod.Get(10000);
        Assert.AreEqual(DMY2Date(1, 1, 2027), MergedPeriod."Starting Date", 'The merged coverage period must start on the earlier window''s starting date');
        Assert.AreEqual(DMY2Date(20, 1, 2027), MergedPeriod."Ending Date", 'The merged coverage period must end on the later window''s ending date');
    end;

    [Test]
    procedure MergeSortsLinesByStartingDateRegardlessOfLineNoOrder()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        MergedPeriod: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] The earlier-starting window is entered under the higher line number - the merge must still process windows in date order, not insertion order
        AddLine(PriceLine, 10000, DMY2Date(15, 1, 2027), DMY2Date(31, 1, 2027));
        AddLine(PriceLine, 20000, DMY2Date(1, 1, 2027), DMY2Date(20, 1, 2027));

        Analyzer.MergeValidityPeriods(PriceLine, MergedPeriod);

        Assert.AreEqual(1, MergedPeriod.Count(), 'Two overlapping windows must merge into a single continuous coverage period regardless of which one has the higher line number');
        MergedPeriod.Get(10000);
        Assert.AreEqual(DMY2Date(1, 1, 2027), MergedPeriod."Starting Date", 'The merged coverage period must start on the earliest starting date even when that window has the higher line number');
        Assert.AreEqual(DMY2Date(31, 1, 2027), MergedPeriod."Ending Date", 'The merged coverage period must end on the latest ending date');
    end;

    [Test]
    procedure MergeAcceptsASingleDayWindow()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        MergedPeriod: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] A window that starts and ends on the same day is a legitimate one-day validity period, not a reversed range
        AddLine(PriceLine, 10000, DMY2Date(5, 1, 2027), DMY2Date(5, 1, 2027));

        Analyzer.MergeValidityPeriods(PriceLine, MergedPeriod);

        Assert.AreEqual(1, MergedPeriod.Count(), 'A single-day window must not be rejected as an invalid range');
        MergedPeriod.Get(10000);
        Assert.AreEqual(DMY2Date(5, 1, 2027), MergedPeriod."Starting Date", 'A single-day coverage period must start on that day');
        Assert.AreEqual(DMY2Date(5, 1, 2027), MergedPeriod."Ending Date", 'A single-day coverage period must end on that same day');
    end;

    [Test]
    procedure MergeValidatesEveryLineRegardlessOfAnyCallerAppliedFilter()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        MergedPeriod: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] A reversed window on an item the caller has filtered out must still be rejected - validation cannot depend on a filter the caller happens to have set
        PriceLine.Init();
        PriceLine."Line No." := 10000;
        PriceLine."Item No." := 'A';
        PriceLine."Starting Date" := DMY2Date(1, 1, 2027);
        PriceLine."Ending Date" := DMY2Date(31, 1, 2027);
        PriceLine.Insert();

        PriceLine.Init();
        PriceLine."Line No." := 20000;
        PriceLine."Item No." := 'B';
        PriceLine."Starting Date" := DMY2Date(10, 5, 2027);
        PriceLine."Ending Date" := DMY2Date(1, 5, 2027);
        PriceLine.Insert();

        PriceLine.SetRange("Item No.", 'A');

        asserterror Analyzer.MergeValidityPeriods(PriceLine, MergedPeriod);
        Assert.ExpectedError('before the starting date');
    end;

    [Test]
    procedure MergeCalledTwiceOnTheSameOutputBufferReflectsOnlyTheSecondCall()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        MergedPeriod: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] A caller that reuses the same output buffer across two merges must see only the second call's periods, not a mix of both
        AddLine(PriceLine, 10000, DMY2Date(1, 1, 2027), DMY2Date(10, 1, 2027));
        Analyzer.MergeValidityPeriods(PriceLine, MergedPeriod);

        PriceLine.DeleteAll();
        AddLine(PriceLine, 10000, DMY2Date(1, 6, 2027), DMY2Date(10, 6, 2027));
        Analyzer.MergeValidityPeriods(PriceLine, MergedPeriod);

        Assert.AreEqual(1, MergedPeriod.Count(), 'A second merge into a reused output buffer must leave only the second call''s periods behind');
        MergedPeriod.Get(10000);
        Assert.AreEqual(DMY2Date(1, 6, 2027), MergedPeriod."Starting Date", 'The output buffer must reflect only the second call''s period, not any period left over from the first call');
        Assert.AreEqual(DMY2Date(10, 6, 2027), MergedPeriod."Ending Date", 'The output buffer must reflect only the second call''s period, not any period left over from the first call');
    end;

    // ============================================================
    // Costing module tests
    // ============================================================

    [Test]
    procedure ShipmentDrawnFromTwoReceiptsCostsTheExactCombinedTotal()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        ShipmentNo: Integer;
    begin
        ClearX066Data();
        SeedEntry('ROUND1', 2, 0.557);
        SeedEntry('ROUND1', 5, 0.52);
        ShipmentNo := SeedEntry('ROUND1', -3.7, 0);

        Engine.CalculateShipmentCosts('ROUND1');

        Assert.AreEqual(2.00, ShipmentCostOf(ShipmentNo),
          'Expected the recorded cost of a shipment drawn from two receipts to equal the exact combined cost of the units taken, to the cent');
    end;

    [Test]
    procedure ShipmentDrawnFromThreeReceiptsCostsTheExactCombinedTotal()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        ShipmentNo: Integer;
    begin
        ClearX066Data();
        SeedEntry('ROUND2', 1, 0.503);
        SeedEntry('ROUND2', 1, 0.503);
        SeedEntry('ROUND2', 1, 0.503);
        ShipmentNo := SeedEntry('ROUND2', -3, 0);

        Engine.CalculateShipmentCosts('ROUND2');

        Assert.AreEqual(1.51, ShipmentCostOf(ShipmentNo),
          'Expected the recorded cost of a shipment drawn from three receipts to equal the exact combined cost of the units taken, to the cent');
    end;

    [Test]
    procedure ShipmentDrawnFromTwoFinelyPricedReceiptsCostsTheExactCombinedTotal()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        ShipmentNo: Integer;
    begin
        ClearX066Data();
        SeedEntry('ROUND5', 1, 0.48618);
        SeedEntry('ROUND5', 1, 0.90878);
        ShipmentNo := SeedEntry('ROUND5', -2, 0);

        Engine.CalculateShipmentCosts('ROUND5');

        Assert.AreEqual(1.39, ShipmentCostOf(ShipmentNo),
          'Expected the recorded cost of a shipment drawn from two finely priced receipts to equal the exact combined cost of the units taken, to the cent');
    end;

    [Test]
    procedure ShipmentFromASingleReceiptCostsExactlyQuantityTimesUnitCost()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        ShipmentNo: Integer;
    begin
        ClearX066Data();
        SeedEntry('ROUND3', 10, 2.50);
        ShipmentNo := SeedEntry('ROUND3', -4, 0);

        Engine.CalculateShipmentCosts('ROUND3');

        Assert.AreEqual(10.00, ShipmentCostOf(ShipmentNo),
          'Expected a shipment drawn entirely from one receipt to cost exactly the quantity taken times that receipt unit cost');
    end;

    [Test]
    procedure ShipmentCostOnAnExactHalfCentRoundsAwayFromZero()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        ShipmentNo: Integer;
    begin
        ClearX066Data();
        SeedEntry('ROUND4', 5, 1.005);
        ShipmentNo := SeedEntry('ROUND4', -5, 0);

        Engine.CalculateShipmentCosts('ROUND4');

        Assert.AreEqual(5.03, ShipmentCostOf(ShipmentNo),
          'Expected an exact cost of 5.025 to be recorded as 5.03, away from zero, not 5.02');
    end;

    [Test]
    procedure PartiallyConsumedReceiptCarriesItsRemainderToTheNextShipment()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        FirstShipmentNo: Integer;
        SecondShipmentNo: Integer;
    begin
        ClearX066Data();
        SeedEntry('CARRY1', 10, 3.00);
        SeedEntry('CARRY1', 10, 4.00);
        FirstShipmentNo := SeedEntry('CARRY1', -4, 0);
        SecondShipmentNo := SeedEntry('CARRY1', -9, 0);

        Engine.CalculateShipmentCosts('CARRY1');

        Assert.AreEqual(12.00, ShipmentCostOf(FirstShipmentNo),
          'Expected the first shipment to cost only what it drew from the oldest receipt');
        Assert.AreEqual(30.00, ShipmentCostOf(SecondShipmentNo),
          'Expected the second shipment to draw the remainder of the oldest receipt before drawing from the next receipt');
    end;

    [Test]
    procedure ReceiptPostedAfterAShipmentJoinsTheBackOfTheQueue()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        FirstShipmentNo: Integer;
        SecondShipmentNo: Integer;
    begin
        ClearX066Data();
        SeedEntry('QUEUE1', 4, 1.00);
        FirstShipmentNo := SeedEntry('QUEUE1', -3, 0);
        SeedEntry('QUEUE1', 4, 10.00);
        SecondShipmentNo := SeedEntry('QUEUE1', -4, 0);

        Engine.CalculateShipmentCosts('QUEUE1');

        Assert.AreEqual(3.00, ShipmentCostOf(FirstShipmentNo),
          'Expected the first shipment to cost only what it drew from the only receipt on hand at that point');
        Assert.AreEqual(31.00, ShipmentCostOf(SecondShipmentNo),
          'Expected the second shipment to draw the last unit of the original receipt plus units from the receipt posted afterward');
    end;

    [Test]
    procedure ShippingMoreThanIsOnHandRaisesAnError()
    var
        Engine: Codeunit "CG X066 Costing Engine";
    begin
        ClearX066Data();
        SeedEntry('ERR1', 5, 1.00);
        SeedEntry('ERR1', -3, 0);
        SeedEntry('ERR1', -3, 0);

        asserterror Engine.CalculateShipmentCosts('ERR1');

        Assert.ExpectedError('Insufficient inventory');
    end;

    [Test]
    procedure ShippingMoreThanHasArrivedSoFarFailsEvenWhenMoreArrivesLaterInTheSameRun()
    var
        Engine: Codeunit "CG X066 Costing Engine";
    begin
        ClearX066Data();
        SeedEntry('ERR2', 4, 1.00);
        SeedEntry('ERR2', -6, 0);
        SeedEntry('ERR2', 10, 1.00);

        asserterror Engine.CalculateShipmentCosts('ERR2');

        Assert.ExpectedError('Insufficient inventory');
    end;

    [Test]
    procedure RecomputingOneItemLeavesAnotherItemsRecordedCostUntouched()
    var
        ShipmentCost: Record "CG X066 Shipment Cost";
        Engine: Codeunit "CG X066 Costing Engine";
        ShipmentNo: Integer;
        OtherItemLedgerEntryNo: Integer;
    begin
        ClearX066Data();

        // A previously recorded cost for an unrelated item, seeded with a
        // nonzero value so an accidental wipe is distinguishable from an
        // untouched row.
        OtherItemLedgerEntryNo := 999001;
        ShipmentCost.Init();
        ShipmentCost."Ledger Entry No." := OtherItemLedgerEntryNo;
        ShipmentCost."Item No." := 'ISO-B';
        ShipmentCost."Posting Date" := WorkDate();
        ShipmentCost."Shipment Cost" := 777.77;
        ShipmentCost.Insert();

        SeedEntry('ISO-A', 6, 2.00);
        ShipmentNo := SeedEntry('ISO-A', -6, 0);

        Engine.CalculateShipmentCosts('ISO-A');
        Engine.CalculateShipmentCosts('ISO-A');

        Assert.AreEqual(12.00, ShipmentCostOf(ShipmentNo),
          'Expected the recomputed cost to reflect the current receipts');
        Assert.AreEqual(1, ShipmentCostRowCount('ISO-A'),
          'Expected exactly one recorded cost for the one shipment, even after recomputing the item twice');
        Assert.AreEqual(777.77, ShipmentCostOf(OtherItemLedgerEntryNo),
          'Expected a recorded cost for a different item to be unaffected by recomputing this item');
    end;

    [Test]
    procedure RecomputingOneItemNeverProcessesAnotherItemsLedgerEntries()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        ShipmentNo: Integer;
    begin
        ClearX066Data();
        SeedEntry('MULTI-A', 5, 1.00);
        ShipmentNo := SeedEntry('MULTI-A', -5, 0);
        SeedEntry('MULTI-B', 3, 2.00);
        SeedEntry('MULTI-B', -3, 0);

        Engine.CalculateShipmentCosts('MULTI-A');

        Assert.AreEqual(5.00, ShipmentCostOf(ShipmentNo),
          'Expected the requested item''s shipment to cost exactly its own drawn quantity times unit cost');
        Assert.AreEqual(0, ShipmentCostRowCount('MULTI-B'),
          'Expected recomputing one item to never write a recorded cost row for a different item''s ledger entries');
    end;

    [Test]
    procedure ZeroQuantityEntryStillRecordsAZeroCostShipmentRow()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        ShipmentNo: Integer;
    begin
        ClearX066Data();
        ShipmentNo := SeedEntry('ZERO1', 0, 5.00);

        Engine.CalculateShipmentCosts('ZERO1');

        Assert.AreEqual(0.00, ShipmentCostOf(ShipmentNo),
          'Expected a zero-quantity entry to still be recorded as a shipment with zero cost, not skipped entirely');
    end;

    [Test]
    procedure InsufficientInventoryErrorReportsNeededBeforeOnHand()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        ErrorText: Text;
        NeededPos: Integer;
        OnHandPos: Integer;
    begin
        ClearX066Data();
        SeedEntry('ERRSWAP', 2, 1.00);
        SeedEntry('ERRSWAP', -5, 0);

        asserterror Engine.CalculateShipmentCosts('ERRSWAP');
        ErrorText := GetLastErrorText();

        NeededPos := StrPos(ErrorText, '5');
        OnHandPos := StrPos(ErrorText, '2');
        Assert.IsTrue(NeededPos > 0, 'Expected the error to mention the quantity actually needed');
        Assert.IsTrue(OnHandPos > 0, 'Expected the error to mention the quantity actually on hand');
        Assert.IsTrue(NeededPos < OnHandPos, 'Expected the error to report the quantity needed before the quantity on hand');
    end;

    // ============================================================
    // Charge-allocation module tests
    // ============================================================

    [Test]
    procedure SingleLineChargeGetsTheEntireTotal()
    var
        ChargeLine: Record "CG X079 Charge Line";
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        ClearX079Data();
        SeedHeader('SL01', 123.45);
        SeedLine('SL01', 1, 7.5);

        Allocator.AllocateCharge('SL01');

        ChargeLine.Get('SL01', 1);
        Assert.AreEqual(123.45, ChargeLine."Allocated Amount", 'Expected a charge with a single line to allocate its entire total to that line');
    end;

    [Test]
    procedure ThreeEqualWeightLinesSumExactlyToTheTotal()
    var
        ChargeHeader: Record "CG X079 Charge Header";
        ChargeLine: Record "CG X079 Charge Line";
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        ClearX079Data();
        SeedHeader('TW01', 100.00);
        SeedLine('TW01', 1, 1);
        SeedLine('TW01', 2, 1);
        SeedLine('TW01', 3, 1);

        // A second charge, seeded with its own nonzero sentinel amounts and
        // left alone - proves allocating one charge does not disturb
        // another charge's recorded amounts or Allocated flag.
        SeedHeader('TW02', 250.00);
        SeedLineWithSentinel('TW02', 1, 1, 111.11);
        SeedLineWithSentinel('TW02', 2, 1, 222.22);

        Allocator.AllocateCharge('TW01');

        VerifyAllocationBalances('TW01', 100.00);
        Assert.AreEqual(
          100.00, Allocator.GetAllocatedTotal('TW01'),
          'Expected the reconciliation total for the charge to equal its header total after allocating');

        ChargeHeader.Get('TW02');
        Assert.IsFalse(ChargeHeader.Allocated, 'Expected a charge that was not allocated to stay unallocated');
        ChargeLine.Get('TW02', 1);
        Assert.AreEqual(
          111.11, ChargeLine."Allocated Amount",
          'Expected another charge''s line amount to be left untouched by allocating a different charge');
        ChargeLine.Get('TW02', 2);
        Assert.AreEqual(
          222.22, ChargeLine."Allocated Amount",
          'Expected another charge''s line amount to be left untouched by allocating a different charge');
    end;

    [Test]
    procedure SixEqualWeightLinesWithHalfCentSharesSumExactlyToTheTotal()
    var
        Allocator: Codeunit "CG X079 Charge Allocator";
        i: Integer;
    begin
        // Every line's exact share (0.99 / 6 = 0.165) ends in half a cent,
        // so independent per-line rounding drifts by three cents in total -
        // exactly the pattern finance flagged.
        ClearX079Data();
        SeedHeader('HC01', 0.99);
        for i := 1 to 6 do
            SeedLine('HC01', i, 1);

        Allocator.AllocateCharge('HC01');

        VerifyAllocationBalances('HC01', 0.99);
    end;

    [Test]
    procedure UnequalFinelyWeightedLinesSumExactlyToTheTotal()
    var
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        // Weights carried to five decimal places, none of them a round or
        // repeating fraction - a fix that only special-cases equal-weight
        // splits or exact half-cent shares still has to get this right.
        ClearX079Data();
        SeedHeader('FP01', 143.99);
        SeedLine('FP01', 1, 5.39998);
        SeedLine('FP01', 2, 16.05634);
        SeedLine('FP01', 3, 11.86395);

        Allocator.AllocateCharge('FP01');

        VerifyAllocationBalances('FP01', 143.99);
    end;

    [Test]
    procedure UnequalWeightsWithTwoHalfCentSharesSumExactlyToTheTotal()
    var
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        // Two of the three exact shares (40.005 and 39.995) sit exactly on
        // a half-cent boundary in opposite directions; the strict per-line
        // bound in VerifyAllocationBalances means the correction cannot be
        // parked entirely on any single line here without that line's
        // amount landing a full cent from its own whole-cent fair share.
        ClearX079Data();
        SeedHeader('HB01', 100.00);
        SeedLine('HB01', 1, 20.000);
        SeedLine('HB01', 2, 40.005);
        SeedLine('HB01', 3, 39.995);

        Allocator.AllocateCharge('HB01');

        VerifyAllocationBalances('HB01', 100.00);
    end;

    [Test]
    procedure TenLinesWithFinelyWeightedSharesSumExactlyToTheTotal()
    var
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        ClearX079Data();
        SeedHeader('FP10', 1000.00);
        SeedLine('FP10', 1, 32.15163);
        SeedLine('FP10', 2, 1.73803);
        SeedLine('FP10', 3, 14.11395);
        SeedLine('FP10', 4, 11.54893);
        SeedLine('FP10', 5, 36.95533);
        SeedLine('FP10', 6, 33.99662);
        SeedLine('FP10', 7, 44.66289);
        SeedLine('FP10', 8, 4.80347);
        SeedLine('FP10', 9, 21.38513);
        SeedLine('FP10', 10, 1.97496);

        Allocator.AllocateCharge('FP10');

        VerifyAllocationBalances('FP10', 1000.00);
    end;

    [Test]
    procedure ZeroWeightLineReceivesExactlyZero()
    var
        ChargeLine: Record "CG X079 Charge Line";
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        ClearX079Data();
        SeedHeader('ZW02', 99.99);
        SeedLine('ZW02', 1, 5);
        SeedLine('ZW02', 2, 0);
        SeedLine('ZW02', 3, 3);

        Allocator.AllocateCharge('ZW02');

        ChargeLine.Get('ZW02', 2);
        Assert.AreEqual(
          0.0, ChargeLine."Allocated Amount",
          'Expected a line with no weight to be allocated exactly zero, even though other lines on the same charge carry a nonzero total');
        VerifyAllocationBalances('ZW02', 99.99);
    end;

    [Test]
    procedure NegativeTotalCreditMemoSumsExactlyToTheTotal()
    var
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        ClearX079Data();
        SeedHeader('CM01', -100.01);
        SeedLine('CM01', 1, 2);
        SeedLine('CM01', 2, 1);

        Allocator.AllocateCharge('CM01');

        VerifyAllocationBalances('CM01', -100.01);
    end;

    [Test]
    procedure SuccessfulAllocationMarksTheChargeAllocated()
    var
        ChargeHeader: Record "CG X079 Charge Header";
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        ClearX079Data();
        SeedHeader('MK01', 40.00);
        SeedLine('MK01', 1, 1);
        SeedLine('MK01', 2, 1);

        Allocator.AllocateCharge('MK01');

        ChargeHeader.Get('MK01');
        Assert.IsTrue(ChargeHeader.Allocated, 'Expected a charge with at least one weighted line to be marked allocated');
    end;

    [Test]
    procedure AChargeWithNoWeightOnAnyLineIsLeftUnallocated()
    var
        ChargeHeader: Record "CG X079 Charge Header";
        ChargeLine: Record "CG X079 Charge Line";
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        ClearX079Data();
        SeedHeader('ZW01', 50.00);
        SeedLineWithSentinel('ZW01', 1, 0, 555.55);
        SeedLineWithSentinel('ZW01', 2, 0, 444.44);

        Allocator.AllocateCharge('ZW01');

        ChargeHeader.Get('ZW01');
        Assert.IsFalse(ChargeHeader.Allocated, 'Expected a charge with no weight on any line to be left unallocated');

        ChargeLine.Get('ZW01', 1);
        Assert.AreEqual(
          555.55, ChargeLine."Allocated Amount",
          'Expected a line''s existing amount to be left untouched when the charge has no weight to allocate');
        ChargeLine.Get('ZW01', 2);
        Assert.AreEqual(
          444.44, ChargeLine."Allocated Amount",
          'Expected a line''s existing amount to be left untouched when the charge has no weight to allocate');
    end;

    [Test]
    procedure RandomChargeKeepsEveryLineWithinItsFairShare()
    var
        Allocator: Codeunit "CG X079 Charge Allocator";
        Any: Codeunit Any;
        TotalAmount: Decimal;
        i: Integer;
    begin
        ClearX079Data();
        Any.SetSeed(79);
        TotalAmount := Any.IntegerInRange(10000, 999999) / 100;
        SeedHeader('RND01', TotalAmount);
        for i := 1 to 9 do
            SeedLine('RND01', i, Any.DecimalInRange(1, 500, 2));

        Allocator.AllocateCharge('RND01');

        VerifyAllocationBalances('RND01', TotalAmount);
    end;
}
