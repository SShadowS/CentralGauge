codeunit 89357 "CG-AL-X137 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods
    // (measured, SOAP runner), so every test clears both tables before
    // seeding its own rows.

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
}
