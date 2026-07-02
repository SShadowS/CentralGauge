codeunit 80328 "CG-AL-X040 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure Reset()
    var
        Ledger: Record "CG X040 Ledger";
        Log: Record "CG X040 Log";
    begin
        Ledger.DeleteAll();
        Log.DeleteAll();
        Commit();

        // Pre-existing rows belonging to a completely different, unrelated
        // batch. An unfiltered cleanup must never touch them.
        Ledger.Init();
        Ledger."Batch Id" := 999;
        Ledger.Step := 1;
        Ledger.Amount := 42;
        Ledger.Insert();

        Log.Init();
        Log."Batch Id" := 999;
        Log.Phase := 'STARTED';
        Log.Insert();
        Commit();
    end;

    local procedure LogPhaseExists(BatchId: Integer; Phase: Code[10]): Boolean
    var
        Log: Record "CG X040 Log";
    begin
        Log.SetRange("Batch Id", BatchId);
        Log.SetRange(Phase, Phase);
        exit(not Log.IsEmpty());
    end;

    local procedure AssertDecoyIntact()
    var
        Ledger: Record "CG X040 Ledger";
    begin
        Assert.IsTrue(Ledger.Get(999, 1), 'The pre-existing unrelated ledger row must never be removed');
        Assert.AreEqual(42, Ledger.Amount, 'The pre-existing unrelated ledger row must never be modified');
        Assert.IsTrue(LogPhaseExists(999, 'STARTED'), 'The pre-existing unrelated audit entry must never be removed');
    end;

    [Test]
    procedure SuccessfulRunPersistsOpaqueLedgerRowsAndAuditTrail()
    var
        Poster: Codeunit "CG X040 Poster";
        Ledger: Record "CG X040 Ledger";
    begin
        // [GIVEN] No prior rows for this batch, plus an unrelated pre-existing pair
        Reset();

        // [WHEN] PostBatch runs for a batch the engine will accept
        Assert.IsTrue(Poster.PostBatch(4, 10), 'An accepted batch should return true');

        // [THEN] Both of the engine's own (opaque) computed rows persist —
        // never derivable without really calling it.
        Assert.IsTrue(Ledger.Get(4, 1), 'First ledger row must persist after a clean run');
        Assert.AreEqual(51, Ledger.Amount, 'First ledger row amount must match the engine formula');
        Assert.IsTrue(Ledger.Get(4, 2), 'Second ledger row must persist after a clean run');
        Assert.AreEqual(29, Ledger.Amount, 'Second ledger row amount must match the engine formula');

        // [THEN] The audit trail records both phases
        Assert.IsTrue(LogPhaseExists(4, 'STARTED'), 'STARTED audit entry must exist after a successful run');
        Assert.IsTrue(LogPhaseExists(4, 'FINISHED'), 'FINISHED audit entry must exist after a successful run');

        AssertDecoyIntact();
    end;

    [Test]
    procedure FailedRunLeavesNoLedgerRowsButAuditTrailPresent()
    var
        Poster: Codeunit "CG X040 Poster";
        Ledger: Record "CG X040 Ledger";
    begin
        // [GIVEN] No prior rows for this batch, plus an unrelated pre-existing pair
        Reset();

        // [WHEN] PostBatch runs for a batch the engine will refuse
        Assert.IsFalse(Poster.PostBatch(5, -1), 'A refused batch must return false, not throw');

        // [THEN] No ledger row for this batch remains
        Ledger.SetRange("Batch Id", 5);
        Assert.IsTrue(Ledger.IsEmpty(), 'No ledger row for a refused batch may remain');

        // [THEN] The audit trail still records both phases — it is never purged
        Assert.IsTrue(LogPhaseExists(5, 'STARTED'), 'STARTED audit entry must exist even after a refused run');
        Assert.IsTrue(LogPhaseExists(5, 'FINISHED'), 'FINISHED audit entry must exist even after a refused run');

        AssertDecoyIntact();
    end;

    [Test]
    procedure FailThenRetrySameBatchSucceeds()
    var
        Poster: Codeunit "CG X040 Poster";
        Ledger: Record "CG X040 Ledger";
    begin
        // [GIVEN] No prior rows for this batch, plus an unrelated pre-existing pair
        Reset();

        // [WHEN] The batch is first refused, then re-submitted and accepted
        Assert.IsFalse(Poster.PostBatch(8, -3), 'The first, refused attempt must return false');
        Assert.IsTrue(Poster.PostBatch(8, 20), 'The retried, accepted attempt must return true');

        // [THEN] Only the accepted attempt's opaque rows remain — a leftover
        // marker from the refused attempt would collide with this insert.
        Assert.IsTrue(Ledger.Get(8, 1), 'First ledger row must persist after the accepted retry');
        Assert.AreEqual(95, Ledger.Amount, 'First ledger row amount must match the engine formula');
        Assert.IsTrue(Ledger.Get(8, 2), 'Second ledger row must persist after the accepted retry');
        Assert.AreEqual(49, Ledger.Amount, 'Second ledger row amount must match the engine formula');

        AssertDecoyIntact();
    end;

    [Test]
    procedure TwoSuccessfulRunsBothPersistIndependently()
    var
        Poster: Codeunit "CG X040 Poster";
        Ledger: Record "CG X040 Ledger";
    begin
        // [GIVEN] No prior rows for either batch, plus an unrelated pre-existing pair
        Reset();

        // [WHEN] PostBatch runs for two different accepted batches
        Assert.IsTrue(Poster.PostBatch(2, 3), 'First accepted batch should return true');
        Assert.IsTrue(Poster.PostBatch(7, 9), 'Second accepted batch should return true');

        // [THEN] Each batch's own rows persist independently with their own opaque values
        Assert.IsTrue(Ledger.Get(2, 1), 'First batch, first row must persist');
        Assert.AreEqual(29, Ledger.Amount, 'First batch, first row amount must match the engine formula');
        Assert.IsTrue(Ledger.Get(2, 2), 'First batch, second row must persist');
        Assert.AreEqual(19, Ledger.Amount, 'First batch, second row amount must match the engine formula');

        Assert.IsTrue(Ledger.Get(7, 1), 'Second batch, first row must persist');
        Assert.AreEqual(84, Ledger.Amount, 'Second batch, first row amount must match the engine formula');
        Assert.IsTrue(Ledger.Get(7, 2), 'Second batch, second row must persist');
        Assert.AreEqual(44, Ledger.Amount, 'Second batch, second row amount must match the engine formula');

        AssertDecoyIntact();
    end;
}
