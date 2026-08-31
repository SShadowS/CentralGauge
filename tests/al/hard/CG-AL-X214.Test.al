codeunit 89436 "CG-AL-X214 Test"
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
        // The default test isolation persists writes between test methods
        // (measured 2026-08-20, SOAP runner), so every test clears both tables
        // before seeding its own rows.

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
    // X110 - donor CG-AL-X110
    // ==========================================================

    [Test]
    procedure X110_CleanBatchPostsOneEntryPerOpenLine()
    var
        PostBatch: Codeunit "CG X110 Post Batch";
        Any: Codeunit Any;
        AmountA: Decimal;
        AmountB: Decimal;
    begin
        // [SCENARIO] A balanced three-line batch produces three ledger entries
        AmountA := Any.DecimalInRange(10, 500, 2);
        AmountB := Any.DecimalInRange(10, 500, 2);
        X110_CreateLine('BATCH-01', 10, 'ACC-1', WorkDate(), AmountA);
        X110_CreateLine('BATCH-01', 20, 'ACC-2', WorkDate(), AmountB);
        X110_CreateLine('BATCH-01', 30, 'ACC-3', WorkDate(), -(AmountA + AmountB));

        PostBatch.PostBatch('BATCH-01');

        Assert.AreEqual(3, X110_LedgerEntryCount('BATCH-01'),
            'Expected exactly one ledger entry per open line of the posted batch');
    end;

    [Test]
    procedure X110_PostingCopiesTheLineFieldsToTheLedgerEntry()
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
        X110_CreateLine('BATCH-02', 10, AccountNo, PostingDate, LineDescription, LineAmount);
        X110_CreateLine('BATCH-02', 20, 'ACC-BAL', WorkDate(), -LineAmount);

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
    procedure X110_EntryNumbersContinueAfterTheLastExistingEntry()
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
        PostBatch: Codeunit "CG X110 Post Batch";
        Any: Codeunit Any;
        SeedEntryNo: Integer;
        AmountA: Decimal;
    begin
        // [SCENARIO] New entry numbers pick up right after the highest entry already in the ledger
        SeedEntryNo := X110_SeedLedgerEntry(Any.IntegerInRange(100, 900));
        AmountA := Any.DecimalInRange(10, 500, 2);
        X110_CreateLine('BATCH-03', 10, 'ACC-1', WorkDate(), AmountA);
        X110_CreateLine('BATCH-03', 20, 'ACC-2', WorkDate(), -AmountA);

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
    procedure X110_PostingIntoALedgerWithNoEntriesStartsNumberingAtOne()
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] The very first entry written into an empty ledger is numbered 1
        // Every other test in this suite scopes itself by batch name and pins entry
        // numbers only relative to whatever the ledger already held, so the
        // empty-ledger case is the one place an absolute number is observable.
        LedgerEntry.DeleteAll();
        X110_CreateLine('BATCH-16', 10, 'ACC-1', WorkDate(), 100);
        X110_CreateLine('BATCH-16', 20, 'ACC-2', WorkDate(), -100);

        PostBatch.PostBatch('BATCH-16');

        LedgerEntry.SetRange("Batch Name", 'BATCH-16');
        LedgerEntry.FindFirst();
        Assert.AreEqual(1, LedgerEntry."Entry No.",
            'Expected the first entry written into a ledger that held no entries to be numbered 1');
        LedgerEntry.FindLast();
        Assert.AreEqual(2, LedgerEntry."Entry No.",
            'Expected the second entry to follow the first with no gap');
    end;

    [Test]
    procedure X110_EntriesFollowLineNumberOrder()
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] Entries are numbered in ascending Line No. order, however the lines were inserted
        X110_CreateLine('BATCH-04', 30, 'ACC-3', WorkDate(), 5);
        X110_CreateLine('BATCH-04', 10, 'ACC-1', WorkDate(), 10);
        X110_CreateLine('BATCH-04', 20, 'ACC-2', WorkDate(), -15);

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
    procedure X110_PostingMarksEveryPostedLinePosted()
    var
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] A successful post flips every line to Posted and keeps the lines in the journal
        X110_CreateLine('BATCH-05', 10, 'ACC-1', WorkDate(), 100);
        X110_CreateLine('BATCH-05', 20, 'ACC-2', WorkDate(), -100);

        PostBatch.PostBatch('BATCH-05');

        Assert.AreEqual(2, X110_LineCount('BATCH-05'),
            'Expected both journal lines to remain in the batch after posting - posting updates their status, it must not delete them');
        X110_AssertAllLinesHaveStatus('BATCH-05', "CG X110 Journal Status"::Posted);
    end;

    [Test]
    procedure X110_BlankAccountNoFailsTheWholeBatch()
    var
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] One line without an account fails the batch with the standard field-guard error
        X110_CreateLine('BATCH-06', 10, 'ACC-1', WorkDate(), 100);
        X110_CreateLine('BATCH-06', 20, '', WorkDate(), -100);
        Commit();

        asserterror PostBatch.PostBatch('BATCH-06');

        X110_AssertErrorContains('Account No.');
        X110_AssertErrorContains('must have a value');
        Assert.AreEqual(0, X110_LedgerEntryCount('BATCH-06'),
            'Expected no ledger entries when a line fails the account guard - a failing batch must write nothing');
        X110_AssertAllLinesHaveStatus('BATCH-06', "CG X110 Journal Status"::Open);
    end;

    [Test]
    procedure X110_BlankPostingDateFailsTheWholeBatch()
    var
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] One line without a posting date fails the batch with the standard field-guard error
        X110_CreateLine('BATCH-07', 10, 'ACC-1', WorkDate(), 100);
        X110_CreateLine('BATCH-07', 20, 'ACC-2', 0D, -100);
        Commit();

        asserterror PostBatch.PostBatch('BATCH-07');

        X110_AssertErrorContains('Posting Date');
        X110_AssertErrorContains('must have a value');
        Assert.AreEqual(0, X110_LedgerEntryCount('BATCH-07'),
            'Expected no ledger entries when a line fails the posting date guard - a failing batch must write nothing');
        X110_AssertAllLinesHaveStatus('BATCH-07', "CG X110 Journal Status"::Open);
    end;

    [Test]
    procedure X110_ZeroAmountLineFailsTheWholeBatch()
    var
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] A zero-amount line fails the batch even though the batch balances
        X110_CreateLine('BATCH-08', 10, 'ACC-1', WorkDate(), 100);
        X110_CreateLine('BATCH-08', 20, 'ACC-2', WorkDate(), -100);
        X110_CreateLine('BATCH-08', 30, 'ACC-3', WorkDate(), 0);
        Commit();

        asserterror PostBatch.PostBatch('BATCH-08');

        X110_AssertErrorContains('Amount');
        X110_AssertErrorContains('must have a value');
        Assert.AreEqual(0, X110_LedgerEntryCount('BATCH-08'),
            'Expected no ledger entries when a line fails the amount guard - a failing batch must write nothing');
        X110_AssertAllLinesHaveStatus('BATCH-08', "CG X110 Journal Status"::Open);
    end;

    [Test]
    procedure X110_UnbalancedShortBatchFailsWithOutOfBalanceError()
    var
        Any: Codeunit Any;
    begin
        // [SCENARIO] Open lines whose amounts sum below zero are rejected
        X110_VerifyOutOfBalanceBatchFails('BATCH-09', -Any.IntegerInRange(1, 5000) / 100);
    end;

    [Test]
    procedure X110_OneCentSurplusFailsWithOutOfBalanceError()
    begin
        // [SCENARIO] A surplus of a single cent is already enough to reject the batch
        X110_VerifyOutOfBalanceBatchFails('BATCH-09B', 0.01);
    end;

    [Test]
    procedure X110_EmptyBatchFailsWithNothingToPost()
    var
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] A batch with no lines at all is rejected
        asserterror PostBatch.PostBatch('BATCH-10');

        X110_AssertErrorContains('nothing to post');
    end;

    [Test]
    procedure X110_RepostingAFullyPostedBatchReportsNothingToPost()
    var
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] Posting a batch a second time, with no new lines added, leaves the ledger unchanged
        X110_CreateLine('BATCH-11', 10, 'ACC-1', WorkDate(), 250);
        X110_CreateLine('BATCH-11', 20, 'ACC-2', WorkDate(), -250);
        PostBatch.PostBatch('BATCH-11');
        Commit();

        asserterror PostBatch.PostBatch('BATCH-11');

        X110_AssertErrorContains('nothing to post');
        Assert.AreEqual(2, X110_LedgerEntryCount('BATCH-11'),
            'Expected the second posting attempt to create no duplicate ledger entries');
    end;

    [Test]
    procedure X110_NewlyOpenedLinesPostWithoutDuplicatingAlreadyPostedOnes()
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] Lines added to a batch after it was posted are posted on their own, on the next run
        X110_CreateLine('BATCH-12', 10, 'B12-A', WorkDate(), 60);
        X110_CreateLine('BATCH-12', 20, 'B12-B', WorkDate(), -60);
        PostBatch.PostBatch('BATCH-12');
        X110_CreateLine('BATCH-12', 30, 'B12-C', WorkDate(), 40);
        X110_CreateLine('BATCH-12', 40, 'B12-D', WorkDate(), -40);

        PostBatch.PostBatch('BATCH-12');

        Assert.AreEqual(4, X110_LedgerEntryCount('BATCH-12'),
            'Expected the second run to post only the two newly opened lines - already-posted lines must not produce ledger entries again');
        LedgerEntry.SetRange("Batch Name", 'BATCH-12');
        LedgerEntry.SetRange("Account No.", 'B12-A');
        Assert.AreEqual(1, LedgerEntry.Count(),
            'Expected the line posted in the first run to appear in the ledger exactly once');
        X110_AssertAllLinesHaveStatus('BATCH-12', "CG X110 Journal Status"::Posted);
    end;

    [Test]
    procedure X110_ABatchWithSomeAlreadyPostedLinesOnlyPostsItsOpenOnes()
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] A batch that already carries a posted line from an earlier run posts only its open lines now
        X110_SeedPostedLineWithLedgerEntry('BATCH-14', 10, 'B14-OLD', WorkDate(), 500);
        X110_CreateLine('BATCH-14', 20, 'B14-NEW1', WorkDate(), 200);
        X110_CreateLine('BATCH-14', 30, 'B14-NEW2', WorkDate(), -200);

        PostBatch.PostBatch('BATCH-14');

        Assert.AreEqual(3, X110_LedgerEntryCount('BATCH-14'),
            'Expected only the two open lines to gain a new ledger entry, on top of the one already carried by the previously posted line');
        LedgerEntry.SetRange("Batch Name", 'BATCH-14');
        LedgerEntry.SetRange("Account No.", 'B14-OLD');
        Assert.AreEqual(1, LedgerEntry.Count(),
            'Expected the previously posted line to still carry exactly one ledger entry');
        X110_AssertAllLinesHaveStatus('BATCH-14', "CG X110 Journal Status"::Posted);
    end;

    [Test]
    procedure X110_NewOpenLineForAPreviouslyPostedAccountStillGetsItsOwnEntry()
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] A newly opened line can legitimately reuse the account of a line posted in an earlier run - it must still post its own entry
        X110_SeedPostedLineWithLedgerEntry('BATCH-15', 10, 'B15-OLD', WorkDate(), 500);
        X110_CreateLine('BATCH-15', 20, 'B15-OLD', WorkDate(), 150);
        X110_CreateLine('BATCH-15', 30, 'B15-NEW', WorkDate(), -150);

        PostBatch.PostBatch('BATCH-15');

        Assert.AreEqual(3, X110_LedgerEntryCount('BATCH-15'),
            'Expected the batch to gain exactly one new ledger entry per currently open line, including an open line that shares an account with an already posted one');
        LedgerEntry.SetRange("Batch Name", 'BATCH-15');
        LedgerEntry.SetRange("Account No.", 'B15-OLD');
        Assert.AreEqual(2, LedgerEntry.Count(),
            'Expected the account to carry two ledger entries: the one from the earlier run, plus one new entry for the newly opened line - neither duplicated nor skipped');
        X110_AssertAllLinesHaveStatus('BATCH-15', "CG X110 Journal Status"::Posted);
    end;

    [Test]
    procedure X110_PostingScopesEveryCheckToTheGivenBatch()
    var
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] Posting one batch ignores a neighbour batch entirely
        // [GIVEN] the neighbour is deliberately unbalanced, so an unscoped balance check would fail loudly
        X110_CreateLine('BATCH-13A', 10, 'ACC-1', WorkDate(), 90);
        X110_CreateLine('BATCH-13A', 20, 'ACC-2', WorkDate(), -90);
        X110_CreateLine('BATCH-13B', 10, 'ACC-3', WorkDate(), 77);

        PostBatch.PostBatch('BATCH-13A');

        Assert.AreEqual(2, X110_LedgerEntryCount('BATCH-13A'),
            'Expected both lines of the posted batch in the ledger');
        Assert.AreEqual(0, X110_LedgerEntryCount('BATCH-13B'),
            'Expected no ledger entries for the other batch - posting one batch must not touch another');
        X110_AssertAllLinesHaveStatus('BATCH-13B', "CG X110 Journal Status"::Open);
    end;

    local procedure X110_CreateLine(BatchName: Code[10]; LineNo: Integer; AccountNo: Code[20]; PostingDate: Date; LineAmount: Decimal)
    begin
        X110_CreateLine(BatchName, LineNo, AccountNo, PostingDate, '', LineAmount);
    end;

    local procedure X110_CreateLine(BatchName: Code[10]; LineNo: Integer; AccountNo: Code[20]; PostingDate: Date; LineDescription: Text[50]; LineAmount: Decimal)
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

    local procedure X110_SeedPostedLineWithLedgerEntry(BatchName: Code[10]; LineNo: Integer; AccountNo: Code[20]; PostingDate: Date; LineAmount: Decimal)
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

        X110_SeedLedgerEntryFor(BatchName, AccountNo, PostingDate, LineAmount);
    end;

    local procedure X110_VerifyOutOfBalanceBatchFails(BatchName: Code[10]; Delta: Decimal)
    var
        PostBatch: Codeunit "CG X110 Post Batch";
        Any: Codeunit Any;
        AmountA: Decimal;
    begin
        // A whole-number base amount keeps the imbalance exactly Delta, so a
        // rounded or integer total would see the 0.01 case as balanced and post it.
        AmountA := Any.IntegerInRange(10, 500);
        X110_CreateLine(BatchName, 10, 'ACC-1', WorkDate(), AmountA);
        X110_CreateLine(BatchName, 20, 'ACC-2', WorkDate(), -AmountA + Delta);
        Commit();

        asserterror PostBatch.PostBatch(BatchName);

        X110_AssertErrorContains('out of balance');
        X110_AssertErrorContains(Format(Delta));
        Assert.AreEqual(0, X110_LedgerEntryCount(BatchName),
            'Expected no ledger entries for an out-of-balance batch - a failing batch must write nothing');
        X110_AssertAllLinesHaveStatus(BatchName, "CG X110 Journal Status"::Open);
    end;

    local procedure X110_SeedLedgerEntry(Offset: Integer): Integer
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

    local procedure X110_SeedLedgerEntryFor(BatchName: Code[10]; AccountNo: Code[20]; PostingDate: Date; LineAmount: Decimal): Integer
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

    local procedure X110_LedgerEntryCount(BatchName: Code[10]): Integer
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
    begin
        LedgerEntry.SetRange("Batch Name", BatchName);
        exit(LedgerEntry.Count());
    end;

    local procedure X110_LineCount(BatchName: Code[10]): Integer
    var
        JournalLine: Record "CG X110 Journal Line";
    begin
        JournalLine.SetRange("Batch Name", BatchName);
        exit(JournalLine.Count());
    end;

    local procedure X110_AssertAllLinesHaveStatus(BatchName: Code[10]; ExpectedStatus: Enum "CG X110 Journal Status")
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

    local procedure X110_AssertErrorContains(Fragment: Text)
    var
        ActualError: Text;
    begin
        ActualError := GetLastErrorText();
        Assert.IsTrue(LowerCase(ActualError).Contains(LowerCase(Fragment)),
            StrSubstNo('Expected the posting error to contain "%1", got: %2', Fragment, ActualError));
    end;

    // ==========================================================
    // X127 - donor CG-AL-X127
    // ==========================================================

    local procedure X127_GetOtherCompanyName(): Text[30]
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

    local procedure X127_ClearHere()
    var
        SiteSetup: Record "CG X127 Site Setup";
        JobCard: Record "CG X127 Job Card";
    begin
        SiteSetup.DeleteAll();
        JobCard.DeleteAll();
    end;

    local procedure X127_ClearThere(OtherName: Text[30])
    var
        SiteSetup: Record "CG X127 Site Setup";
    begin
        SiteSetup.ChangeCompany(OtherName);
        SiteSetup.DeleteAll();
    end;

    local procedure X127_SeedHere(SiteCode: Code[10]; Restricted: Boolean)
    var
        SiteSetup: Record "CG X127 Site Setup";
    begin
        SiteSetup.Init();
        SiteSetup."Site Code" := SiteCode;
        SiteSetup.Restricted := Restricted;
        SiteSetup.Insert();
    end;

    local procedure X127_SeedThere(OtherName: Text[30]; SiteCode: Code[10]; Restricted: Boolean)
    var
        SiteSetup: Record "CG X127 Site Setup";
    begin
        SiteSetup.ChangeCompany(OtherName);
        SiteSetup.Init();
        SiteSetup."Site Code" := SiteCode;
        SiteSetup.Restricted := Restricted;
        SiteSetup.Insert();
    end;

    local procedure X127_ReadThere(OtherName: Text[30]; SiteCode: Code[10]; var Found: Boolean; var Restricted: Boolean)
    var
        SiteSetup: Record "CG X127 Site Setup";
    begin
        SiteSetup.ChangeCompany(OtherName);
        Found := SiteSetup.Get(SiteCode);
        if Found then
            Restricted := SiteSetup.Restricted;
    end;

    local procedure X127_CountThere(OtherName: Text[30]): Integer
    var
        SiteSetup: Record "CG X127 Site Setup";
    begin
        SiteSetup.ChangeCompany(OtherName);
        exit(SiteSetup.Count());
    end;

    [Test]
    procedure X127_SiteCodeWithNoRestrictionRecordedForThisCompanyValidates()
    var
        JobCard: Record "CG X127 Job Card";
        OtherName: Text[30];
        SiteCodeAfter: Code[10];
    begin
        OtherName := X127_GetOtherCompanyName();
        X127_ClearHere();
        X127_ClearThere(OtherName);
        Commit();

        X127_SeedHere('DEPOT1', false);
        X127_SeedThere(OtherName, 'DEPOT1', true);

        JobCard.Init();
        JobCard."No." := 'JC001';
        JobCard.Validate("Site Code", 'DEPOT1');
        JobCard.Insert();

        SiteCodeAfter := JobCard."Site Code";

        X127_ClearHere();
        X127_ClearThere(OtherName);
        Commit();

        Assert.AreEqual('DEPOT1', SiteCodeAfter,
            'Expected a site code to validate when no restriction is recorded for the company this job card belongs to.');
    end;

    [Test]
    procedure X127_SiteCodeWithARestrictionRecordedForThisCompanyIsRefused()
    var
        JobCard: Record "CG X127 Job Card";
        OtherName: Text[30];
        ErrorTextAfter: Text;
    begin
        OtherName := X127_GetOtherCompanyName();
        X127_ClearHere();
        X127_ClearThere(OtherName);
        Commit();

        X127_SeedHere('DEPOT2', true);
        X127_SeedThere(OtherName, 'DEPOT2', false);

        JobCard.Init();
        JobCard."No." := 'JC002';

        asserterror JobCard.Validate("Site Code", 'DEPOT2');
        ErrorTextAfter := GetLastErrorText();

        X127_ClearHere();
        X127_ClearThere(OtherName);
        Commit();

        Assert.IsTrue(StrPos(ErrorTextAfter, 'currently restricted') > 0,
            'Expected the site code to be refused when the restriction is recorded for the company this job card belongs to.');
    end;

    [Test]
    procedure X127_SiteCodeWithNoRestrictionOnRecordValidates()
    var
        JobCard: Record "CG X127 Job Card";
    begin
        X127_ClearHere();

        X127_SeedHere('DEPOT3', false);

        JobCard.Init();
        JobCard."No." := 'JC003';
        JobCard.Validate("Site Code", 'DEPOT3');
        JobCard.Insert();

        Assert.AreEqual('DEPOT3', JobCard."Site Code",
            'Expected a site code with no restriction on record to validate.');

        X127_ClearHere();
    end;

    [Test]
    procedure X127_ARestrictionOnOneSiteCodeDoesNotAffectAnother()
    var
        JobCard: Record "CG X127 Job Card";
    begin
        X127_ClearHere();

        X127_SeedHere('DEPOT4', true);
        X127_SeedHere('DEPOT5', false);

        JobCard.Init();
        JobCard."No." := 'JC004';
        JobCard.Validate("Site Code", 'DEPOT5');
        JobCard.Insert();

        Assert.AreEqual('DEPOT5', JobCard."Site Code",
            'Expected a different, unrestricted site code to validate regardless of another site code''s own restriction.');

        X127_ClearHere();
    end;

    [Test]
    procedure X127_ValidatingASiteCodeDoesNotChangeDataInAnotherCompany()
    var
        SiteSetup: Record "CG X127 Site Setup";
        JobCard: Record "CG X127 Job Card";
        OtherName: Text[30];
        RowCountAfter: Integer;
        FoundAfter: Boolean;
        RestrictedAfter: Boolean;
        RestrictedHereAfter: Boolean;
    begin
        OtherName := X127_GetOtherCompanyName();
        X127_ClearHere();
        X127_ClearThere(OtherName);
        Commit();

        X127_SeedHere('DEPOT7', true);
        X127_SeedThere(OtherName, 'DEPOT6', false);

        JobCard.Init();
        JobCard."No." := 'JC005';
        JobCard.Validate("Site Code", 'DEPOT6');
        JobCard.Insert();

        RowCountAfter := X127_CountThere(OtherName);
        X127_ReadThere(OtherName, 'DEPOT6', FoundAfter, RestrictedAfter);
        SiteSetup.Get('DEPOT7');
        RestrictedHereAfter := SiteSetup.Restricted;

        X127_ClearHere();
        X127_ClearThere(OtherName);
        Commit();

        Assert.AreEqual(1, RowCountAfter,
            'Expected validating a job card not to add or remove records belonging to a different company.');
        Assert.IsTrue(FoundAfter,
            'Expected validating a job card not to remove a record belonging to a different company.');
        Assert.IsFalse(RestrictedAfter,
            'Expected validating a job card not to change data belonging to a different company.');
        Assert.IsTrue(RestrictedHereAfter,
            'Expected validating a job card not to change unrelated data recorded for this company.');
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
}
