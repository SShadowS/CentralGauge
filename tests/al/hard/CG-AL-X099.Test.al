codeunit 89195 "CG-AL-X099 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods (see
    // tests/al/hard/CG-AL-X065.Test.al for the same note), so every test
    // clears the underlying tables of every module before seeding its own
    // rows. The session (Codeunit "CG X084 Total Mgt") itself needs no
    // explicit clear: each test declares its own local instance, which
    // always starts empty.

    local procedure ClearAll()
    var
        QueueEntry: Record "CG X069 Queue Entry";
        Source: Record "CG X069 Report Source";
        EntryDetail: Record "CG X084 Entry Detail";
        LedgerEntry: Record "CG X084 Ledger Entry";
        JnlLine: Record "CG X089 Journal Line";
        Item: Record "CG X089 Item";
        Adjustment: Record "CG X090 Adjustment";
        CaseRec: Record "CG X090 Case";
    begin
        QueueEntry.DeleteAll();
        Source.DeleteAll();
        EntryDetail.DeleteAll();
        LedgerEntry.DeleteAll();
        JnlLine.DeleteAll();
        Item.DeleteAll();
        Adjustment.DeleteAll();
        CaseRec.DeleteAll();
    end;

    // ---------------------------------------------------------------
    // Pending-reference queue helpers
    // ---------------------------------------------------------------

    local procedure EnqueueAnnual(SourceNo: Code[20]; PostingDate: Date)
    var
        Source: Record "CG X069 Report Source";
        Process: Codeunit "CG X069 Reference Process";
    begin
        Source.Init();
        Source."No." := SourceNo;
        Source."Report Type" := Source."Report Type"::Annual;
        Source."Posting Date" := PostingDate;
        Source.Insert(true);
        Process.EnqueueReference(Source);
    end;

    local procedure EnqueueQuarterly(SourceNo: Code[20]; PostingDate: Date)
    var
        Source: Record "CG X069 Report Source";
        Process: Codeunit "CG X069 Reference Process";
    begin
        Source.Init();
        Source."No." := SourceNo;
        Source."Report Type" := Source."Report Type"::Quarterly;
        Source."Posting Date" := PostingDate;
        Source.Insert(true);
        Process.EnqueueReference(Source);
    end;

    local procedure EnqueueAdhoc(SourceNo: Code[20]; PostingDate: Date)
    var
        Source: Record "CG X069 Report Source";
        Process: Codeunit "CG X069 Reference Process";
    begin
        Source.Init();
        Source."No." := SourceNo;
        Source."Report Type" := Source."Report Type"::Adhoc;
        Source."Posting Date" := PostingDate;
        Source.Insert(true);
        Process.EnqueueReference(Source);
    end;

    // ---------------------------------------------------------------
    // Session running-total helpers
    // ---------------------------------------------------------------

    local procedure AddDetailLine(EntryNo: Integer; LineNo: Integer; LineAmount: Decimal)
    var
        EntryDetail: Record "CG X084 Entry Detail";
    begin
        EntryDetail.Init();
        EntryDetail."Entry No." := EntryNo;
        EntryDetail."Line No." := LineNo;
        EntryDetail.Amount := LineAmount;
        EntryDetail.Description := 'Seed';
        EntryDetail.Insert();
    end;

    local procedure CreateLedgerEntry(EntryNo: Integer; DocNo: Code[20]; OriginalAmount: Decimal; RemainingAmount: Decimal)
    var
        LedgerEntry: Record "CG X084 Ledger Entry";
    begin
        LedgerEntry.Init();
        LedgerEntry."Entry No." := EntryNo;
        LedgerEntry."Document No." := DocNo;
        LedgerEntry."Posting Date" := WorkDate();
        LedgerEntry."Original Amount" := OriginalAmount;
        LedgerEntry.Insert();

        AddDetailLine(EntryNo, 10000, RemainingAmount);
    end;

    // ---------------------------------------------------------------
    // Batch valuation helpers
    // ---------------------------------------------------------------

    local procedure CreateItem(ItemNo: Code[20]; UnitPrice: Decimal)
    var
        Item: Record "CG X089 Item";
    begin
        Item.Init();
        Item."No." := ItemNo;
        Item.Description := ItemNo;
        Item."Unit Price" := UnitPrice;
        Item.Insert();
    end;

    local procedure AddLine(TemplateName: Code[10]; BatchName: Code[10]; ItemNo: Code[20]; Qty: Decimal; StampedUnitAmount: Decimal)
    var
        JnlLine: Record "CG X089 Journal Line";
    begin
        JnlLine.Init();
        JnlLine."Template Name" := TemplateName;
        JnlLine."Batch Name" := BatchName;
        JnlLine."Item No." := ItemNo;
        JnlLine.Quantity := Qty;
        JnlLine."Unit Amount" := StampedUnitAmount;
        JnlLine.Insert(true);
    end;

    local procedure GetValue(Totals: Dictionary of [Code[20], Decimal]; ItemNo: Code[20]): Decimal
    begin
        Assert.IsTrue(Totals.ContainsKey(ItemNo), StrSubstNo('Expected item %1 to appear in the valuation', ItemNo));
        exit(Totals.Get(ItemNo));
    end;

    // ---------------------------------------------------------------
    // Team totals report helpers
    // ---------------------------------------------------------------

    local procedure CreateCase(CaseNo: Code[20]; TeamCode: Code[20])
    var
        CaseRec: Record "CG X090 Case";
    begin
        CaseRec.Init();
        CaseRec."No." := CaseNo;
        CaseRec."Assigned Team" := TeamCode;
        CaseRec.Description := 'Seed';
        CaseRec.Insert();
    end;

    local procedure AddAdjustment(CaseNo: Code[20]; StampedTeamCode: Code[20]; AdjAmount: Decimal)
    var
        Adjustment: Record "CG X090 Adjustment";
    begin
        Adjustment.Init();
        Adjustment."Case No." := CaseNo;
        Adjustment."Team Code" := StampedTeamCode;
        Adjustment.Amount := AdjAmount;
        Adjustment.Insert(true);
    end;

    local procedure GetTotal(Totals: Dictionary of [Code[20], Decimal]; TeamCode: Code[20]): Decimal
    begin
        Assert.IsTrue(Totals.ContainsKey(TeamCode), StrSubstNo('Expected team %1 to appear in the report', TeamCode));
        exit(Totals.Get(TeamCode));
    end;

    // =================================================================
    // Pending-reference queue tests (distractor - correct on both sides)
    // =================================================================

    [Test]
    procedure NothingGenuinelyDueReturnsFalse()
    var
        Process: Codeunit "CG X069 Reference Process";
    begin
        ClearAll();
        EnqueueAnnual('S1', 20260901D); // after cutoff, not due
        EnqueueQuarterly('S2', 20261015D); // after cutoff, not due
        EnqueueAdhoc('S3', 20260101D); // well before cutoff, but wrong type

        Assert.IsFalse(
            Process.HasPendingReferenceUpToPeriodEnd(20260831D),
            'A period end with no genuinely due Annual/Quarterly reference must report nothing pending');
    end;

    [Test]
    procedure OneDueEntryAmongManyNotYetDueReturnsTrue()
    var
        Process: Codeunit "CG X069 Reference Process";
        i: Integer;
    begin
        ClearAll();
        for i := 1 to 5 do
            EnqueueAnnual(StrSubstNo('N%1', i), 20261101D); // future, not due
        EnqueueQuarterly('DUE', 20260615D); // due

        Assert.IsTrue(
            Process.HasPendingReferenceUpToPeriodEnd(20260831D),
            'A genuinely due reference among several not-yet-due entries must be reported as pending');
    end;

    [Test]
    procedure ExactCutoffDateCountsAsDue()
    var
        Process: Codeunit "CG X069 Reference Process";
    begin
        ClearAll();
        EnqueueAnnual('EDGE', 20260831D);

        Assert.IsTrue(
            Process.HasPendingReferenceUpToPeriodEnd(20260831D),
            'A reference dated exactly on the period end date must count as due');
    end;

    [Test]
    procedure DayAfterCutoffIsNotYetDue()
    var
        Process: Codeunit "CG X069 Reference Process";
    begin
        ClearAll();
        EnqueueAnnual('EDGE2', 20260901D);

        Assert.IsFalse(
            Process.HasPendingReferenceUpToPeriodEnd(20260831D),
            'A reference dated one day after the period end date must not count as due yet');
    end;

    [Test]
    procedure AdhocReferencesAreNeverReportedAsDue()
    var
        Process: Codeunit "CG X069 Reference Process";
    begin
        ClearAll();
        EnqueueAdhoc('ADH', 20260101D); // long overdue by date, but wrong type

        Assert.IsFalse(
            Process.HasPendingReferenceUpToPeriodEnd(20260831D),
            'An Adhoc reference must never be reported as a pending Annual/Quarterly obligation, however old its date');
    end;

    [Test]
    procedure UndatedSourceIsNeverReportedAsDue()
    var
        Process: Codeunit "CG X069 Reference Process";
    begin
        ClearAll();
        EnqueueAnnual('NODATE', 0D);

        Assert.IsFalse(
            Process.HasPendingReferenceUpToPeriodEnd(20260831D),
            'A reference whose source carries no posting date must not be treated as due');
    end;

    [Test]
    procedure RemovedReferenceIsNoLongerReportedAsDue()
    var
        QueueEntry: Record "CG X069 Queue Entry";
        Process: Codeunit "CG X069 Reference Process";
    begin
        ClearAll();
        EnqueueAnnual('REMOVED', 20260615D); // due, until it is processed off the queue

        QueueEntry.FindFirst();
        Process.RemoveReference(QueueEntry."Entry No.");

        Assert.IsFalse(
            Process.HasPendingReferenceUpToPeriodEnd(20260831D),
            'A reference already processed and removed from the queue must no longer be reported as pending');
    end;

    [Test]
    procedure PendingCheckCostDoesNotScaleWithQueueBacklog()
    var
        Process: Codeunit "CG X069 Reference Process";
        StmtBefore: BigInteger;
        StmtAfter: BigInteger;
        RowsBefore: BigInteger;
        RowsAfter: BigInteger;
        StmtDelta: BigInteger;
        RowsDelta: BigInteger;
        WarmResult: Boolean;
        Result: Boolean;
        i: Integer;
    begin
        ClearAll();

        // Warm-up: exercise the check once on a small, unrelated backlog so
        // first-touch metadata/plan loading lands outside the measurement
        // window below.
        EnqueueAnnual('WARM', 20260101D);
        WarmResult := Process.HasPendingReferenceUpToPeriodEnd(20251231D);
        Assert.IsFalse(WarmResult, 'A reference dated after the period end must not be reported as pending');
        ClearAll();

        // A 200-entry backlog where nothing is genuinely due as of the
        // cutoff below - the case that must be scanned in full and cannot
        // return early.
        for i := 1 to 200 do
            if i mod 2 = 0 then
                EnqueueAnnual(StrSubstNo('B%1', i), 20261201D)
            else
                EnqueueQuarterly(StrSubstNo('B%1', i), 20261201D);

        StmtBefore := SessionInformation.SqlStatementsExecuted;
        RowsBefore := SessionInformation.SqlRowsRead;

        Result := Process.HasPendingReferenceUpToPeriodEnd(20260831D);

        StmtAfter := SessionInformation.SqlStatementsExecuted;
        RowsAfter := SessionInformation.SqlRowsRead;
        StmtDelta := StmtAfter - StmtBefore;
        RowsDelta := RowsAfter - RowsBefore;

        Assert.IsFalse(Result, 'A 200-entry backlog with nothing genuinely due must still report nothing pending');
        Assert.IsTrue(
            StmtDelta <= 20,
            StrSubstNo('The check must not do work proportional to the queue backlog: statement budget %1, actual %2', 20, StmtDelta));
        Assert.IsTrue(
            RowsDelta <= 20,
            StrSubstNo('The check must not do work proportional to the queue backlog: rows budget %1, actual %2', 20, RowsDelta));
    end;

    // =================================================================
    // Session running-total tests (distractor - correct on both sides)
    // =================================================================

    [Test]
    procedure AddingASingleEntryPopulatesTheBufferWithItsRemainingAmount()
    var
        TotalMgt: Codeunit "CG X084 Total Mgt";
        Buffer: Record "CG X084 Total Buffer" temporary;
    begin
        ClearAll();
        CreateLedgerEntry(1, 'DOC1', 500, 500);

        TotalMgt.AddAppliedEntry(Buffer, 1);

        Assert.IsTrue(Buffer.Get(1), 'The entry just added must appear in the buffer');
        Assert.AreEqual('DOC1', Buffer."Document No.", 'The buffered row must carry the entry''s own document number');
        Assert.AreEqual(500, Buffer."Remaining Amount", 'The buffered row must carry the entry''s own remaining amount');
        Assert.AreEqual(1, TotalMgt.AppliedEntryCount(), 'One added entry must count as one');
    end;

    [Test]
    procedure AddingSeveralEntriesEachBufferRowReflectsThatEntrysOwnAmount()
    var
        TotalMgt: Codeunit "CG X084 Total Mgt";
        Buffer: Record "CG X084 Total Buffer" temporary;
    begin
        ClearAll();
        CreateLedgerEntry(1, 'DOC1', 100, 100);
        CreateLedgerEntry(2, 'DOC2', 250, 250);
        CreateLedgerEntry(3, 'DOC3', 75, 75);

        TotalMgt.AddAppliedEntry(Buffer, 1);
        TotalMgt.AddAppliedEntry(Buffer, 2);
        TotalMgt.AddAppliedEntry(Buffer, 3);

        Assert.IsTrue(Buffer.Get(1), 'Entry 1 must be in the buffer');
        Assert.AreEqual(100, Buffer."Remaining Amount", 'Entry 1''s buffered row must carry its own remaining amount');
        Assert.IsTrue(Buffer.Get(2), 'Entry 2 must be in the buffer');
        Assert.AreEqual(250, Buffer."Remaining Amount", 'Entry 2''s buffered row must carry its own remaining amount');
        Assert.IsTrue(Buffer.Get(3), 'Entry 3 must be in the buffer');
        Assert.AreEqual(75, Buffer."Remaining Amount", 'Entry 3''s buffered row must carry its own remaining amount');
        Assert.AreEqual(425, TotalMgt.GetBufferTotal(Buffer), 'The running total must equal the sum of every applied entry''s remaining amount');
    end;

    [Test]
    procedure TheBufferedAmountReflectsTheEntrysActualRemainingAmountNotItsOriginalAmount()
    var
        TotalMgt: Codeunit "CG X084 Total Mgt";
        Buffer: Record "CG X084 Total Buffer" temporary;
    begin
        // Original Amount and Remaining Amount deliberately disagree here: an
        // implementation that takes a shortcut and copies the entry's
        // original amount into the buffer, instead of the entry's own
        // currently remaining amount, must be caught by this test.
        ClearAll();
        CreateLedgerEntry(1, 'DOC1', 500, 350);

        TotalMgt.AddAppliedEntry(Buffer, 1);

        Assert.IsTrue(Buffer.Get(1), 'The entry just added must appear in the buffer');
        Assert.AreEqual(350, Buffer."Remaining Amount", 'The buffered row must reflect the entry''s own currently remaining amount, not a copy of its original amount');
    end;

    [Test]
    procedure RemovingAnAppliedEntryDropsItFromTheBufferAndLeavesOthersUntouched()
    var
        TotalMgt: Codeunit "CG X084 Total Mgt";
        Buffer: Record "CG X084 Total Buffer" temporary;
    begin
        ClearAll();
        CreateLedgerEntry(1, 'DOC1', 100, 100);
        CreateLedgerEntry(2, 'DOC2', 250, 250);
        CreateLedgerEntry(3, 'DOC3', 75, 75);

        TotalMgt.AddAppliedEntry(Buffer, 1);
        TotalMgt.AddAppliedEntry(Buffer, 2);
        TotalMgt.AddAppliedEntry(Buffer, 3);

        TotalMgt.RemoveAppliedEntry(Buffer, 2);

        Assert.IsFalse(Buffer.Get(2), 'A removed entry must no longer appear in the buffer');
        Assert.IsTrue(Buffer.Get(1), 'An entry that was not removed must remain in the buffer');
        Assert.AreEqual(100, Buffer."Remaining Amount", 'An entry untouched by the removal must keep its own remaining amount');
        Assert.IsTrue(Buffer.Get(3), 'An entry that was not removed must remain in the buffer');
        Assert.AreEqual(75, Buffer."Remaining Amount", 'An entry untouched by the removal must keep its own remaining amount');
        Assert.AreEqual(175, TotalMgt.GetBufferTotal(Buffer), 'The running total must exclude the removed entry');
        Assert.AreEqual(2, TotalMgt.AppliedEntryCount(), 'The session must track exactly the entries still applied after a removal');
    end;

    [Test]
    procedure ReAddingAnEntryAlreadyInTheSessionRefreshesItsAmountWithoutDuplicating()
    var
        TotalMgt: Codeunit "CG X084 Total Mgt";
        Buffer: Record "CG X084 Total Buffer" temporary;
        BufferCount: Integer;
    begin
        ClearAll();
        CreateLedgerEntry(1, 'DOC1', 300, 200);

        TotalMgt.AddAppliedEntry(Buffer, 1);
        Assert.AreEqual(200, Buffer."Remaining Amount", 'The first add must show the entry''s remaining amount at that time');

        // The entry's remaining amount changes after it was first added
        // (further consumption is recorded against it), then it is touched
        // again without ever being removed first.
        AddDetailLine(1, 20000, -80);
        TotalMgt.AddAppliedEntry(Buffer, 1);

        Buffer.Reset();
        BufferCount := 0;
        if Buffer.FindSet() then
            repeat
                BufferCount += 1;
            until Buffer.Next() = 0;
        Assert.AreEqual(1, BufferCount, 'Touching the same entry twice must not leave more than one buffered row for it');

        Assert.IsTrue(Buffer.Get(1), 'The entry must still be in the buffer');
        Assert.AreEqual(120, Buffer."Remaining Amount", 'Touching the entry again must refresh its buffered amount to the entry''s current remaining amount, not keep the stale value');
        Assert.AreEqual(1, TotalMgt.AppliedEntryCount(), 'Touching an already-applied entry again must not count it twice');
    end;

    [Test]
    procedure AnUnrelatedLedgerEntryNeverAddedToTheSessionIsNeverTouched()
    var
        TotalMgt: Codeunit "CG X084 Total Mgt";
        Buffer: Record "CG X084 Total Buffer" temporary;
        LedgerEntry: Record "CG X084 Ledger Entry";
    begin
        ClearAll();
        CreateLedgerEntry(999, 'UNTOUCHED', 777.77, 777.77);
        CreateLedgerEntry(1, 'DOC1', 100, 100);

        TotalMgt.AddAppliedEntry(Buffer, 1);

        Assert.IsFalse(Buffer.Get(999), 'An entry that was never added to the session must never appear in the buffer');
        LedgerEntry.Get(999);
        Assert.AreEqual(777.77, LedgerEntry."Original Amount", 'An entry outside the session must keep its own stored amount untouched');
    end;

    [Test]
    procedure ResetClearsTheSessionSoAddedEntriesCanBeCountedAgainFromZero()
    var
        TotalMgt: Codeunit "CG X084 Total Mgt";
        Buffer: Record "CG X084 Total Buffer" temporary;
    begin
        ClearAll();
        CreateLedgerEntry(1, 'DOC1', 100, 100);
        CreateLedgerEntry(2, 'DOC2', 200, 200);

        TotalMgt.AddAppliedEntry(Buffer, 1);
        Assert.AreEqual(1, TotalMgt.AppliedEntryCount(), 'One entry added must count as one');

        TotalMgt.Reset();
        Buffer.Reset();
        Buffer.DeleteAll();

        Assert.AreEqual(0, TotalMgt.AppliedEntryCount(), 'Resetting the session must clear the applied-entry count back to zero');

        TotalMgt.AddAppliedEntry(Buffer, 2);
        Assert.AreEqual(1, TotalMgt.AppliedEntryCount(), 'A fresh session must count only what has been added since the reset');
        Assert.IsFalse(Buffer.Get(1), 'A session reset must not carry the previous session''s entries forward');
        Assert.IsTrue(Buffer.Get(2), 'The entry added after the reset must be in the buffer');
    end;

    [Test]
    procedure AddingOneMoreEntryToALargeSessionCostsWorkIndependentOfSessionSize()
    var
        TotalMgt: Codeunit "CG X084 Total Mgt";
        Buffer: Record "CG X084 Total Buffer" temporary;
        StmtBefore: BigInteger;
        StmtAfter: BigInteger;
        RowsBefore: BigInteger;
        RowsAfter: BigInteger;
        StmtDelta: BigInteger;
        RowsDelta: BigInteger;
        ExpectedTotal: Decimal;
        i: Integer;
    begin
        ClearAll();

        // Warm-up: exercise AddAppliedEntry once on a small, unrelated
        // session so first-touch metadata/plan loading lands outside the
        // measurement window below.
        CreateLedgerEntry(9000, 'WARM', 10, 10);
        TotalMgt.AddAppliedEntry(Buffer, 9000);
        TotalMgt.Reset();
        Buffer.Reset();
        Buffer.DeleteAll();
        ClearAll();

        // A session where 200 entries have already been applied - the
        // backlog that must NOT make touching the next entry any more
        // expensive than touching the first one was.
        ExpectedTotal := 0;
        for i := 1 to 200 do begin
            CreateLedgerEntry(i, StrSubstNo('B%1', i), i, i);
            TotalMgt.AddAppliedEntry(Buffer, i);
            ExpectedTotal += i;
        end;

        CreateLedgerEntry(201, 'NEW', 500, 42);

        StmtBefore := SessionInformation.SqlStatementsExecuted;
        RowsBefore := SessionInformation.SqlRowsRead;

        TotalMgt.AddAppliedEntry(Buffer, 201);

        StmtAfter := SessionInformation.SqlStatementsExecuted;
        RowsAfter := SessionInformation.SqlRowsRead;
        StmtDelta := StmtAfter - StmtBefore;
        RowsDelta := RowsAfter - RowsBefore;
        ExpectedTotal += 42;

        Assert.IsTrue(Buffer.Get(201), 'The newly entered entry must appear in the buffer');
        Assert.AreEqual(42, Buffer."Remaining Amount", 'The newly entered entry must show its own correct remaining amount');
        Assert.AreEqual(ExpectedTotal, TotalMgt.GetBufferTotal(Buffer), 'The running total must include the newly entered entry on top of the 200 already applied');
        Assert.IsTrue(
            StmtDelta <= 20,
            StrSubstNo('Adding one more entry must not cost work proportional to how many entries are already in the session: statement budget %1, actual %2', 20, StmtDelta));
        Assert.IsTrue(
            RowsDelta <= 20,
            StrSubstNo('Adding one more entry must not cost work proportional to how many entries are already in the session: rows budget %1, actual %2', 20, RowsDelta));
    end;

    // =================================================================
    // Batch valuation tests (live symptom - fails on the starter app)
    // =================================================================

    [Test]
    procedure SumsAllLinesOfOneItemIntoOneTotal()
    var
        BatchValuation: Codeunit "CG X089 Batch Valuation";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateItem('CGX89-A', 12.5);
        AddLine('CGXT1', 'CGXB1', 'CGX89-A', 3, 12.5);
        AddLine('CGXT1', 'CGXB1', 'CGX89-A', 2, 12.5);
        AddLine('CGXT1', 'CGXB1', 'CGX89-A', 4, 12.5);

        Totals := BatchValuation.ValueByItem('CGXT1', 'CGXB1');

        Assert.AreEqual(9 * 12.5, GetValue(Totals, 'CGX89-A'),
            'Expected the item''s value to add up quantity times unit price across every line of the batch');
    end;

    [Test]
    procedure KeepsEachItemsValueSeparate()
    var
        BatchValuation: Codeunit "CG X089 Batch Valuation";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateItem('CGX89-A', 10);
        CreateItem('CGX89-B', 250);
        AddLine('CGXT2', 'CGXB2', 'CGX89-A', 4, 10);
        AddLine('CGXT2', 'CGXB2', 'CGX89-B', 3, 250);

        Totals := BatchValuation.ValueByItem('CGXT2', 'CGXB2');

        Assert.AreEqual(40, GetValue(Totals, 'CGX89-A'), 'Expected item A''s value to be built only from item A''s own lines and price');
        Assert.AreEqual(750, GetValue(Totals, 'CGX89-B'), 'Expected item B''s value to be built only from item B''s own lines and price');
    end;

    [Test]
    procedure NegativeQuantityReducesTheValue()
    var
        BatchValuation: Codeunit "CG X089 Batch Valuation";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateItem('CGX89-A', 20);
        AddLine('CGXT3', 'CGXB3', 'CGX89-A', 8, 20);
        AddLine('CGXT3', 'CGXB3', 'CGX89-A', -3, 20);

        Totals := BatchValuation.ValueByItem('CGXT3', 'CGXB3');

        Assert.AreEqual(100, GetValue(Totals, 'CGX89-A'), 'Expected the negative quantity (an outbound adjustment) to reduce the item''s value, not to be skipped');
    end;

    [Test]
    procedure UsesTheItemCardPriceNotTheLineStamp()
    var
        BatchValuation: Codeunit "CG X089 Batch Valuation";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateItem('CGX89-A', 500);
        AddLine('CGXT4', 'CGXB4', 'CGX89-A', 2, 50);

        Totals := BatchValuation.ValueByItem('CGXT4', 'CGXB4');

        Assert.AreEqual(1000, GetValue(Totals, 'CGX89-A'),
            'Expected the value at the item''s current price - a different value stamped on the line itself must be ignored');
    end;

    [Test]
    procedure LinesOutsideTheBatchAreNotCounted()
    var
        BatchValuation: Codeunit "CG X089 Batch Valuation";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateItem('CGX89-A', 10);
        AddLine('CGXT5', 'CGXB5', 'CGX89-A', 5, 10);
        AddLine('CGXT5', 'CGXB5X', 'CGX89-A', 7, 10);
        AddLine('CGXT5X', 'CGXB5', 'CGX89-A', 9, 10);

        Totals := BatchValuation.ValueByItem('CGXT5', 'CGXB5');

        Assert.AreEqual(1, Totals.Count(), 'Expected exactly one item in the valuation - the other lines belong to a different template or a different batch');
        Assert.AreEqual(50, GetValue(Totals, 'CGX89-A'), 'Expected the value to be built only from lines matching both the template name and the batch name');
    end;

    [Test]
    procedure EveryItemAppearsExactlyOnce()
    var
        BatchValuation: Codeunit "CG X089 Batch Valuation";
        Totals: Dictionary of [Code[20], Decimal];
        ItemNo: Code[20];
        i: Integer;
    begin
        ClearAll();
        for i := 1 to 6 do begin
            ItemNo := CopyStr(StrSubstNo('CGX89-M%1', i), 1, MaxStrLen(ItemNo));
            CreateItem(ItemNo, 10);
            AddLine('CGXT6', 'CGXB6', ItemNo, 1, 10);
            AddLine('CGXT6', 'CGXB6', ItemNo, 2, 10);
        end;

        Totals := BatchValuation.ValueByItem('CGXT6', 'CGXB6');

        Assert.AreEqual(6, Totals.Count(), 'Expected exactly one entry per distinct item, however many lines that item has');
        for i := 1 to 6 do begin
            ItemNo := CopyStr(StrSubstNo('CGX89-M%1', i), 1, MaxStrLen(ItemNo));
            Assert.AreEqual(30, GetValue(Totals, ItemNo), StrSubstNo('Expected item %1 to appear once with both its lines added together', ItemNo));
        end;
    end;

    [Test]
    procedure ItemWithoutLinesDoesNotAppear()
    var
        BatchValuation: Codeunit "CG X089 Batch Valuation";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateItem('CGX89-A', 10);
        CreateItem('CGX89-B', 20);
        AddLine('CGXT7', 'CGXB7', 'CGX89-A', 5, 10);

        Totals := BatchValuation.ValueByItem('CGXT7', 'CGXB7');

        Assert.IsFalse(Totals.ContainsKey('CGX89-B'), 'Expected an item that sits on no line of the batch to stay out of the valuation - the master record alone earns no entry');
        Assert.AreEqual(1, Totals.Count(), 'Expected only the item that actually appears on the batch''s lines');
    end;

    [Test]
    procedure ZeroPriceItemAppearsWithZeroValue()
    var
        BatchValuation: Codeunit "CG X089 Batch Valuation";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateItem('CGX89-A', 0);
        AddLine('CGXT8', 'CGXB8', 'CGX89-A', 5, 123.45);

        Totals := BatchValuation.ValueByItem('CGXT8', 'CGXB8');

        Assert.IsTrue(Totals.ContainsKey('CGX89-A'), 'Expected the item to stay in the valuation even though its current price is 0');
        Assert.AreEqual(0, GetValue(Totals, 'CGX89-A'), 'Expected a value of exactly 0 for a zero-price item - the non-zero amount stamped on the line must not step in');
    end;

    [Test]
    procedure EmptyBatchReturnsEmpty()
    var
        BatchValuation: Codeunit "CG X089 Batch Valuation";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateItem('CGX89-A', 10);

        Totals := BatchValuation.ValueByItem('CGXTE', 'CGXBE');

        Assert.AreEqual(0, Totals.Count(), 'Expected an empty valuation and no error for a batch with no lines at all');
    end;

    [Test]
    procedure PriceChangedBeforeTheNextCallIsPickedUp()
    var
        BatchValuation: Codeunit "CG X089 Batch Valuation";
        Item: Record "CG X089 Item";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateItem('CGX89-A', 15);
        AddLine('CGXT10', 'CGXB10', 'CGX89-A', 4, 15);

        // first call on the very same codeunit variable primes any cache a submission keeps across calls
        BatchValuation.ValueByItem('CGXT10', 'CGXB10');
        Item.Get('CGX89-A');
        Item."Unit Price" := 200;
        Item.Modify();

        Totals := BatchValuation.ValueByItem('CGXT10', 'CGXB10');

        Assert.AreEqual(800, GetValue(Totals, 'CGX89-A'),
            'Expected the second call to value the batch at the item''s new current price - a price remembered from an earlier call must not step in');
    end;

    [Test]
    procedure ValuingALargeBatchCostsTheSameHoweverManyDistinctItemsItTouches()
    var
        BatchValuation: Codeunit "CG X089 Batch Valuation";
        Totals: Dictionary of [Code[20], Decimal];
        ItemNo: Code[20];
        ItemCount: Integer;
        StmtBefore: BigInteger;
        StmtAfter: BigInteger;
        StmtDelta: BigInteger;
        i: Integer;
    begin
        ClearAll();

        // Warm-up: exercise the procedure once on a small, unrelated batch so
        // first-touch metadata/plan loading lands outside the measurement
        // window below.
        CreateItem('CGX89-WARM', 5);
        AddLine('CGXTW', 'CGXBW', 'CGX89-WARM', 1, 5);
        BatchValuation.ValueByItem('CGXTW', 'CGXBW');
        ClearAll();

        // 200 distinct items, each on its own line - the case that must not
        // cost work proportional to how many distinct items the batch touches.
        // Every distinct item's price must appear in the returned dictionary,
        // so any correct implementation reads at least 200 item rows here -
        // row count cannot separate a bulk fetch from a per-item one. The
        // number of ROUND TRIPS to get there is what must stay flat, so only
        // the SQL statement count is budgeted below.
        ItemCount := 200;
        for i := 1 to ItemCount do begin
            ItemNo := CopyStr(StrSubstNo('CGX89-B%1', i), 1, MaxStrLen(ItemNo));
            CreateItem(ItemNo, 10);
            AddLine('CGXT9', 'CGXB9', ItemNo, 2, 10);
        end;

        StmtBefore := SessionInformation.SqlStatementsExecuted;

        Totals := BatchValuation.ValueByItem('CGXT9', 'CGXB9');

        StmtAfter := SessionInformation.SqlStatementsExecuted;
        StmtDelta := StmtAfter - StmtBefore;

        Assert.AreEqual(ItemCount, Totals.Count(),
            StrSubstNo('Expected every one of the %1 items in the valuation before judging the cost', ItemCount));
        Assert.AreEqual(20, GetValue(Totals, 'CGX89-B1'), 'Expected the low-cost valuation to still carry the real numbers');
        Assert.IsTrue(
            StmtDelta <= 20,
            StrSubstNo('Expected the valuation''s SQL statement cost to stay flat no matter how many distinct items the batch touches: budget %1, actual %2 for %3 distinct items', 20, StmtDelta, ItemCount));
    end;

    // =================================================================
    // Team totals report tests (distractor - correct on both sides)
    // =================================================================

    [Test]
    procedure SumsAdjustmentsAcrossAllCasesOfOneTeam()
    var
        TotalsReport: Codeunit "CG X090 Totals Report";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateCase('C1', 'TEAM-A');
        CreateCase('C2', 'TEAM-A');
        AddAdjustment('C1', 'TEAM-A', 100);
        AddAdjustment('C1', 'TEAM-A', 50);
        AddAdjustment('C2', 'TEAM-A', 25);

        Totals := TotalsReport.TotalsByTeam('TEAM-A');

        Assert.AreEqual(175, GetTotal(Totals, 'TEAM-A'),
            'Expected the team''s total to add up every adjustment of every case assigned to it');
    end;

    [Test]
    procedure KeepsEachTeamsTotalSeparate()
    var
        TotalsReport: Codeunit "CG X090 Totals Report";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateCase('C1', 'TEAM-B1');
        CreateCase('C2', 'TEAM-B2');
        AddAdjustment('C1', 'TEAM-B1', 60);
        AddAdjustment('C2', 'TEAM-B2', 90);

        Totals := TotalsReport.TotalsByTeam('TEAM-B*');

        Assert.AreEqual(60, GetTotal(Totals, 'TEAM-B1'),
            'Expected team B1''s total to contain only adjustments of B1''s own cases');
        Assert.AreEqual(90, GetTotal(Totals, 'TEAM-B2'),
            'Expected team B2''s total to contain only adjustments of B2''s own cases');
    end;

    [Test]
    procedure NegativeAdjustmentsReduceTheTotal()
    var
        TotalsReport: Codeunit "CG X090 Totals Report";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateCase('C1', 'TEAM-C');
        AddAdjustment('C1', 'TEAM-C', 500);
        AddAdjustment('C1', 'TEAM-C', -120);

        Totals := TotalsReport.TotalsByTeam('TEAM-C');

        Assert.AreEqual(380, GetTotal(Totals, 'TEAM-C'),
            'Expected a negative adjustment to reduce the team''s total, not be skipped');
    end;

    [Test]
    procedure CaseWithNoAdjustmentsAppearsWithZero()
    var
        TotalsReport: Codeunit "CG X090 Totals Report";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateCase('C1', 'TEAM-D');

        Totals := TotalsReport.TotalsByTeam('TEAM-D');

        Assert.IsTrue(Totals.ContainsKey('TEAM-D'),
            'Expected the team to stay in the report even though its case has no adjustments at all');
        Assert.AreEqual(0, GetTotal(Totals, 'TEAM-D'),
            'Expected a total of exactly 0 for a team whose case has no adjustments');
    end;

    [Test]
    procedure GroupsByTheCasesCurrentTeamNotTheAdjustmentStamp()
    var
        CaseRec: Record "CG X090 Case";
        TotalsReport: Codeunit "CG X090 Totals Report";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateCase('C1', 'TEAM-E1');
        CreateCase('C2', 'TEAM-E2');
        // The adjustment on C1 is stamped with a different team than C1's own
        // current assignment - the stamp must be ignored in favor of the case.
        AddAdjustment('C1', 'TEAM-E2', 300);

        // C3 starts on TEAM-E2 with its stamp matching that team at the time
        // the adjustment was recorded, then gets reassigned afterward - a
        // total computed once at recording time and never revisited would
        // still show it under TEAM-E2.
        CreateCase('C3', 'TEAM-E2');
        AddAdjustment('C3', 'TEAM-E2', 300);
        CaseRec.Get('C3');
        CaseRec."Assigned Team" := 'TEAM-E1';
        CaseRec.Modify();

        Totals := TotalsReport.TotalsByTeam('TEAM-E*');

        Assert.AreEqual(600, GetTotal(Totals, 'TEAM-E1'),
            'Expected the amount under the team each case is currently assigned to - both the adjustment whose own stamp points elsewhere, and the case reassigned after its adjustment was recorded, must be ignored in favor of the case''s current team');
        Assert.AreEqual(0, GetTotal(Totals, 'TEAM-E2'),
            'Expected 0 for the team neither case is currently assigned to - a stale stamp or a team a case was reassigned away from must not attract the amount');
    end;

    [Test]
    procedure CasesOutsideTheFilterAreNotCounted()
    var
        TotalsReport: Codeunit "CG X090 Totals Report";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateCase('C1', 'TEAM-F1');
        CreateCase('C2', 'TEAM-F2');
        AddAdjustment('C1', 'TEAM-F1', 40);
        AddAdjustment('C2', 'TEAM-F2', 999);

        Totals := TotalsReport.TotalsByTeam('TEAM-F1');

        Assert.AreEqual(1, Totals.Count(),
            'Expected only the team matching the filter to appear in the report');
        Assert.AreEqual(40, GetTotal(Totals, 'TEAM-F1'),
            'Expected the total to be built only from cases inside the filter');
    end;

    [Test]
    procedure EveryTeamAppearsExactlyOnce()
    var
        TotalsReport: Codeunit "CG X090 Totals Report";
        Totals: Dictionary of [Code[20], Decimal];
        TeamCode: Code[20];
        i: Integer;
    begin
        ClearAll();
        for i := 1 to 6 do begin
            TeamCode := CopyStr(StrSubstNo('TEAM-G%1', i), 1, MaxStrLen(TeamCode));
            CreateCase(CopyStr(StrSubstNo('C%1A', i), 1, 20), TeamCode);
            CreateCase(CopyStr(StrSubstNo('C%1B', i), 1, 20), TeamCode);
            AddAdjustment(CopyStr(StrSubstNo('C%1A', i), 1, 20), TeamCode, 10);
            AddAdjustment(CopyStr(StrSubstNo('C%1B', i), 1, 20), TeamCode, 10);
        end;

        Totals := TotalsReport.TotalsByTeam('TEAM-G*');

        Assert.AreEqual(6, Totals.Count(),
            'Expected exactly one row per team - 6 teams were seeded, each with two cases');
        for i := 1 to 6 do begin
            TeamCode := CopyStr(StrSubstNo('TEAM-G%1', i), 1, MaxStrLen(TeamCode));
            Assert.AreEqual(20, GetTotal(Totals, TeamCode),
                StrSubstNo('Expected team %1 to appear with the sum of both of its cases', TeamCode));
        end;
    end;

    [Test]
    procedure ReturnsEmptyWhenNoCaseMatches()
    var
        TotalsReport: Codeunit "CG X090 Totals Report";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateCase('C1', 'TEAM-H');

        Totals := TotalsReport.TotalsByTeam('TEAM-NOMATCH');

        Assert.AreEqual(0, Totals.Count(),
            'Expected an empty report when no case matches the filter');
    end;

    [Test]
    procedure RepeatedCallsReflectAdjustmentsAddedInBetween()
    var
        TotalsReport: Codeunit "CG X090 Totals Report";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateCase('C1', 'TEAM-I');
        AddAdjustment('C1', 'TEAM-I', 100);

        Totals := TotalsReport.TotalsByTeam('TEAM-I');
        Assert.AreEqual(100, GetTotal(Totals, 'TEAM-I'),
            'Expected the first call to reflect the one adjustment recorded so far');

        AddAdjustment('C1', 'TEAM-I', 50);
        Totals := TotalsReport.TotalsByTeam('TEAM-I');
        Assert.AreEqual(150, GetTotal(Totals, 'TEAM-I'),
            'Expected a second call with the same filter to include an adjustment recorded after the first call, not repeat the first call''s total');
    end;

    [Test]
    procedure TotalsCostDoesNotScaleWithCaseCount()
    var
        TotalsReport: Codeunit "CG X090 Totals Report";
        Totals: Dictionary of [Code[20], Decimal];
        StmtBefore: BigInteger;
        StmtAfter: BigInteger;
        RowsBefore: BigInteger;
        RowsAfter: BigInteger;
        StmtDelta: BigInteger;
        RowsDelta: BigInteger;
        TeamCode: Code[20];
        CaseNo: Code[20];
        TeamIndex: Integer;
        CaseIndex: Integer;
    begin
        ClearAll();

        // Warm-up: exercise the report once on a small, unrelated team so
        // first-touch metadata/plan loading lands outside the measurement
        // window below.
        CreateCase('WARM', 'TEAM-WARM');
        AddAdjustment('WARM', 'TEAM-WARM', 1);
        TotalsReport.TotalsByTeam('TEAM-WARM');
        ClearAll();

        // 10 teams with 20 cases each (200 cases total, one adjustment per
        // case) - a backlog that must be answered without visiting each
        // matching case's adjustments one at a time.
        for TeamIndex := 1 to 10 do begin
            TeamCode := CopyStr(StrSubstNo('TEAM-P%1', TeamIndex), 1, MaxStrLen(TeamCode));
            for CaseIndex := 1 to 20 do begin
                CaseNo := CopyStr(StrSubstNo('P%1-%2', TeamIndex, CaseIndex), 1, MaxStrLen(CaseNo));
                CreateCase(CaseNo, TeamCode);
                AddAdjustment(CaseNo, TeamCode, 10);
            end;
        end;

        StmtBefore := SessionInformation.SqlStatementsExecuted;
        RowsBefore := SessionInformation.SqlRowsRead;

        Totals := TotalsReport.TotalsByTeam('TEAM-P*');

        StmtAfter := SessionInformation.SqlStatementsExecuted;
        RowsAfter := SessionInformation.SqlRowsRead;
        StmtDelta := StmtAfter - StmtBefore;
        RowsDelta := RowsAfter - RowsBefore;

        Assert.AreEqual(10, Totals.Count(),
            'Expected every one of the 10 teams in the report before judging the cost');
        Assert.AreEqual(200, GetTotal(Totals, 'TEAM-P1'),
            'Expected the low-cost report to still carry the real sums - 20 cases of 10 each for team P1');
        Assert.IsTrue(
            StmtDelta <= 20,
            StrSubstNo('The report must not do work proportional to how many cases match: statement budget %1, actual %2', 20, StmtDelta));
        Assert.IsTrue(
            RowsDelta <= 20,
            StrSubstNo('The report must not do work proportional to how many cases match: rows budget %1, actual %2', 20, RowsDelta));
    end;
}
