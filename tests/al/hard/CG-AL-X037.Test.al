codeunit 80326 "CG-AL-X037 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure Reset()
    var
        Journal: Record "CG X037 Journal";
    begin
        Journal.DeleteAll();
        Commit();

        // Pre-existing row belonging to a completely different, unrelated
        // operation. An unfiltered cleanup must never touch it.
        Journal.Init();
        Journal."Batch Id" := 999;
        Journal.Step := 1;
        Journal.Amount := 42;
        Journal.Insert();
        Commit();
    end;

    local procedure AssertDecoyIntact()
    var
        Journal: Record "CG X037 Journal";
    begin
        Assert.IsTrue(Journal.Get(999, 1), 'The pre-existing unrelated row must never be removed');
        Assert.AreEqual(42, Journal.Amount, 'The pre-existing unrelated row must never be modified');
    end;

    [Test]
    procedure SuccessfulRunPersistsOpaqueJournalRows()
    var
        Poster: Codeunit "CG X037 Poster";
        Journal: Record "CG X037 Journal";
    begin
        // [GIVEN] No prior rows for this batch, plus an unrelated pre-existing row
        Reset();

        // [WHEN] PostBatch runs for a batch the engine will accept
        Assert.IsTrue(Poster.PostBatch(4, 10), 'An accepted batch should return true');

        // [THEN] Both of the engine's own (opaque) computed rows persist —
        // never derivable without really calling it.
        Assert.IsTrue(Journal.Get(4, 1), 'First journal row must persist after a clean run');
        Assert.AreEqual(57, Journal.Amount, 'First journal row amount must match the engine formula');
        Assert.IsTrue(Journal.Get(4, 2), 'Second journal row must persist after a clean run');
        Assert.AreEqual(71, Journal.Amount, 'Second journal row amount must match the engine formula');

        AssertDecoyIntact();
    end;

    [Test]
    procedure FailedRunLeavesNoJournalRowsForThatBatch()
    var
        Poster: Codeunit "CG X037 Poster";
        Journal: Record "CG X037 Journal";
    begin
        // [GIVEN] No prior rows for this batch, plus an unrelated pre-existing row
        Reset();

        // [WHEN] PostBatch runs for a batch the engine will refuse
        Assert.IsFalse(Poster.PostBatch(5, -1), 'A refused batch must return false, not throw');

        // [THEN] No row for this batch remains, and the unrelated row is untouched.
        Journal.SetRange("Batch Id", 5);
        Assert.IsTrue(Journal.IsEmpty(), 'No journal row for a refused batch may remain');

        AssertDecoyIntact();
    end;

    [Test]
    procedure SecondFailedRunAlsoLeavesNoResidue()
    var
        Poster: Codeunit "CG X037 Poster";
        Journal: Record "CG X037 Journal";
    begin
        // [GIVEN] No prior rows for this batch, plus an unrelated pre-existing row
        Reset();

        // [WHEN] PostBatch runs for a different refused batch, to block hardcoding
        Assert.IsFalse(Poster.PostBatch(6, -7), 'A refused batch must return false, not throw');

        // [THEN] No row for this batch remains, and the unrelated row is untouched.
        Journal.SetRange("Batch Id", 6);
        Assert.IsTrue(Journal.IsEmpty(), 'No journal row for a refused batch may remain');

        AssertDecoyIntact();
    end;

    [Test]
    procedure TwoSuccessfulRunsBothPersistIndependently()
    var
        Poster: Codeunit "CG X037 Poster";
        Journal: Record "CG X037 Journal";
    begin
        // [GIVEN] No prior rows for either batch, plus an unrelated pre-existing row
        Reset();

        // [WHEN] PostBatch runs for two different accepted batches
        Assert.IsTrue(Poster.PostBatch(2, 3), 'First accepted batch should return true');
        Assert.IsTrue(Poster.PostBatch(7, 9), 'Second accepted batch should return true');

        // [THEN] Each batch's own rows persist independently with their own opaque values
        Assert.IsTrue(Journal.Get(2, 1), 'First batch, first row must persist');
        Assert.AreEqual(31, Journal.Amount, 'First batch, first row amount must match the engine formula');
        Assert.IsTrue(Journal.Get(2, 2), 'First batch, second row must persist');
        Assert.AreEqual(37, Journal.Amount, 'First batch, second row amount must match the engine formula');

        Assert.IsTrue(Journal.Get(7, 1), 'Second batch, first row must persist');
        Assert.AreEqual(96, Journal.Amount, 'Second batch, first row amount must match the engine formula');
        Assert.IsTrue(Journal.Get(7, 2), 'Second batch, second row must persist');
        Assert.AreEqual(122, Journal.Amount, 'Second batch, second row amount must match the engine formula');

        AssertDecoyIntact();
    end;
}
