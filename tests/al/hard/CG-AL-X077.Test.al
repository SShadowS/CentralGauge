codeunit 88830 "CG-AL-X077 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // All records here are temporary buffers scoped to each test's own local
    // variable, never a persisted table, so no DeleteAll seeding step is
    // needed between tests.

    local procedure AddLine(var PriceLine: Record "CG X077 Price Validity Line" temporary; LineNo: Integer; StartDate: Date; EndDate: Date)
    begin
        PriceLine.Init();
        PriceLine."Line No." := LineNo;
        PriceLine."Starting Date" := StartDate;
        PriceLine."Ending Date" := EndDate;
        PriceLine.Insert();
    end;

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
}
