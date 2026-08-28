codeunit 89361 "CG-AL-X141 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods (SOAP
    // runner), so every test below clears the tables it touches before
    // seeding its own rows. Each donor suite below owns a disjoint set of
    // tables, so tests from different donors cannot pollute one another;
    // the glue tests are the only ones that touch two donors' tables at
    // once, and they clear both.

    // ===================================================================
    // CG-AL-X110 (journal batch posting - the live symptom)
    // ===================================================================

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
    procedure PostingIntoALedgerWithNoEntriesStartsNumberingAtOne()
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] The very first entry written into an empty ledger is numbered 1
        // Every other test in this suite scopes itself by batch name and pins entry
        // numbers only relative to whatever the ledger already held, so the
        // empty-ledger case is the one place an absolute number is observable.
        LedgerEntry.DeleteAll();
        CreateLine('BATCH-16', 10, 'ACC-1', WorkDate(), 100);
        CreateLine('BATCH-16', 20, 'ACC-2', WorkDate(), -100);

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

    [Test]
    procedure TwoIdenticalOpenLinesEachPostTheirOwnEntry()
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] Two open lines that happen to carry the same account, date,
        // description and amount are still two distinct lines - a single clean
        // post (no batch is posted twice here) must still write one ledger
        // entry per line, not fold the look-alike pair into one.
        CreateLine('BATCH-17', 10, 'B17-DUP', WorkDate(), 'Same', 100);
        CreateLine('BATCH-17', 20, 'B17-DUP', WorkDate(), 'Same', 100);
        CreateLine('BATCH-17', 30, 'B17-BAL', WorkDate(), -200);

        PostBatch.PostBatch('BATCH-17');

        Assert.AreEqual(3, LedgerEntryCount('BATCH-17'),
            'Expected every open line to produce its own ledger entry, including lines that look alike.');
        LedgerEntry.SetRange("Batch Name", 'BATCH-17');
        LedgerEntry.SetRange("Account No.", 'B17-DUP');
        Assert.AreEqual(2, LedgerEntry.Count(),
            'Expected every open line to produce its own ledger entry, including lines that look alike.');
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

    // ===================================================================
    // CG-AL-X135 (order lifecycle - distractor, must not change)
    // ===================================================================

    local procedure SeedOrder(No: Code[20]; StatusValue: Enum "CG X135 Order Status"; OrderAmount: Decimal; var Order: Record "CG X135 Order")
    begin
        Order.Init();
        Order."No." := No;
        Order.Description := 'Sentinel';
        Order.Amount := OrderAmount;
        Order.Status := StatusValue;
        Order.Insert();
    end;

    local procedure RequiredStatusFragment(ActionIdx: Integer): Text
    begin
        case ActionIdx of
            1:
                exit('Open');
            2, 3:
                exit('Released');
        end;
        exit('');
    end;

    local procedure ResultStatus(ActionIdx: Integer): Enum "CG X135 Order Status"
    begin
        case ActionIdx of
            1:
                exit(Enum::"CG X135 Order Status"::Released);
            2:
                exit(Enum::"CG X135 Order Status"::Open);
            3:
                exit(Enum::"CG X135 Order Status"::Posted);
        end;
        exit(Enum::"CG X135 Order Status"::Open);
    end;

    local procedure IsLegalCell(ActionIdx: Integer; StartStatus: Enum "CG X135 Order Status"): Boolean
    begin
        case ActionIdx of
            1:
                exit(StartStatus = Enum::"CG X135 Order Status"::Open);
            2:
                exit(StartStatus = Enum::"CG X135 Order Status"::Released);
            3:
                exit(StartStatus = Enum::"CG X135 Order Status"::Released);
        end;
        exit(false);
    end;

    local procedure InvokeAction(ActionIdx: Integer; var Order: Record "CG X135 Order")
    var
        Lifecycle: Codeunit "CG X135 Order Lifecycle";
    begin
        case ActionIdx of
            1:
                Lifecycle.Release(Order);
            2:
                Lifecycle.Reopen(Order);
            3:
                Lifecycle.Post(Order);
        end;
    end;

    [Test]
    procedure TransitionMatrixSweep()
    var
        Order: Record "CG X135 Order";
        DbOrder: Record "CG X135 Order";
        PostedOrder: Record "CG X135 Posted Order";
        Statuses: array[3] of Enum "CG X135 Order Status";
        ActionIdx: Integer;
        StatusIdx: Integer;
        No: Code[20];
        Legal: Boolean;
    begin
        Order.DeleteAll();
        PostedOrder.DeleteAll();

        Statuses[1] := Enum::"CG X135 Order Status"::Open;
        Statuses[2] := Enum::"CG X135 Order Status"::Released;
        Statuses[3] := Enum::"CG X135 Order Status"::Posted;

        for ActionIdx := 1 to 3 do
            for StatusIdx := 1 to 3 do begin
                No := CopyStr(StrSubstNo('SWP%1%2', ActionIdx, StatusIdx), 1, 20);
                SeedOrder(No, Statuses[StatusIdx], 500, Order);
                Commit();

                Legal := IsLegalCell(ActionIdx, Statuses[StatusIdx]);

                if Legal then begin
                    InvokeAction(ActionIdx, Order);

                    Assert.AreEqual(
                        ResultStatus(ActionIdx).AsInteger(), Order.Status.AsInteger(),
                        StrSubstNo('Action %1 from status %2: the caller''s order variable must reflect the new status', ActionIdx, StatusIdx));

                    DbOrder.Get(No);
                    Assert.AreEqual(
                        ResultStatus(ActionIdx).AsInteger(), DbOrder.Status.AsInteger(),
                        StrSubstNo('Action %1 from status %2: the database must reflect the new status', ActionIdx, StatusIdx));

                    if ActionIdx = 3 then begin
                        Assert.AreEqual(
                            WorkDate(), DbOrder."Posted On",
                            StrSubstNo('Action %1 from status %2: posting must stamp Posted On with the work date', ActionIdx, StatusIdx));
                        Assert.IsTrue(
                            PostedOrder.Get(No),
                            StrSubstNo('Action %1 from status %2: a completed post must leave a posted record behind', ActionIdx, StatusIdx));
                        Assert.AreEqual(
                            500, PostedOrder.Amount,
                            StrSubstNo('Action %1 from status %2: the posted record must carry the order amount', ActionIdx, StatusIdx));
                    end;
                end else begin
                    asserterror InvokeAction(ActionIdx, Order);
                    Assert.ExpectedError(RequiredStatusFragment(ActionIdx));

                    DbOrder.Get(No);
                    Assert.AreEqual(
                        Statuses[StatusIdx].AsInteger(), DbOrder.Status.AsInteger(),
                        StrSubstNo('Action %1 from status %2: a rejected action must leave the status untouched', ActionIdx, StatusIdx));

                    if ActionIdx = 3 then
                        Assert.IsFalse(
                            PostedOrder.Get(No),
                            StrSubstNo('Action %1 from status %2: a rejected post must not leave a posted record behind', ActionIdx, StatusIdx));
                end;
            end;
    end;

    [Test]
    procedure OpenOrderReleasesAndReopens()
    var
        Order: Record "CG X135 Order";
        DbOrder: Record "CG X135 Order";
        Lifecycle: Codeunit "CG X135 Order Lifecycle";
    begin
        Order.DeleteAll();

        SeedOrder('ORD-3', Enum::"CG X135 Order Status"::Open, 400, Order);

        Lifecycle.Release(Order);
        Assert.AreEqual(Enum::"CG X135 Order Status"::Released.AsInteger(), Order.Status.AsInteger(), 'Releasing an Open order must move it to Released');

        Lifecycle.Reopen(Order);
        Assert.AreEqual(Enum::"CG X135 Order Status"::Open.AsInteger(), Order.Status.AsInteger(), 'Reopening a Released order must move it back to Open');

        DbOrder.Get('ORD-3');
        Assert.AreEqual(Enum::"CG X135 Order Status"::Open.AsInteger(), DbOrder.Status.AsInteger(), 'The database must reflect the reopened status');
        Assert.AreEqual(400, DbOrder.Amount, 'Amount must survive the release/reopen cycle untouched');

        Commit();
        asserterror Lifecycle.Reopen(Order);
        Assert.ExpectedError('Released');
    end;

    [Test]
    procedure ReleasedOrderPostsAndLeavesOthersUntouched()
    var
        OrderA: Record "CG X135 Order";
        DbOrderA: Record "CG X135 Order";
        OrderB: Record "CG X135 Order";
        DbOrderB: Record "CG X135 Order";
        PostedOrder: Record "CG X135 Posted Order";
        Lifecycle: Codeunit "CG X135 Order Lifecycle";
    begin
        OrderA.DeleteAll();
        PostedOrder.DeleteAll();

        SeedOrder('ORD-A', Enum::"CG X135 Order Status"::Open, 750, OrderA);
        SeedOrder('ORD-B', Enum::"CG X135 Order Status"::Open, 999, OrderB);

        Lifecycle.Release(OrderA);
        Lifecycle.Reopen(OrderA);
        Lifecycle.Release(OrderA);
        Lifecycle.Post(OrderA);

        Assert.AreEqual(Enum::"CG X135 Order Status"::Posted.AsInteger(), OrderA.Status.AsInteger(), 'A released order that posts must end up Posted on the caller''s variable');
        DbOrderA.Get('ORD-A');
        Assert.AreEqual(Enum::"CG X135 Order Status"::Posted.AsInteger(), DbOrderA.Status.AsInteger(), 'A released order that posts must end up Posted in the database');
        Assert.AreEqual(WorkDate(), DbOrderA."Posted On", 'Posting must stamp Posted On with the work date');
        Assert.IsTrue(PostedOrder.Get('ORD-A'), 'A completed post must leave a posted record behind');
        Assert.AreEqual(750, PostedOrder.Amount, 'The posted record must carry the order amount');

        DbOrderB.Get('ORD-B');
        Assert.AreEqual(Enum::"CG X135 Order Status"::Open.AsInteger(), DbOrderB.Status.AsInteger(), 'Posting one order must not change an unrelated order''s status');
        Assert.AreEqual(999, DbOrderB.Amount, 'Posting one order must not change an unrelated order''s amount');
        Assert.IsFalse(PostedOrder.Get('ORD-B'), 'Posting one order must not create a posted record for an unrelated order');
    end;

    [Test]
    procedure OpenOrderCannotSkipStraightToPosted()
    var
        Order: Record "CG X135 Order";
        DbOrder: Record "CG X135 Order";
        PostedOrder: Record "CG X135 Posted Order";
        Lifecycle: Codeunit "CG X135 Order Lifecycle";
    begin
        Order.DeleteAll();
        PostedOrder.DeleteAll();

        SeedOrder('ORD-C', Enum::"CG X135 Order Status"::Open, 750, Order);
        Commit();

        asserterror Lifecycle.Post(Order);
        Assert.ExpectedError('Released');

        DbOrder.Get('ORD-C');
        Assert.AreEqual(Enum::"CG X135 Order Status"::Open.AsInteger(), DbOrder.Status.AsInteger(), 'A rejected post must leave the order Open');
        Assert.IsTrue(DbOrder."Posted On" = 0D, 'A rejected post must leave Posted On blank');
        Assert.IsFalse(PostedOrder.Get('ORD-C'), 'A rejected post must not leave a posted record behind');
    end;

    // ===================================================================
    // CG-AL-X137 (import batch poster - distractor, must not change)
    // ===================================================================

    local procedure SeedImportLine(EntryNo: Integer; BatchNo: Code[20]; Amount: Integer)
    var
        ImportLine: Record "CG X137 Import Line";
    begin
        ImportLine.Init();
        ImportLine."Entry No." := EntryNo;
        ImportLine."Batch No." := BatchNo;
        ImportLine.Amount := Amount;
        ImportLine.Insert();
    end;

    local procedure SeedPostedEntry(EntryNo: Integer; BatchNo: Code[20]; Amount: Integer)
    var
        PostedEntry: Record "CG X137 Posted Entry";
    begin
        PostedEntry.Init();
        PostedEntry."Entry No." := EntryNo;
        PostedEntry."Batch No." := BatchNo;
        PostedEntry.Amount := Amount;
        PostedEntry.Insert();
    end;

    local procedure PostedExists(EntryNo: Integer): Boolean
    var
        PostedEntry: Record "CG X137 Posted Entry";
    begin
        exit(PostedEntry.Get(EntryNo));
    end;

    local procedure PostedAmount(EntryNo: Integer): Integer
    var
        PostedEntry: Record "CG X137 Posted Entry";
    begin
        PostedEntry.Get(EntryNo);
        exit(PostedEntry.Amount);
    end;

    local procedure CountPostedInBatch(BatchNo: Code[20]): Integer
    var
        PostedEntry: Record "CG X137 Posted Entry";
    begin
        PostedEntry.SetRange("Batch No.", BatchNo);
        exit(PostedEntry.Count());
    end;

    [Test]
    procedure HappyPathPostsEveryGoodLine()
    var
        ImportLine: Record "CG X137 Import Line";
        PostedEntry: Record "CG X137 Posted Entry";
        Poster: Codeunit "CG X137 Batch Poster";
    begin
        ImportLine.DeleteAll();
        PostedEntry.DeleteAll();

        SeedImportLine(1, 'B1', 50);
        SeedImportLine(2, 'B1', 30);
        SeedImportLine(3, 'B1', 20);

        Poster.PostBatch('B1');

        Assert.AreEqual(3, Poster.PostedCountLastRun(), 'All three lines in a clean batch should post.');
        Assert.AreEqual(0, Poster.SkippedCountLastRun(), 'Nothing should be skipped on a clean first run.');
        Assert.AreEqual(50, PostedAmount(1), 'Line 1 amount must reach the ledger unchanged.');
        Assert.AreEqual(30, PostedAmount(2), 'Line 2 amount must reach the ledger unchanged.');
        Assert.AreEqual(20, PostedAmount(3), 'Line 3 amount must reach the ledger unchanged.');
    end;

    [Test]
    procedure RetryAfterFixPostsEveryGoodLine()
    var
        ImportLine: Record "CG X137 Import Line";
        PostedEntry: Record "CG X137 Posted Entry";
        Poster: Codeunit "CG X137 Batch Poster";
    begin
        ImportLine.DeleteAll();
        PostedEntry.DeleteAll();

        SeedImportLine(101, 'B1', 40);
        SeedImportLine(102, 'B1', 25);
        SeedImportLine(103, 'B1', 0); // invalid: a non-positive amount is rejected
        Commit();

        asserterror Poster.PostBatch('B1');

        ImportLine.Get(103);
        ImportLine.Amount := 15;
        ImportLine.Modify();
        Commit();

        Poster.PostBatch('B1');

        Assert.AreEqual(3, Poster.PostedCountLastRun(), 'The retry must post every line of the batch that is not yet in the ledger.');
        Assert.AreEqual(0, Poster.SkippedCountLastRun(), 'Nothing in this batch reached the ledger before the retry.');
        Assert.IsTrue(PostedExists(101), 'Line 101 must reach the ledger once the batch is fixed and re-run.');
        Assert.IsTrue(PostedExists(102), 'Line 102 must reach the ledger once the batch is fixed and re-run.');
        Assert.AreEqual(40, PostedAmount(101), 'Line 101 must post with its original amount.');
        Assert.AreEqual(25, PostedAmount(102), 'Line 102 must post with its original amount.');
        Assert.AreEqual(15, PostedAmount(103), 'Line 103 must post with its corrected amount.');
        Assert.AreEqual(3, CountPostedInBatch('B1'), 'The ledger must hold every line of the batch after the retry, no more and no fewer.');
    end;

    [Test]
    procedure RepeatingACleanRunDoesNotDuplicate()
    var
        ImportLine: Record "CG X137 Import Line";
        PostedEntry: Record "CG X137 Posted Entry";
        Poster: Codeunit "CG X137 Batch Poster";
    begin
        ImportLine.DeleteAll();
        PostedEntry.DeleteAll();

        SeedImportLine(201, 'B2', 60);
        SeedImportLine(202, 'B2', 45);

        Poster.PostBatch('B2');
        Assert.AreEqual(2, Poster.PostedCountLastRun(), 'The first run should post both lines.');
        Assert.AreEqual(0, Poster.SkippedCountLastRun(), 'Nothing is posted yet before the first run.');

        Poster.PostBatch('B2');
        Assert.AreEqual(0, Poster.PostedCountLastRun(), 'Re-running an unchanged batch must not post its lines again.');
        Assert.AreEqual(2, Poster.SkippedCountLastRun(), 'Re-running an unchanged batch must report both lines as already handled.');

        Assert.AreEqual(2, CountPostedInBatch('B2'), 'The ledger must still hold exactly one row per line, not duplicates.');
        Assert.AreEqual(60, PostedAmount(201), 'Line 201 amount must be unaffected by the repeated run.');
        Assert.AreEqual(45, PostedAmount(202), 'Line 202 amount must be unaffected by the repeated run.');
    end;

    [Test]
    procedure PostingOneBatchLeavesAnotherBatchUntouched()
    var
        ImportLine: Record "CG X137 Import Line";
        PostedEntry: Record "CG X137 Posted Entry";
        Poster: Codeunit "CG X137 Batch Poster";
    begin
        ImportLine.DeleteAll();
        PostedEntry.DeleteAll();

        SeedImportLine(301, 'B3', 12);
        SeedImportLine(302, 'B3', 8);
        SeedImportLine(401, 'B4', 99);
        SeedPostedEntry(999, 'B4', 777);

        Poster.PostBatch('B3');

        Assert.AreEqual(2, Poster.PostedCountLastRun(), 'Posting one batch must post only that batch''s lines.');
        Assert.AreEqual(0, Poster.SkippedCountLastRun(), 'Nothing in this batch reached the ledger before this run.');
        Assert.AreEqual(12, PostedAmount(301), 'Line 301 must post with its own amount.');
        Assert.AreEqual(8, PostedAmount(302), 'Line 302 must post with its own amount.');
        Assert.IsFalse(PostedExists(401), 'A line belonging to a different batch must not be posted by this run.');
        Assert.AreEqual(777, PostedAmount(999), 'A previously posted line from another batch must be left untouched.');
        Assert.AreEqual(1, CountPostedInBatch('B4'), 'The other batch''s ledger rows must be unaffected by posting this batch.');
    end;

    // ===================================================================
    // CG-AL-X101 (running-balance statement - distractor, must not change,
    // and the module the glue wires onto the live symptom's data flow)
    // ===================================================================

    local procedure SeedStatementEntry(EntryNo: Integer; AccountNo: Code[20]; PostingDate: Date; Amount: Decimal; EntryDescription: Text[100])
    var
        LedgerEntry: Record "CG X101 Ledger Entry";
    begin
        LedgerEntry."Entry No." := EntryNo;
        LedgerEntry."Account No." := AccountNo;
        LedgerEntry."Posting Date" := PostingDate;
        LedgerEntry.Amount := Amount;
        LedgerEntry.Description := EntryDescription;
        LedgerEntry.Insert();
    end;

    local procedure AssertStatementLine(var StatementLine: Record "CG X101 Statement Line" temporary; LineNo: Integer; ExpectedEntryNo: Integer; ExpectedDescription: Text[100]; ExpectedRunningBalance: Decimal; LineLabel: Text)
    begin
        Assert.IsTrue(StatementLine.Get(LineNo), StrSubstNo('Expected the statement to have a line with "Line No." %1 (%2)', LineNo, LineLabel));
        Assert.AreEqual(ExpectedEntryNo, StatementLine."Entry No.", StrSubstNo('Expected the %1 to reference entry no. %2', LineLabel, ExpectedEntryNo));
        Assert.AreEqual(ExpectedDescription, StatementLine.Description, StrSubstNo('Expected the %1 to be the entry described "%2"', LineLabel, ExpectedDescription));
        Assert.AreEqual(ExpectedRunningBalance, StatementLine."Running Balance", StrSubstNo('Expected the %1''s running balance to be %2', LineLabel, ExpectedRunningBalance));
    end;

    local procedure VerifyStatementInvariants(AccountNo: Code[20]; var StatementLine: Record "CG X101 Statement Line" temporary)
    var
        LedgerEntry: Record "CG X101 Ledger Entry";
        ExpectedTotal: Decimal;
        PrevBalance: Decimal;
        PrevAmount: Decimal;
        PrevDate: Date;
        PrevEntryNo: Integer;
        LineIndex: Integer;
    begin
        StatementLine.Reset();
        LedgerEntry.SetRange("Account No.", AccountNo);
        if LedgerEntry.FindSet() then
            repeat
                ExpectedTotal += LedgerEntry.Amount;
            until LedgerEntry.Next() = 0;
        Assert.AreEqual(LedgerEntry.Count(), StatementLine.Count(), 'Expected exactly one statement line per entry on the requested account');

        if StatementLine.FindSet() then
            repeat
                LineIndex += 1;
                Assert.AreEqual(LineIndex, StatementLine."Line No.", 'Expected statement line numbers to run 1, 2, 3, ... from the top without gaps');
                Assert.IsTrue(LedgerEntry.Get(StatementLine."Entry No."), StrSubstNo('Expected line %1 to reference an existing ledger entry, got entry no. %2', LineIndex, StatementLine."Entry No."));
                Assert.AreEqual(AccountNo, LedgerEntry."Account No.", StrSubstNo('Expected line %1 to belong to the requested account', LineIndex));
                Assert.AreEqual(LedgerEntry."Posting Date", StatementLine."Posting Date", StrSubstNo('Expected line %1 to copy the posting date of its entry', LineIndex));
                Assert.AreEqual(LedgerEntry.Amount, StatementLine.Amount, StrSubstNo('Expected line %1 to copy the amount of its entry', LineIndex));
                Assert.AreEqual(LedgerEntry.Description, StatementLine.Description, StrSubstNo('Expected line %1 to copy the description of its entry', LineIndex));
                if LineIndex = 1 then
                    Assert.AreEqual(ExpectedTotal, StatementLine."Running Balance", 'Expected the top line''s running balance to equal the account''s total across all its entries')
                else begin
                    Assert.IsTrue(
                        (StatementLine."Posting Date" < PrevDate) or
                        ((StatementLine."Posting Date" = PrevDate) and (StatementLine."Entry No." < PrevEntryNo)),
                        StrSubstNo('Expected newest-first order: line %1 must be older than the line above it', LineIndex));
                    Assert.AreEqual(PrevBalance - PrevAmount, StatementLine."Running Balance", StrSubstNo('Expected the running balance on line %1 to be the line above''s balance minus the line above''s amount', LineIndex));
                end;
                PrevBalance := StatementLine."Running Balance";
                PrevAmount := StatementLine.Amount;
                PrevDate := StatementLine."Posting Date";
                PrevEntryNo := StatementLine."Entry No.";
            until StatementLine.Next() = 0;
        if LineIndex > 0 then
            Assert.AreEqual(PrevAmount, PrevBalance, 'Expected the bottom line''s running balance to equal its own amount, since nothing older exists');
    end;

    [Test]
    procedure RecordEntryPersistsAllFields()
    var
        LedgerEntry: Record "CG X101 Ledger Entry";
        StatementBuilder: Codeunit "CG X101 Statement Builder";
        EntryNo: Integer;
    begin
        LedgerEntry.DeleteAll();

        EntryNo := StatementBuilder.RecordEntry('ACC-T1', DMY2Date(5, 3, 2026), 250.75, 'Opening deposit');

        Assert.IsTrue(LedgerEntry.Get(EntryNo), 'Expected RecordEntry to insert a ledger entry under the entry number it returned');
        Assert.AreEqual('ACC-T1', LedgerEntry."Account No.", 'Expected the recorded entry to store the account number it was called with');
        Assert.AreEqual(DMY2Date(5, 3, 2026), LedgerEntry."Posting Date", 'Expected the recorded entry to store the posting date it was called with');
        Assert.AreEqual(250.75, LedgerEntry.Amount, 'Expected the recorded entry to store the amount it was called with');
        Assert.AreEqual('Opening deposit', LedgerEntry.Description, 'Expected the recorded entry to store the description it was called with');
    end;

    [Test]
    procedure EntryNumbersFormOneSequenceAcrossAccounts()
    var
        LedgerEntry: Record "CG X101 Ledger Entry";
        StatementBuilder: Codeunit "CG X101 Statement Builder";
        FirstEntryNo: Integer;
        SecondEntryNo: Integer;
        ThirdEntryNo: Integer;
    begin
        LedgerEntry.DeleteAll();

        FirstEntryNo := StatementBuilder.RecordEntry('ACC-T2A', DMY2Date(1, 2, 2026), 10.00, 'First');
        SecondEntryNo := StatementBuilder.RecordEntry('ACC-T2B', DMY2Date(2, 2, 2026), 20.00, 'Second');
        ThirdEntryNo := StatementBuilder.RecordEntry('ACC-T2A', DMY2Date(3, 2, 2026), 30.00, 'Third');

        Assert.AreEqual(1, FirstEntryNo, 'Expected the first entry recorded into an empty ledger to get entry number 1');
        Assert.AreEqual(2, SecondEntryNo, 'Expected the second recorded entry to get entry number 2, the sequence shared across accounts');
        Assert.AreEqual(3, ThirdEntryNo, 'Expected the third recorded entry to get entry number 3, the sequence shared across accounts');
    end;

    [Test]
    procedure NextEntryNumberFollowsHighestExisting()
    var
        LedgerEntry: Record "CG X101 Ledger Entry";
        StatementBuilder: Codeunit "CG X101 Statement Builder";
        EntryNo: Integer;
    begin
        LedgerEntry.DeleteAll();
        SeedStatementEntry(40, 'ACC-T3', DMY2Date(1, 1, 2026), 5.00, 'Imported entry');

        EntryNo := StatementBuilder.RecordEntry('ACC-T3', DMY2Date(2, 1, 2026), 10.00, 'New entry');

        Assert.AreEqual(41, EntryNo, 'Expected the next entry number to be one greater than the highest existing entry number, not counted from the number of rows');
    end;

    [Test]
    procedure StatementListsNewestFirstWhenRecordedInOrder()
    var
        StatementLine: Record "CG X101 Statement Line" temporary;
        StatementBuilder: Codeunit "CG X101 Statement Builder";
        LedgerEntry: Record "CG X101 Ledger Entry";
    begin
        LedgerEntry.DeleteAll();
        SeedStatementEntry(10, 'ACC-T4', DMY2Date(3, 1, 2026), 80.00, 'Oldest');
        SeedStatementEntry(11, 'ACC-T4', DMY2Date(15, 1, 2026), 50.00, 'Middle');
        SeedStatementEntry(12, 'ACC-T4', DMY2Date(28, 1, 2026), 20.00, 'Newest');

        StatementBuilder.BuildStatement('ACC-T4', StatementLine);

        StatementLine.Reset();
        Assert.AreEqual(3, StatementLine.Count(), 'Expected one statement line per entry on the account');
        AssertStatementLine(StatementLine, 1, 12, 'Newest', 150.00, 'top line');
        AssertStatementLine(StatementLine, 2, 11, 'Middle', 130.00, 'middle line');
        AssertStatementLine(StatementLine, 3, 10, 'Oldest', 80.00, 'bottom line');
    end;

    [Test]
    procedure StatementOrdersByPostingDateWhenRecordedOutOfOrder()
    var
        StatementLine: Record "CG X101 Statement Line" temporary;
        StatementBuilder: Codeunit "CG X101 Statement Builder";
        LedgerEntry: Record "CG X101 Ledger Entry";
    begin
        LedgerEntry.DeleteAll();
        SeedStatementEntry(1, 'ACC-T5', DMY2Date(20, 1, 2026), 50.00, 'A1');
        SeedStatementEntry(2, 'ACC-T5', DMY2Date(5, 1, 2026), 30.00, 'A2');
        SeedStatementEntry(3, 'ACC-T5', DMY2Date(12, 1, 2026), 20.00, 'A3');

        StatementBuilder.BuildStatement('ACC-T5', StatementLine);

        StatementLine.Reset();
        Assert.AreEqual(3, StatementLine.Count(), 'Expected one statement line per entry on the account');
        AssertStatementLine(StatementLine, 1, 1, 'A1', 100.00, 'top line (latest posting date)');
        AssertStatementLine(StatementLine, 2, 3, 'A3', 50.00, 'middle line');
        AssertStatementLine(StatementLine, 3, 2, 'A2', 30.00, 'bottom line (earliest posting date)');
    end;

    [Test]
    procedure SameDayEntriesBreakTheTieByEntryNo()
    var
        StatementLine: Record "CG X101 Statement Line" temporary;
        StatementBuilder: Codeunit "CG X101 Statement Builder";
        LedgerEntry: Record "CG X101 Ledger Entry";
    begin
        LedgerEntry.DeleteAll();
        SeedStatementEntry(7, 'ACC-T6', DMY2Date(10, 2, 2026), 10.00, 'Morning');
        SeedStatementEntry(8, 'ACC-T6', DMY2Date(10, 2, 2026), 5.00, 'Afternoon');

        StatementBuilder.BuildStatement('ACC-T6', StatementLine);

        StatementLine.Reset();
        AssertStatementLine(StatementLine, 1, 8, 'Afternoon', 15.00, 'top line (later same-day entry)');
        AssertStatementLine(StatementLine, 2, 7, 'Morning', 10.00, 'bottom line (earlier same-day entry)');
    end;

    [Test]
    procedure StatementIsolatesEntriesByAccount()
    var
        StatementLine: Record "CG X101 Statement Line" temporary;
        StatementBuilder: Codeunit "CG X101 Statement Builder";
        LedgerEntry: Record "CG X101 Ledger Entry";
    begin
        LedgerEntry.DeleteAll();
        SeedStatementEntry(1, 'ACC-T7A', DMY2Date(20, 1, 2026), 100.00, 'A newer');
        SeedStatementEntry(2, 'ACC-T7B', DMY2Date(3, 1, 2026), 999.00, 'B noise 1');
        SeedStatementEntry(3, 'ACC-T7A', DMY2Date(5, 1, 2026), 40.00, 'A older');
        SeedStatementEntry(4, 'ACC-T7B', DMY2Date(25, 1, 2026), 999.00, 'B noise 2');

        StatementBuilder.BuildStatement('ACC-T7A', StatementLine);

        StatementLine.Reset();
        Assert.AreEqual(2, StatementLine.Count(), 'Expected only the requested account''s entries on the statement');
        AssertStatementLine(StatementLine, 1, 1, 'A newer', 140.00, 'top line');
        AssertStatementLine(StatementLine, 2, 3, 'A older', 40.00, 'bottom line');

        Assert.IsTrue(LedgerEntry.Get(2), 'Expected the other account''s entry to remain in the ledger, untouched');
        Assert.AreEqual(999.00, LedgerEntry.Amount, 'Expected the other account''s entry to keep its original amount');
        Assert.IsTrue(LedgerEntry.Get(4), 'Expected the other account''s entry to remain in the ledger, untouched');
        Assert.AreEqual(999.00, LedgerEntry.Amount, 'Expected the other account''s entry to keep its original amount');
    end;

    [Test]
    procedure RebuildReplacesTheWholeStatementWhateverTheCallerWasViewing()
    var
        StatementLine: Record "CG X101 Statement Line" temporary;
        StatementBuilder: Codeunit "CG X101 Statement Builder";
        LedgerEntry: Record "CG X101 Ledger Entry";
    begin
        LedgerEntry.DeleteAll();
        SeedStatementEntry(1, 'ACC-T8A', DMY2Date(4, 1, 2026), 10.00, 'A one');
        SeedStatementEntry(2, 'ACC-T8A', DMY2Date(6, 1, 2026), 20.00, 'A two');
        SeedStatementEntry(3, 'ACC-T8B', DMY2Date(8, 1, 2026), 5.00, 'B only');
        StatementBuilder.BuildStatement('ACC-T8A', StatementLine);
        // The caller is left looking at a narrowed view of its own buffer. A
        // rebuild must still replace the whole statement, not just the part
        // the caller happened to have in view.
        StatementLine.SetRange("Line No.", 1, 1);

        StatementBuilder.BuildStatement('ACC-T8B', StatementLine);

        StatementLine.Reset();
        Assert.AreEqual(1, StatementLine.Count(), 'Expected BuildStatement to empty the buffer before filling it, so lines from the previous statement do not survive a rebuild');
        AssertStatementLine(StatementLine, 1, 3, 'B only', 5.00, 'rebuilt line');
    end;

    [Test]
    procedure AccountWithNoEntriesYieldsEmptyStatement()
    var
        StatementLine: Record "CG X101 Statement Line" temporary;
        StatementBuilder: Codeunit "CG X101 Statement Builder";
        LedgerEntry: Record "CG X101 Ledger Entry";
    begin
        LedgerEntry.DeleteAll();
        SeedStatementEntry(1, 'ACC-T9OTHER', DMY2Date(5, 1, 2026), 50.00, 'Noise');

        StatementBuilder.BuildStatement('ACC-T9', StatementLine);

        StatementLine.Reset();
        Assert.AreEqual(0, StatementLine.Count(), 'Expected an account with no entries to produce an empty statement');
    end;

    [Test]
    procedure RandomizedLedgerKeepsEveryGuarantee()
    var
        StatementLine: Record "CG X101 Statement Line" temporary;
        StatementBuilder: Codeunit "CG X101 Statement Builder";
        LedgerEntry: Record "CG X101 Ledger Entry";
        Any: Codeunit Any;
        i: Integer;
    begin
        LedgerEntry.DeleteAll();
        Any.SetSeed(101);
        for i := 1 to 8 do
            SeedStatementEntry(i, 'ACC-T10', Any.DateInRange(DMY2Date(1, 1, 2026), 1, 40), (Any.IntegerInRange(1, 100000) - 50000) / 100, StrSubstNo('Random %1', i));
        SeedStatementEntry(9, 'ACC-T10X', DMY2Date(15, 1, 2026), 77.77, 'Decoy');
        SeedStatementEntry(10, 'ACC-T10X', DMY2Date(25, 1, 2026), -13.13, 'Decoy');

        StatementBuilder.BuildStatement('ACC-T10', StatementLine);

        VerifyStatementInvariants('ACC-T10', StatementLine);
    end;

    // ===================================================================
    // CG-AL-X141 glue (period statement feed - the T3 entanglement seam)
    // ===================================================================

    [Test]
    procedure CleanPostingFeedsExactAmountsIntoTheStatement()
    var
        JournalLine: Record "CG X110 Journal Line";
        JournalLedgerEntry: Record "CG X110 Ledger Entry";
        StatementLedgerEntry: Record "CG X101 Ledger Entry";
        StatementLine: Record "CG X101 Statement Line" temporary;
        PostBatch: Codeunit "CG X110 Post Batch";
        Feed: Codeunit "CG X141 Period Statement Feed";
        StatementBuilder: Codeunit "CG X101 Statement Builder";
    begin
        // [SCENARIO] A batch that has only ever been posted once feeds the statement exactly the amounts it posted
        JournalLine.DeleteAll();
        JournalLedgerEntry.DeleteAll();
        StatementLedgerEntry.DeleteAll();

        CreateLine('X141-CLEAN', 10, 'X141-C1', WorkDate(), 300);
        CreateLine('X141-CLEAN', 20, 'X141-C2', WorkDate(), -300);

        PostBatch.PostBatch('X141-CLEAN');
        Feed.FeedBatchToStatement('X141-CLEAN');

        StatementBuilder.BuildStatement('X141-C1', StatementLine);
        StatementLine.Reset();
        Assert.AreEqual(1, StatementLine.Count(), 'Expected exactly one statement entry for an account whose batch was posted only once');
        AssertStatementLine(StatementLine, 1, 1, '', 300, 'X141-C1 statement line');

        StatementBuilder.BuildStatement('X141-C2', StatementLine);
        StatementLine.Reset();
        Assert.AreEqual(1, StatementLine.Count(), 'Expected exactly one statement entry for the offsetting account of a batch posted only once');
        StatementLine.FindFirst();
        Assert.AreEqual(-300, StatementLine.Amount, 'Expected the offsetting account''s statement line to carry its posted amount unchanged');
        Assert.AreEqual(-300, StatementLine."Running Balance", 'Expected the offsetting account''s running balance to equal its single posted amount');
    end;

    [Test]
    procedure ReconciledFiguresAfterAFixedReRunMatchTheAccountsRealHistory()
    var
        JournalLine: Record "CG X110 Journal Line";
        JournalLedgerEntry: Record "CG X110 Ledger Entry";
        StatementLedgerEntry: Record "CG X101 Ledger Entry";
        StatementLine: Record "CG X101 Statement Line" temporary;
        PostBatch: Codeunit "CG X110 Post Batch";
        Feed: Codeunit "CG X141 Period Statement Feed";
        StatementBuilder: Codeunit "CG X101 Statement Builder";
    begin
        // [SCENARIO] A batch carries one line already posted from an earlier run
        // alongside newly opened lines. Re-running the batch to pick up the new
        // lines must feed the period statement exactly one entry per posted
        // line - the previously posted account's figures must not double.
        JournalLine.DeleteAll();
        JournalLedgerEntry.DeleteAll();
        StatementLedgerEntry.DeleteAll();

        SeedPostedLineWithLedgerEntry('X141-RERUN', 10, 'X141-OLD', WorkDate(), 500);
        CreateLine('X141-RERUN', 20, 'X141-NEW1', WorkDate(), 200);
        CreateLine('X141-RERUN', 30, 'X141-NEW2', WorkDate(), -200);

        PostBatch.PostBatch('X141-RERUN');
        Feed.FeedBatchToStatement('X141-RERUN');

        StatementBuilder.BuildStatement('X141-OLD', StatementLine);
        StatementLine.Reset();
        Assert.AreEqual(1, StatementLine.Count(),
            'Expected the previously posted account to show exactly one statement entry after the batch was re-run to post its newly opened lines');
        StatementLine.FindFirst();
        Assert.AreEqual(500, StatementLine.Amount,
            'Expected the previously posted account''s statement entry to carry its original amount, not a duplicate');
        Assert.AreEqual(500, StatementLine."Running Balance",
            'Expected the previously posted account''s statement balance to equal its real posted amount, not double it');

        StatementBuilder.BuildStatement('X141-NEW1', StatementLine);
        StatementLine.Reset();
        Assert.AreEqual(1, StatementLine.Count(), 'Expected the newly opened line''s account to show exactly one statement entry');
        StatementLine.FindFirst();
        Assert.AreEqual(200, StatementLine.Amount, 'Expected the newly opened line''s account to carry its posted amount');
    end;

    [Test]
    procedure FeedingOneBatchLeavesOtherBatchesOutOfTheStatement()
    var
        JournalLine: Record "CG X110 Journal Line";
        JournalLedgerEntry: Record "CG X110 Ledger Entry";
        StatementLedgerEntry: Record "CG X101 Ledger Entry";
        StatementLine: Record "CG X101 Statement Line" temporary;
        PostBatch: Codeunit "CG X110 Post Batch";
        Feed: Codeunit "CG X141 Period Statement Feed";
        StatementBuilder: Codeunit "CG X101 Statement Builder";
    begin
        // [SCENARIO] Two clean batches are posted. Feeding only one of them into
        // the statement must leave the other batch's entries out entirely - the
        // feed is scoped to the batch it was called with, not every batch in
        // the ledger.
        JournalLine.DeleteAll();
        JournalLedgerEntry.DeleteAll();
        StatementLedgerEntry.DeleteAll();

        CreateLine('X141-FEED', 10, 'X141-FED-A', WorkDate(), 400);
        CreateLine('X141-FEED', 20, 'X141-FED-B', WorkDate(), -400);
        CreateLine('X141-SKIP', 10, 'X141-SKIP-A', WorkDate(), 999);
        CreateLine('X141-SKIP', 20, 'X141-SKIP-B', WorkDate(), -999);

        PostBatch.PostBatch('X141-FEED');
        PostBatch.PostBatch('X141-SKIP');
        Feed.FeedBatchToStatement('X141-FEED');

        StatementBuilder.BuildStatement('X141-FED-A', StatementLine);
        StatementLine.Reset();
        Assert.AreEqual(1, StatementLine.Count(),
            'Expected the fed batch''s account to show exactly one statement entry');
        StatementLine.FindFirst();
        Assert.AreEqual(400, StatementLine.Amount,
            'Expected the fed batch''s account to carry its posted amount');
        Assert.AreEqual(400, StatementLine."Running Balance",
            'Expected the fed batch''s account balance to equal its posted amount');

        StatementBuilder.BuildStatement('X141-SKIP-A', StatementLine);
        StatementLine.Reset();
        Assert.AreEqual(0, StatementLine.Count(),
            'Expected an account from a batch that was never fed to have no statement entries at all');
    end;
}
