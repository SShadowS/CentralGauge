codeunit 80330 "CG-AL-X041 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure Reset()
    var
        Doc: Record "CG X041 Doc";
    begin
        Doc.DeleteAll();
        Commit();

        // Pre-existing rows belonging to a completely different, unrelated
        // batch: one still open, one already posted. An unfiltered or
        // trigger-blind cleanup must never touch either.
        Doc.Init();
        Doc."Batch Id" := 999;
        Doc."Line No." := 1;
        Doc.Status := Doc.Status::Open;
        Doc.Amount := 42;
        Doc.Insert();

        Doc.Init();
        Doc."Batch Id" := 999;
        Doc."Line No." := 2;
        Doc.Status := Doc.Status::Posted;
        Doc.Amount := 84;
        Doc.Insert();
        Commit();
    end;

    local procedure AssertDecoyIntact()
    var
        Doc: Record "CG X041 Doc";
    begin
        Assert.IsTrue(Doc.Get(999, 1), 'The pre-existing unrelated open decoy row must never be removed');
        Assert.AreEqual(42, Doc.Amount, 'The pre-existing unrelated open decoy row must never be modified');
        Assert.IsTrue(Doc.Get(999, 2), 'The pre-existing unrelated posted decoy row must never be removed');
        Assert.AreEqual(84, Doc.Amount, 'The pre-existing unrelated posted decoy row must never be modified');
    end;

    [Test]
    procedure SuccessfulRunPersistsOpaqueDocRows()
    var
        Clerk: Codeunit "CG X041 Clerk";
        Doc: Record "CG X041 Doc";
    begin
        // [GIVEN] No prior rows for this batch, plus unrelated pre-existing rows
        Reset();

        // [WHEN] PostDoc runs for a batch the engine will accept
        Assert.IsTrue(Clerk.PostDoc(4, 10), 'An accepted batch should return true');

        // [THEN] Both of the engine's own (opaque) computed rows persist —
        // never derivable without really calling it.
        Assert.IsTrue(Doc.Get(4, 1), 'First doc line must persist after a clean run');
        Assert.AreEqual(80, Doc.Amount, 'First doc line amount must match the engine formula');
        Assert.AreEqual(Doc.Status::Posted, Doc.Status, 'First doc line must be posted');
        Assert.IsTrue(Doc.Get(4, 2), 'Second doc line must persist after a clean run');
        Assert.AreEqual(93, Doc.Amount, 'Second doc line amount must match the engine formula');
        Assert.AreEqual(Doc.Status::Open, Doc.Status, 'Second doc line must remain open');
        Assert.IsFalse(Doc.Get(4, 0), 'The pending marker must be gone after a clean run');

        AssertDecoyIntact();
    end;

    [Test]
    procedure FailedRunLeavesPostedLineIntactWithNoOpenResidue()
    var
        Clerk: Codeunit "CG X041 Clerk";
        Doc: Record "CG X041 Doc";
    begin
        // [GIVEN] No prior rows for this batch, plus unrelated pre-existing rows
        Reset();

        // [WHEN] PostDoc runs for a batch the engine will refuse
        Assert.IsFalse(Clerk.PostDoc(5, -1), 'A refused batch must return false, not throw');

        // [THEN] The line the engine already finalized before refusing remains
        // exactly as the engine left it — a refusal does not roll it back.
        Assert.IsTrue(Doc.Get(5, 1), 'The posted line the engine finalized before refusing must remain');
        Assert.AreEqual(99, Doc.Amount, 'The posted line amount must match the engine formula');
        Assert.AreEqual(Doc.Status::Posted, Doc.Status, 'The finalized line must still be posted');

        // [THEN] No open row for this batch may remain: neither the pending
        // marker nor any never-finalized line.
        Doc.SetRange("Batch Id", 5);
        Doc.SetRange(Status, Doc.Status::Open);
        Assert.IsTrue(Doc.IsEmpty(), 'No open doc row for a refused batch may remain');

        AssertDecoyIntact();
    end;

    [Test]
    procedure SecondFailedRunAlsoLeavesPostedLineIntact()
    var
        Clerk: Codeunit "CG X041 Clerk";
        Doc: Record "CG X041 Doc";
    begin
        // [GIVEN] No prior rows for this batch, plus unrelated pre-existing rows
        Reset();

        // [WHEN] PostDoc runs for a different refused batch, to block hardcoding
        Assert.IsFalse(Clerk.PostDoc(6, -7), 'A refused batch must return false, not throw');

        // [THEN] The finalized line remains, with its own distinct opaque amount
        Assert.IsTrue(Doc.Get(6, 1), 'The posted line the engine finalized before refusing must remain');
        Assert.AreEqual(118, Doc.Amount, 'The posted line amount must match the engine formula');
        Assert.AreEqual(Doc.Status::Posted, Doc.Status, 'The finalized line must still be posted');

        Doc.SetRange("Batch Id", 6);
        Doc.SetRange(Status, Doc.Status::Open);
        Assert.IsTrue(Doc.IsEmpty(), 'No open doc row for a refused batch may remain');

        AssertDecoyIntact();
    end;

    [Test]
    procedure FailedBatchResidueDoesNotBlockADifferentBatchSuccess()
    var
        Clerk: Codeunit "CG X041 Clerk";
        Doc: Record "CG X041 Doc";
    begin
        // [GIVEN] No prior rows for either batch, plus unrelated pre-existing rows
        Reset();

        // [WHEN] One batch is refused, then a completely different batch is accepted
        Assert.IsFalse(Clerk.PostDoc(8, -3), 'The refused batch must return false');
        Assert.IsTrue(Clerk.PostDoc(9, 15), 'The unrelated accepted batch should return true');

        // [THEN] The refused batch's finalized line remains untouched by the
        // later, unrelated call
        Assert.IsTrue(Doc.Get(8, 1), 'The earlier refused batch''s posted line must still remain');
        Assert.AreEqual(156, Doc.Amount, 'The earlier posted line amount must match the engine formula');
        Assert.AreEqual(Doc.Status::Posted, Doc.Status, 'The earlier posted line must still be posted');
        Doc.SetRange("Batch Id", 8);
        Doc.SetRange(Status, Doc.Status::Open);
        Assert.IsTrue(Doc.IsEmpty(), 'No open doc row for the earlier refused batch may remain');

        // [THEN] The later batch's own rows persist independently
        Assert.IsTrue(Doc.Get(9, 1), 'The later accepted batch''s first line must persist');
        Assert.AreEqual(175, Doc.Amount, 'The later accepted batch''s first line amount must match the engine formula');
        Assert.IsTrue(Doc.Get(9, 2), 'The later accepted batch''s second line must persist');
        Assert.AreEqual(208, Doc.Amount, 'The later accepted batch''s second line amount must match the engine formula');

        AssertDecoyIntact();
    end;

    [Test]
    procedure TwoSuccessfulRunsBothPersistIndependently()
    var
        Clerk: Codeunit "CG X041 Clerk";
        Doc: Record "CG X041 Doc";
    begin
        // [GIVEN] No prior rows for either batch, plus unrelated pre-existing rows
        Reset();

        // [WHEN] PostDoc runs for two different accepted batches
        Assert.IsTrue(Clerk.PostDoc(2, 3), 'First accepted batch should return true');
        Assert.IsTrue(Clerk.PostDoc(7, 9), 'Second accepted batch should return true');

        // [THEN] Each batch's own rows persist independently with their own opaque values
        Assert.IsTrue(Doc.Get(2, 1), 'First batch, first line must persist');
        Assert.AreEqual(42, Doc.Amount, 'First batch, first line amount must match the engine formula');
        Assert.IsTrue(Doc.Get(2, 2), 'First batch, second line must persist');
        Assert.AreEqual(47, Doc.Amount, 'First batch, second line amount must match the engine formula');

        Assert.IsTrue(Doc.Get(7, 1), 'Second batch, first line must persist');
        Assert.AreEqual(137, Doc.Amount, 'Second batch, first line amount must match the engine formula');
        Assert.IsTrue(Doc.Get(7, 2), 'Second batch, second line must persist');
        Assert.AreEqual(162, Doc.Amount, 'Second batch, second line amount must match the engine formula');

        AssertDecoyIntact();
    end;
}
