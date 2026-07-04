codeunit 80326 "CG-AL-X037 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure Reset()
    var
        Ledger: Record "CG X037 Ledger";
    begin
        Ledger.DeleteAll();
        Commit();

        // Pre-existing row belonging to a completely different, unrelated
        // operation. An unfiltered cleanup must never touch it.
        Ledger.Init();
        Ledger."Batch Id" := 999;
        Ledger.Step := 1;
        Ledger.Amount := 42;
        Ledger.Insert();
        Commit();
    end;

    local procedure AssertDecoyIntact()
    var
        Ledger: Record "CG X037 Ledger";
    begin
        Assert.IsTrue(Ledger.Get(999, 1), 'The pre-existing unrelated row must never be removed');
        Assert.AreEqual(42, Ledger.Amount, 'The pre-existing unrelated row must never be modified');
    end;

    [Test]
    procedure SuccessfulRunPersistsOpaqueLedgerRows()
    var
        Poster: Codeunit "CG X037 Poster";
        Ledger: Record "CG X037 Ledger";
    begin
        // [GIVEN] No prior rows for this batch, plus an unrelated pre-existing row
        Reset();

        // [WHEN] PostBatch runs for a batch the worker will accept
        Assert.IsTrue(Poster.PostBatch(4, 10), 'An accepted batch should return true');

        // [THEN] Both of the worker's own (opaque) computed rows persist —
        // never derivable without really calling it.
        Assert.IsTrue(Ledger.Get(4, 1), 'First ledger row must persist after a clean run');
        Assert.AreEqual(57, Ledger.Amount, 'First ledger row amount must match the worker formula');
        Assert.IsTrue(Ledger.Get(4, 2), 'Second ledger row must persist after a clean run');
        Assert.AreEqual(71, Ledger.Amount, 'Second ledger row amount must match the worker formula');

        AssertDecoyIntact();
    end;

    [Test]
    procedure FailedRunLeavesNoLedgerRowsForThatBatch()
    var
        Poster: Codeunit "CG X037 Poster";
        Ledger: Record "CG X037 Ledger";
    begin
        // [GIVEN] No prior rows for this batch, plus an unrelated pre-existing row
        Reset();

        // [WHEN] PostBatch runs for a batch the worker will refuse
        Assert.IsFalse(Poster.PostBatch(5, -1), 'A refused batch must return false, not throw');

        // [THEN] No row for this batch remains, and the unrelated row is untouched.
        Ledger.SetRange("Batch Id", 5);
        Assert.IsTrue(Ledger.IsEmpty(), 'No ledger row for a refused batch may remain');

        AssertDecoyIntact();
    end;

    [Test]
    procedure SecondFailedRunAlsoLeavesNoResidue()
    var
        Poster: Codeunit "CG X037 Poster";
        Ledger: Record "CG X037 Ledger";
    begin
        // [GIVEN] No prior rows for this batch, plus an unrelated pre-existing row
        Reset();

        // [WHEN] PostBatch runs for a different refused batch, to block hardcoding
        Assert.IsFalse(Poster.PostBatch(6, -7), 'A refused batch must return false, not throw');

        // [THEN] No row for this batch remains, and the unrelated row is untouched.
        Ledger.SetRange("Batch Id", 6);
        Assert.IsTrue(Ledger.IsEmpty(), 'No ledger row for a refused batch may remain');

        AssertDecoyIntact();
    end;

    [Test]
    procedure TwoSuccessfulRunsBothPersistIndependently()
    var
        Poster: Codeunit "CG X037 Poster";
        Ledger: Record "CG X037 Ledger";
    begin
        // [GIVEN] No prior rows for either batch, plus an unrelated pre-existing row
        Reset();

        // [WHEN] PostBatch runs for two different accepted batches
        Assert.IsTrue(Poster.PostBatch(2, 3), 'First accepted batch should return true');
        Assert.IsTrue(Poster.PostBatch(7, 9), 'Second accepted batch should return true');

        // [THEN] Each batch's own rows persist independently with their own opaque values
        Assert.IsTrue(Ledger.Get(2, 1), 'First batch, first row must persist');
        Assert.AreEqual(31, Ledger.Amount, 'First batch, first row amount must match the worker formula');
        Assert.IsTrue(Ledger.Get(2, 2), 'First batch, second row must persist');
        Assert.AreEqual(37, Ledger.Amount, 'First batch, second row amount must match the worker formula');

        Assert.IsTrue(Ledger.Get(7, 1), 'Second batch, first row must persist');
        Assert.AreEqual(96, Ledger.Amount, 'Second batch, first row amount must match the worker formula');
        Assert.IsTrue(Ledger.Get(7, 2), 'Second batch, second row must persist');
        Assert.AreEqual(122, Ledger.Amount, 'Second batch, second row amount must match the worker formula');

        AssertDecoyIntact();
    end;
}
