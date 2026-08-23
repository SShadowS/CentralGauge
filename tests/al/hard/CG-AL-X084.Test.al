codeunit 88837 "CG-AL-X084 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods (see
    // tests/al/hard/CG-AL-X065.Test.al for the same note), so every test
    // clears the underlying tables before seeding its own rows. The session
    // (Codeunit "CG X084 Total Mgt") itself needs no explicit clear: each
    // test declares its own local instance, which always starts empty.

    local procedure ClearAll()
    var
        LedgerEntry: Record "CG X084 Ledger Entry";
        EntryDetail: Record "CG X084 Entry Detail";
    begin
        EntryDetail.DeleteAll();
        LedgerEntry.DeleteAll();
    end;

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
}
