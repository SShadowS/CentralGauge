codeunit 89304 "CG-AL-X110 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure CleanBatchPostsOneEntryPerOpenLine()
    var
        PostBatch: Codeunit "CG X110 Post Batch";
        Any: Codeunit Any;
        AmountA: Decimal;
        AmountB: Decimal;
    begin
        // [SCENARIO] A balanced three-line batch produces three ledger entries
        AmountA := Any.DecimalInRange(10, 500, 2);
        AmountB := Any.DecimalInRange(10, 500, 2);
        CreateLine('BATCH-01', 10, 'ACC-1', WorkDate(), AmountA);
        CreateLine('BATCH-01', 20, 'ACC-2', WorkDate(), AmountB);
        CreateLine('BATCH-01', 30, 'ACC-3', WorkDate(), -(AmountA + AmountB));

        PostBatch.PostBatch('BATCH-01');

        Assert.AreEqual(3, LedgerEntryCount('BATCH-01'),
            'Expected exactly one ledger entry per open line of the posted batch');
    end;

    [Test]
    procedure PostingCopiesTheLineFieldsToTheLedgerEntry()
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
        PostBatch: Codeunit "CG X110 Post Batch";
        Any: Codeunit Any;
        AccountNo: Code[20];
        PostingDate: Date;
        LineDescription: Text[50];
        LineAmount: Decimal;
    begin
        // [SCENARIO] Account No., Posting Date, Description, Amount and Batch Name travel from the line to the entry
        AccountNo := CopyStr('B2-' + UpperCase(Any.AlphabeticText(8)), 1, 20);
        PostingDate := Any.DateInRange(120);
        LineDescription := CopyStr(Any.AlphabeticText(30), 1, 50);
        LineAmount := Any.DecimalInRange(100, 900, 2);
        CreateLine('BATCH-02', 10, AccountNo, PostingDate, LineDescription, LineAmount);
        CreateLine('BATCH-02', 20, 'ACC-BAL', WorkDate(), -LineAmount);

        PostBatch.PostBatch('BATCH-02');

        LedgerEntry.SetRange("Account No.", AccountNo);
        Assert.IsTrue(LedgerEntry.FindFirst(),
            StrSubstNo('Expected a ledger entry carrying the posted line''s account %1', AccountNo));
        Assert.AreEqual(PostingDate, LedgerEntry."Posting Date",
            'Expected the line''s posting date on its ledger entry');
        Assert.AreEqual(LineDescription, LedgerEntry.Description,
            'Expected the line''s description on its ledger entry');
        Assert.AreEqual(LineAmount, LedgerEntry.Amount,
            'Expected the line''s amount on its ledger entry');
        Assert.AreEqual('BATCH-02', LedgerEntry."Batch Name",
            'Expected the batch name on the ledger entry');
    end;

    [Test]
    procedure EntryNumbersContinueAfterTheLastExistingEntry()
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
        PostBatch: Codeunit "CG X110 Post Batch";
        Any: Codeunit Any;
        SeedEntryNo: Integer;
        AmountA: Decimal;
    begin
        // [SCENARIO] New entry numbers pick up right after the highest entry already in the ledger
        SeedEntryNo := SeedLedgerEntry(Any.IntegerInRange(100, 900));
        AmountA := Any.DecimalInRange(10, 500, 2);
        CreateLine('BATCH-03', 10, 'ACC-1', WorkDate(), AmountA);
        CreateLine('BATCH-03', 20, 'ACC-2', WorkDate(), -AmountA);

        PostBatch.PostBatch('BATCH-03');

        LedgerEntry.SetRange("Batch Name", 'BATCH-03');
        Assert.AreEqual(2, LedgerEntry.Count(),
            'Expected exactly two new ledger entries for the batch');
        LedgerEntry.FindFirst();
        Assert.AreEqual(SeedEntryNo + 1, LedgerEntry."Entry No.",
            'Expected the first new entry number to continue right after the highest existing ledger entry');
        LedgerEntry.FindLast();
        Assert.AreEqual(SeedEntryNo + 2, LedgerEntry."Entry No.",
            'Expected the second new entry number to follow the first with no gap');
    end;

    [Test]
    procedure EntriesFollowLineNumberOrder()
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] Entries are numbered in ascending Line No. order, however the lines were inserted
        CreateLine('BATCH-04', 30, 'ACC-3', WorkDate(), 5);
        CreateLine('BATCH-04', 10, 'ACC-1', WorkDate(), 10);
        CreateLine('BATCH-04', 20, 'ACC-2', WorkDate(), -15);

        PostBatch.PostBatch('BATCH-04');

        LedgerEntry.SetRange("Batch Name", 'BATCH-04');
        Assert.AreEqual(3, LedgerEntry.Count(),
            'Expected exactly one ledger entry per open line of the posted batch');
        LedgerEntry.FindSet();
        Assert.AreEqual('ACC-1', LedgerEntry."Account No.",
            'Expected the lowest new entry number to carry line 10 - entries are created in ascending Line No. order');
        LedgerEntry.Next();
        Assert.AreEqual('ACC-2', LedgerEntry."Account No.",
            'Expected the middle entry number to carry line 20');
        LedgerEntry.Next();
        Assert.AreEqual('ACC-3', LedgerEntry."Account No.",
            'Expected the highest entry number to carry line 30');
    end;

    [Test]
    procedure PostingMarksEveryPostedLinePosted()
    var
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] A successful post flips every line to Posted and keeps the lines in the journal
        CreateLine('BATCH-05', 10, 'ACC-1', WorkDate(), 100);
        CreateLine('BATCH-05', 20, 'ACC-2', WorkDate(), -100);

        PostBatch.PostBatch('BATCH-05');

        Assert.AreEqual(2, LineCount('BATCH-05'),
            'Expected both journal lines to remain in the batch after posting - posting updates their status, it must not delete them');
        AssertAllLinesHaveStatus('BATCH-05', "CG X110 Journal Status"::Posted);
    end;

    [Test]
    procedure BlankAccountNoFailsTheWholeBatch()
    var
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] One line without an account fails the batch with the standard field-guard error
        CreateLine('BATCH-06', 10, 'ACC-1', WorkDate(), 100);
        CreateLine('BATCH-06', 20, '', WorkDate(), -100);
        Commit();

        asserterror PostBatch.PostBatch('BATCH-06');

        AssertErrorContains('Account No.');
        AssertErrorContains('must have a value');
        Assert.AreEqual(0, LedgerEntryCount('BATCH-06'),
            'Expected no ledger entries when a line fails the account guard - a failing batch must write nothing');
        AssertAllLinesHaveStatus('BATCH-06', "CG X110 Journal Status"::Open);
    end;

    [Test]
    procedure BlankPostingDateFailsTheWholeBatch()
    var
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] One line without a posting date fails the batch with the standard field-guard error
        CreateLine('BATCH-07', 10, 'ACC-1', WorkDate(), 100);
        CreateLine('BATCH-07', 20, 'ACC-2', 0D, -100);
        Commit();

        asserterror PostBatch.PostBatch('BATCH-07');

        AssertErrorContains('Posting Date');
        AssertErrorContains('must have a value');
        Assert.AreEqual(0, LedgerEntryCount('BATCH-07'),
            'Expected no ledger entries when a line fails the posting date guard - a failing batch must write nothing');
        AssertAllLinesHaveStatus('BATCH-07', "CG X110 Journal Status"::Open);
    end;

    [Test]
    procedure ZeroAmountLineFailsTheWholeBatch()
    var
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] A zero-amount line fails the batch even though the batch balances
        CreateLine('BATCH-08', 10, 'ACC-1', WorkDate(), 100);
        CreateLine('BATCH-08', 20, 'ACC-2', WorkDate(), -100);
        CreateLine('BATCH-08', 30, 'ACC-3', WorkDate(), 0);
        Commit();

        asserterror PostBatch.PostBatch('BATCH-08');

        AssertErrorContains('Amount');
        AssertErrorContains('must have a value');
        Assert.AreEqual(0, LedgerEntryCount('BATCH-08'),
            'Expected no ledger entries when a line fails the amount guard - a failing batch must write nothing');
        AssertAllLinesHaveStatus('BATCH-08', "CG X110 Journal Status"::Open);
    end;

    [Test]
    procedure UnbalancedShortBatchFailsWithOutOfBalanceError()
    var
        Any: Codeunit Any;
    begin
        // [SCENARIO] Open lines whose amounts sum below zero are rejected
        VerifyOutOfBalanceBatchFails('BATCH-09', -Any.IntegerInRange(1, 5000) / 100);
    end;

    [Test]
    procedure OneCentSurplusFailsWithOutOfBalanceError()
    begin
        // [SCENARIO] A surplus of a single cent is already enough to reject the batch
        VerifyOutOfBalanceBatchFails('BATCH-09B', 0.01);
    end;

    [Test]
    procedure EmptyBatchFailsWithNothingToPost()
    var
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] A batch with no lines at all is rejected
        asserterror PostBatch.PostBatch('BATCH-10');

        AssertErrorContains('nothing to post');
    end;

    [Test]
    procedure RepostingAFullyPostedBatchReportsNothingToPost()
    var
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] Posting a batch a second time, with no new lines added, leaves the ledger unchanged
        CreateLine('BATCH-11', 10, 'ACC-1', WorkDate(), 250);
        CreateLine('BATCH-11', 20, 'ACC-2', WorkDate(), -250);
        PostBatch.PostBatch('BATCH-11');
        Commit();

        asserterror PostBatch.PostBatch('BATCH-11');

        AssertErrorContains('nothing to post');
        Assert.AreEqual(2, LedgerEntryCount('BATCH-11'),
            'Expected the second posting attempt to create no duplicate ledger entries');
    end;

    [Test]
    procedure NewlyOpenedLinesPostWithoutDuplicatingAlreadyPostedOnes()
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] Lines added to a batch after it was posted are posted on their own, on the next run
        CreateLine('BATCH-12', 10, 'B12-A', WorkDate(), 60);
        CreateLine('BATCH-12', 20, 'B12-B', WorkDate(), -60);
        PostBatch.PostBatch('BATCH-12');
        CreateLine('BATCH-12', 30, 'B12-C', WorkDate(), 40);
        CreateLine('BATCH-12', 40, 'B12-D', WorkDate(), -40);

        PostBatch.PostBatch('BATCH-12');

        Assert.AreEqual(4, LedgerEntryCount('BATCH-12'),
            'Expected the second run to post only the two newly opened lines - already-posted lines must not produce ledger entries again');
        LedgerEntry.SetRange("Batch Name", 'BATCH-12');
        LedgerEntry.SetRange("Account No.", 'B12-A');
        Assert.AreEqual(1, LedgerEntry.Count(),
            'Expected the line posted in the first run to appear in the ledger exactly once');
        AssertAllLinesHaveStatus('BATCH-12', "CG X110 Journal Status"::Posted);
    end;

    [Test]
    procedure ABatchWithSomeAlreadyPostedLinesOnlyPostsItsOpenOnes()
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] A batch that already carries a posted line from an earlier run posts only its open lines now
        SeedPostedLineWithLedgerEntry('BATCH-14', 10, 'B14-OLD', WorkDate(), 500);
        CreateLine('BATCH-14', 20, 'B14-NEW1', WorkDate(), 200);
        CreateLine('BATCH-14', 30, 'B14-NEW2', WorkDate(), -200);

        PostBatch.PostBatch('BATCH-14');

        Assert.AreEqual(3, LedgerEntryCount('BATCH-14'),
            'Expected only the two open lines to gain a new ledger entry, on top of the one already carried by the previously posted line');
        LedgerEntry.SetRange("Batch Name", 'BATCH-14');
        LedgerEntry.SetRange("Account No.", 'B14-OLD');
        Assert.AreEqual(1, LedgerEntry.Count(),
            'Expected the previously posted line to still carry exactly one ledger entry');
        AssertAllLinesHaveStatus('BATCH-14', "CG X110 Journal Status"::Posted);
    end;

    [Test]
    procedure NewOpenLineForAPreviouslyPostedAccountStillGetsItsOwnEntry()
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] A newly opened line can legitimately reuse the account of a line posted in an earlier run - it must still post its own entry
        SeedPostedLineWithLedgerEntry('BATCH-15', 10, 'B15-OLD', WorkDate(), 500);
        CreateLine('BATCH-15', 20, 'B15-OLD', WorkDate(), 150);
        CreateLine('BATCH-15', 30, 'B15-NEW', WorkDate(), -150);

        PostBatch.PostBatch('BATCH-15');

        Assert.AreEqual(3, LedgerEntryCount('BATCH-15'),
            'Expected the batch to gain exactly one new ledger entry per currently open line, including an open line that shares an account with an already posted one');
        LedgerEntry.SetRange("Batch Name", 'BATCH-15');
        LedgerEntry.SetRange("Account No.", 'B15-OLD');
        Assert.AreEqual(2, LedgerEntry.Count(),
            'Expected the account to carry two ledger entries: the one from the earlier run, plus one new entry for the newly opened line - neither duplicated nor skipped');
        AssertAllLinesHaveStatus('BATCH-15', "CG X110 Journal Status"::Posted);
    end;

    [Test]
    procedure PostingScopesEveryCheckToTheGivenBatch()
    var
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] Posting one batch ignores a neighbour batch entirely
        // [GIVEN] the neighbour is deliberately unbalanced, so an unscoped balance check would fail loudly
        CreateLine('BATCH-13A', 10, 'ACC-1', WorkDate(), 90);
        CreateLine('BATCH-13A', 20, 'ACC-2', WorkDate(), -90);
        CreateLine('BATCH-13B', 10, 'ACC-3', WorkDate(), 77);

        PostBatch.PostBatch('BATCH-13A');

        Assert.AreEqual(2, LedgerEntryCount('BATCH-13A'),
            'Expected both lines of the posted batch in the ledger');
        Assert.AreEqual(0, LedgerEntryCount('BATCH-13B'),
            'Expected no ledger entries for the other batch - posting one batch must not touch another');
        AssertAllLinesHaveStatus('BATCH-13B', "CG X110 Journal Status"::Open);
    end;

    local procedure CreateLine(BatchName: Code[10]; LineNo: Integer; AccountNo: Code[20]; PostingDate: Date; LineAmount: Decimal)
    begin
        CreateLine(BatchName, LineNo, AccountNo, PostingDate, '', LineAmount);
    end;

    local procedure CreateLine(BatchName: Code[10]; LineNo: Integer; AccountNo: Code[20]; PostingDate: Date; LineDescription: Text[50]; LineAmount: Decimal)
    var
        JournalLine: Record "CG X110 Journal Line";
    begin
        JournalLine.Init();
        JournalLine."Batch Name" := BatchName;
        JournalLine."Line No." := LineNo;
        JournalLine."Account No." := AccountNo;
        JournalLine."Posting Date" := PostingDate;
        JournalLine.Description := LineDescription;
        JournalLine.Amount := LineAmount;
        JournalLine.Status := "CG X110 Journal Status"::Open;
        JournalLine.Insert();
    end;

    local procedure SeedPostedLineWithLedgerEntry(BatchName: Code[10]; LineNo: Integer; AccountNo: Code[20]; PostingDate: Date; LineAmount: Decimal)
    var
        JournalLine: Record "CG X110 Journal Line";
    begin
        JournalLine.Init();
        JournalLine."Batch Name" := BatchName;
        JournalLine."Line No." := LineNo;
        JournalLine."Account No." := AccountNo;
        JournalLine."Posting Date" := PostingDate;
        JournalLine.Amount := LineAmount;
        JournalLine.Status := "CG X110 Journal Status"::Posted;
        JournalLine.Insert();

        SeedLedgerEntryFor(BatchName, AccountNo, PostingDate, LineAmount);
    end;

    local procedure VerifyOutOfBalanceBatchFails(BatchName: Code[10]; Delta: Decimal)
    var
        PostBatch: Codeunit "CG X110 Post Batch";
        Any: Codeunit Any;
        AmountA: Decimal;
    begin
        // A whole-number base amount keeps the imbalance exactly Delta, so a
        // rounded or integer total would see the 0.01 case as balanced and post it.
        AmountA := Any.IntegerInRange(10, 500);
        CreateLine(BatchName, 10, 'ACC-1', WorkDate(), AmountA);
        CreateLine(BatchName, 20, 'ACC-2', WorkDate(), -AmountA + Delta);
        Commit();

        asserterror PostBatch.PostBatch(BatchName);

        AssertErrorContains('out of balance');
        AssertErrorContains(Format(Delta));
        Assert.AreEqual(0, LedgerEntryCount(BatchName),
            'Expected no ledger entries for an out-of-balance batch - a failing batch must write nothing');
        AssertAllLinesHaveStatus(BatchName, "CG X110 Journal Status"::Open);
    end;

    local procedure SeedLedgerEntry(Offset: Integer): Integer
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
        SeedEntryNo: Integer;
    begin
        if LedgerEntry.FindLast() then;
        SeedEntryNo := LedgerEntry."Entry No." + Offset;
        LedgerEntry.Init();
        LedgerEntry."Entry No." := SeedEntryNo;
        LedgerEntry."Account No." := 'SEED';
        LedgerEntry.Amount := 1;
        LedgerEntry.Insert();
        exit(SeedEntryNo);
    end;

    local procedure SeedLedgerEntryFor(BatchName: Code[10]; AccountNo: Code[20]; PostingDate: Date; LineAmount: Decimal): Integer
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
        NewEntryNo: Integer;
    begin
        if LedgerEntry.FindLast() then
            NewEntryNo := LedgerEntry."Entry No." + 1
        else
            NewEntryNo := 1;
        LedgerEntry.Init();
        LedgerEntry."Entry No." := NewEntryNo;
        LedgerEntry."Account No." := AccountNo;
        LedgerEntry."Posting Date" := PostingDate;
        LedgerEntry.Amount := LineAmount;
        LedgerEntry."Batch Name" := BatchName;
        LedgerEntry.Insert();
        exit(NewEntryNo);
    end;

    local procedure LedgerEntryCount(BatchName: Code[10]): Integer
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
    begin
        LedgerEntry.SetRange("Batch Name", BatchName);
        exit(LedgerEntry.Count());
    end;

    local procedure LineCount(BatchName: Code[10]): Integer
    var
        JournalLine: Record "CG X110 Journal Line";
    begin
        JournalLine.SetRange("Batch Name", BatchName);
        exit(JournalLine.Count());
    end;

    local procedure AssertAllLinesHaveStatus(BatchName: Code[10]; ExpectedStatus: Enum "CG X110 Journal Status")
    var
        JournalLine: Record "CG X110 Journal Line";
    begin
        JournalLine.SetRange("Batch Name", BatchName);
        if JournalLine.FindSet() then
            repeat
                Assert.AreEqual(Format(ExpectedStatus), Format(JournalLine.Status),
                    StrSubstNo('Expected line %1 of batch %2 to have status %3', JournalLine."Line No.", BatchName, ExpectedStatus));
            until JournalLine.Next() = 0;
    end;

    local procedure AssertErrorContains(Fragment: Text)
    var
        ActualError: Text;
    begin
        ActualError := GetLastErrorText();
        Assert.IsTrue(LowerCase(ActualError).Contains(LowerCase(Fragment)),
            StrSubstNo('Expected the posting error to contain "%1", got: %2', Fragment, ActualError));
    end;
}
