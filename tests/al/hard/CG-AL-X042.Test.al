codeunit 80331 "CG-AL-X042 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure Reset()
    var
        Order: Record "CG X042 Order";
        Shadow: Record "CG X042 Shadow";
    begin
        Order.DeleteAll();
        Shadow.DeleteAll();
        Commit();

        // Pre-existing rows belonging to a completely different, unrelated
        // batch, in BOTH tables. A cleanup that isn't correctly filtered —
        // or that isn't trigger-aware — must never touch either row.
        Order.Init();
        Order."Batch Id" := 999;
        Order.Step := 5;
        Order.Amount := 777;
        Order.Insert();

        Shadow.Init();
        Shadow."Batch Id" := 999;
        Shadow.Step := 5;
        Shadow.Checksum := 314;
        Shadow.Insert();
        Commit();
    end;

    local procedure AssertDecoyIntact()
    var
        Order: Record "CG X042 Order";
        Shadow: Record "CG X042 Shadow";
    begin
        Assert.IsTrue(Order.Get(999, 5), 'The pre-existing unrelated order decoy row must never be removed');
        Assert.AreEqual(777, Order.Amount, 'The pre-existing unrelated order decoy row must never be modified');
        Assert.IsTrue(Shadow.Get(999, 5), 'The pre-existing unrelated shadow decoy row must never be removed');
        Assert.AreEqual(314, Shadow.Checksum, 'The pre-existing unrelated shadow decoy row must never be modified');
    end;

    local procedure AssertNoResidue(BatchId: Integer)
    var
        Order: Record "CG X042 Order";
        Shadow: Record "CG X042 Shadow";
    begin
        Order.SetRange("Batch Id", BatchId);
        Assert.IsTrue(Order.IsEmpty(), 'No CG X042 Order row for a refused batch may remain');
        Shadow.SetRange("Batch Id", BatchId);
        Assert.IsTrue(Shadow.IsEmpty(), 'No CG X042 Shadow row for a refused batch may remain');
    end;

    [Test]
    procedure SuccessfulRunPersistsOpaqueOrderAndShadowRows()
    var
        Booker: Codeunit "CG X042 Booker";
        Order: Record "CG X042 Order";
        Shadow: Record "CG X042 Shadow";
    begin
        // [GIVEN] No prior rows for this batch, plus unrelated pre-existing rows
        Reset();

        // [WHEN] Book runs for a batch the engine will accept
        Assert.IsTrue(Booker.Book(4, 10), 'An accepted batch should return true');

        // [THEN] The engine's own opaque computed order row persists, never
        // derivable without really calling it
        Assert.IsTrue(Order.Get(4, 1), 'The order row must persist after a clean run');
        Assert.AreEqual(119, Order.Amount, 'The order row amount must match the engine formula');
        Assert.IsFalse(Order.Get(4, 0), 'The pending marker must be gone after a clean run');

        // [THEN] Its companion shadow row persists too, with the matching checksum
        Assert.IsTrue(Shadow.Get(4, 1), 'The shadow row must persist after a clean run');
        Assert.AreEqual(358, Shadow.Checksum, 'The shadow checksum must match the order amount formula');
        Assert.IsFalse(Shadow.Get(4, 0), 'The marker''s shadow row must be gone after a clean run');

        AssertDecoyIntact();
    end;

    [Test]
    procedure FailedRunLeavesNoResidueInEitherTable()
    var
        Booker: Codeunit "CG X042 Booker";
    begin
        // [GIVEN] No prior rows for this batch, plus unrelated pre-existing rows
        Reset();

        // [WHEN] Book runs for a batch the engine will refuse
        Assert.IsFalse(Booker.Book(5, -1), 'A refused batch must return false, not throw');

        // [THEN] Nothing for this batch may remain in EITHER table
        AssertNoResidue(5);
        AssertDecoyIntact();
    end;

    [Test]
    procedure SecondFailedRunDifferentBatchAlsoLeavesNoResidue()
    var
        Booker: Codeunit "CG X042 Booker";
    begin
        // [GIVEN] No prior rows for this batch, plus unrelated pre-existing rows
        Reset();

        // [WHEN] Book runs for a different refused batch, to block hardcoding
        Assert.IsFalse(Booker.Book(6, -7), 'A refused batch must return false, not throw');

        // [THEN] Nothing for this batch may remain in EITHER table
        AssertNoResidue(6);
        AssertDecoyIntact();
    end;

    [Test]
    procedure FailThenRetrySameBatchSucceeds()
    var
        Booker: Codeunit "CG X042 Booker";
        Order: Record "CG X042 Order";
        Shadow: Record "CG X042 Shadow";
    begin
        // [GIVEN] No prior rows for this batch, plus unrelated pre-existing rows
        Reset();

        // [WHEN] The batch is first refused
        Assert.IsFalse(Booker.Book(8, -3), 'The refused batch must return false');

        // [THEN] Nothing for this batch may remain in either table — a
        // leftover shadow row here would collide with the retry below
        AssertNoResidue(8);

        // [WHEN] The SAME batch id is retried and now accepted
        Assert.IsTrue(Booker.Book(8, 21), 'A retried batch the engine now accepts must return true, not throw');

        // [THEN] The retry's own opaque rows persist cleanly
        Assert.IsTrue(Order.Get(8, 1), 'The retried batch''s order row must persist');
        Assert.AreEqual(235, Order.Amount, 'The retried batch''s order amount must match the engine formula');
        Assert.IsFalse(Order.Get(8, 0), 'The pending marker must be gone after the retry succeeds');
        Assert.IsTrue(Shadow.Get(8, 1), 'The retried batch''s shadow row must persist');
        Assert.AreEqual(706, Shadow.Checksum, 'The retried batch''s shadow checksum must match the formula');

        AssertDecoyIntact();
    end;

    [Test]
    procedure TwoSuccessfulRunsBothPersistIndependently()
    var
        Booker: Codeunit "CG X042 Booker";
        Order: Record "CG X042 Order";
        Shadow: Record "CG X042 Shadow";
    begin
        // [GIVEN] No prior rows for either batch, plus unrelated pre-existing rows
        Reset();

        // [WHEN] Book runs for two different accepted batches
        Assert.IsTrue(Booker.Book(2, 3), 'First accepted batch should return true');
        Assert.IsTrue(Booker.Book(7, 9), 'Second accepted batch should return true');

        // [THEN] Each batch's own rows persist independently with their own opaque values
        Assert.IsTrue(Order.Get(2, 1), 'First batch order row must persist');
        Assert.AreEqual(61, Order.Amount, 'First batch order amount must match the engine formula');
        Assert.IsTrue(Shadow.Get(2, 1), 'First batch shadow row must persist');
        Assert.AreEqual(184, Shadow.Checksum, 'First batch shadow checksum must match the formula');

        Assert.IsTrue(Order.Get(7, 1), 'Second batch order row must persist');
        Assert.AreEqual(206, Order.Amount, 'Second batch order amount must match the engine formula');
        Assert.IsTrue(Shadow.Get(7, 1), 'Second batch shadow row must persist');
        Assert.AreEqual(619, Shadow.Checksum, 'Second batch shadow checksum must match the formula');

        AssertDecoyIntact();
    end;
}
