codeunit 89303 "CG-AL-X109 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods, so
    // every test clears the table before seeding its own rows.

    local procedure ClearAll()
    var
        ActivityEntry: Record "CG X109 Activity Entry";
    begin
        ActivityEntry.DeleteAll();
    end;

    local procedure MockEntry(DocumentNo: Code[20]; EntryAmount: Decimal): Integer
    var
        ActivityEntry: Record "CG X109 Activity Entry";
    begin
        if ActivityEntry.FindLast() then;
        ActivityEntry.Init();
        ActivityEntry."Entry No." += 1;
        ActivityEntry."Document No." := DocumentNo;
        ActivityEntry.Amount := EntryAmount;
        ActivityEntry.Insert();
        exit(ActivityEntry."Entry No.");
    end;

    local procedure DisturbCache()
    begin
        // The warm-up call below leaves the table's result set sitting in the
        // server data cache, and a cached read costs zero SQL - the graded
        // call would then measure nothing. A write bumps the table's version
        // and forces real statements again; the decoy entry sits under its
        // own document number, so no graded lookup can ever see it.
        MockEntry('CG-X109-DECOY', 1);
        SelectLatestVersion();
    end;

    [Test]
    procedure ReturnsTheEntryWithTheHighestEntryNo()
    var
        EntryFinder: Codeunit "CG X109 Entry Finder";
        ActivityEntry: Record "CG X109 Activity Entry";
        Any: Codeunit Any;
        LatestAmount: Decimal;
        LatestEntryNo: Integer;
    begin
        ClearAll();
        MockEntry('CG-X109-D1', Any.DecimalInRange(500, 900, 2));
        MockEntry('CG-X109-D1', Any.DecimalInRange(500, 900, 2));
        // the newest entry deliberately carries the smallest amount, so
        // "biggest amount" is not the same question as "latest entry"
        LatestAmount := Any.DecimalInRange(100, 400, 2);
        LatestEntryNo := MockEntry('CG-X109-D1', LatestAmount);

        Assert.IsTrue(EntryFinder.FindLatest('CG-X109-D1', ActivityEntry),
            'Expected a latest entry to be found for a document that has entries');
        Assert.AreEqual(LatestEntryNo, ActivityEntry."Entry No.",
            'Expected the most recently posted entry to be returned, whatever its amount');
        Assert.AreEqual(LatestAmount, ActivityEntry.Amount,
            'Expected the returned record to carry the latest entry''s own data');
    end;

    [Test]
    procedure IgnoresNewerEntriesOfOtherDocuments()
    var
        EntryFinder: Codeunit "CG X109 Entry Finder";
        ActivityEntry: Record "CG X109 Activity Entry";
        Any: Codeunit Any;
        OwnAmount: Decimal;
        OwnEntryNo: Integer;
    begin
        ClearAll();
        OwnAmount := Any.DecimalInRange(100, 900, 2);
        OwnEntryNo := MockEntry('CG-X109-D2A', OwnAmount);
        MockEntry('CG-X109-D2B', Any.DecimalInRange(100, 900, 2));

        Assert.IsTrue(EntryFinder.FindLatest('CG-X109-D2A', ActivityEntry),
            'Expected the requested document''s own entry to be found');
        Assert.AreEqual(OwnEntryNo, ActivityEntry."Entry No.",
            'Expected the requested document''s own latest entry - a newer entry posted under a different document must not win');
        Assert.AreEqual(OwnAmount, ActivityEntry.Amount,
            'Expected the amount of the requested document''s own entry, not another document''s');
    end;

    [Test]
    procedure ReturnsFalseWhenTheDocumentHasNoEntries()
    var
        EntryFinder: Codeunit "CG X109 Entry Finder";
        ActivityEntry: Record "CG X109 Activity Entry";
        Any: Codeunit Any;
    begin
        ClearAll();
        MockEntry('CG-X109-D3-OTHER', Any.DecimalInRange(100, 900, 2));

        Assert.IsFalse(EntryFinder.FindLatest('CG-X109-D3', ActivityEntry),
            'Expected no entry to be found for a document with none of its own, even while other documents have entries');
    end;

    [Test]
    procedure StaysWithinTheRowBudgetForAnEntryHeavyDocument()
    var
        EntryFinder: Codeunit "CG X109 Entry Finder";
        ActivityEntry: Record "CG X109 Activity Entry";
        MaxRows: Integer;
        LatestEntryNo: Integer;
        i: Integer;
        RowsBefore: BigInteger;
        RowsUsed: BigInteger;
    begin
        ClearAll();
        MaxRows := 20;

        // Warm-up runs against its own small, unrelated document so
        // first-touch metadata/plan loading lands outside the measurement
        // window below, and so a per-document cache of results could not
        // possibly hold an answer for the document graded next.
        MockEntry('CG-X109-D4-WARM', 10);
        EntryFinder.FindLatest('CG-X109-D4-WARM', ActivityEntry);

        // The graded document is seeded only now, after the warm-up, so the
        // measured call below is that document's first-ever lookup.
        for i := 1 to 200 do
            LatestEntryNo := MockEntry('CG-X109-D4', 10);
        DisturbCache();
        Clear(ActivityEntry);
        RowsBefore := SessionInformation.SqlRowsRead();
        Assert.IsTrue(EntryFinder.FindLatest('CG-X109-D4', ActivityEntry),
            'Expected the latest entry to be found before judging the cost');
        RowsUsed := SessionInformation.SqlRowsRead() - RowsBefore;

        Assert.AreEqual(LatestEntryNo, ActivityEntry."Entry No.",
            'Expected the cheap lookup to still return the correct latest entry - the right answer first, then the right cost');
        Assert.IsTrue(RowsUsed <= MaxRows,
            StrSubstNo('Expected the lookup to read at most %1 rows, but it read %2 for a document with 200 entries', MaxRows, RowsUsed));
    end;

    [Test]
    procedure StaysWithinTheStatementBudgetForAnEntryHeavyDocument()
    var
        EntryFinder: Codeunit "CG X109 Entry Finder";
        ActivityEntry: Record "CG X109 Activity Entry";
        MaxStatements: Integer;
        LatestEntryNo: Integer;
        i: Integer;
        StatementsBefore: BigInteger;
        StatementsUsed: BigInteger;
    begin
        ClearAll();
        MaxStatements := 20;

        // Warm-up runs against its own small, unrelated document, same
        // reasoning as the row-budget test above: it keeps one-time
        // metadata/plan costs out of the measurement window, and it means a
        // per-document cache of results could not hold an answer for the
        // document graded next.
        MockEntry('CG-X109-D5-WARM', 10);
        EntryFinder.FindLatest('CG-X109-D5-WARM', ActivityEntry);

        // The graded document is seeded only now, after the warm-up, so the
        // measured call below is that document's first-ever lookup.
        for i := 1 to 200 do
            LatestEntryNo := MockEntry('CG-X109-D5', 10);
        DisturbCache();
        Clear(ActivityEntry);
        StatementsBefore := SessionInformation.SqlStatementsExecuted();
        Assert.IsTrue(EntryFinder.FindLatest('CG-X109-D5', ActivityEntry),
            'Expected the latest entry to be found before judging the cost');
        StatementsUsed := SessionInformation.SqlStatementsExecuted() - StatementsBefore;

        Assert.AreEqual(LatestEntryNo, ActivityEntry."Entry No.",
            'Expected the cheap lookup to still return the correct latest entry - the right answer first, then the right cost');
        Assert.IsTrue(StatementsUsed <= MaxStatements,
            StrSubstNo('Expected the lookup to stay within its cost budget of %1, but it measured %2 for a document with 200 entries', MaxStatements, StatementsUsed));
    end;
}
