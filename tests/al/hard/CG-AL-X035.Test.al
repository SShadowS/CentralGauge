codeunit 80324 "CG-AL-X035 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure Reset()
    var
        Entry: Record "CG X035 Entry";
    begin
        Entry.DeleteAll();
        Commit();
    end;

    [Test]
    procedure SuccessfulRunPersistsOpaqueResult()
    var
        Runner: Codeunit "CG X035 Runner";
        Entry: Record "CG X035 Entry";
    begin
        // [GIVEN] No prior Entry rows
        Reset();

        // [WHEN] TryProcess runs for a row the worker will accept
        Assert.IsTrue(Runner.TryProcess(5), 'A clean run should return true');

        // [THEN] The row persists, fully processed, with the worker's own
        // (opaque) computed value — never derivable without really calling it.
        Assert.IsTrue(Entry.Get(5), 'Entry row must persist after a clean run');
        Assert.IsTrue(Entry.Processed, 'Processed must be true after a clean run');
        Assert.AreEqual(49, Entry.Result, 'Result must equal the worker''s computed value');
    end;

    [Test]
    procedure WorkerFailureIsSwallowedButRowPersists()
    var
        Runner: Codeunit "CG X035 Runner";
        Entry: Record "CG X035 Entry";
    begin
        // [GIVEN] No prior Entry rows
        Reset();

        // [WHEN] TryProcess runs for a row the worker will refuse to process
        Assert.IsFalse(Runner.TryProcess(-3), 'A refused run must return false, not throw');

        // [THEN] The Entry row still exists (creation is unconditional) but
        // was never marked processed, since the worker's own write rolled back.
        Assert.IsTrue(Entry.Get(-3), 'Entry row must persist even when the worker refuses it');
        Assert.IsFalse(Entry.Processed, 'Processed must remain false when the worker refuses the row');
        Assert.AreEqual(0, Entry.Result, 'Result must remain unset when the worker refuses the row');
    end;

    [Test]
    procedure TwoSuccessfulRunsBothPersist()
    var
        Runner: Codeunit "CG X035 Runner";
        Entry: Record "CG X035 Entry";
    begin
        // [GIVEN] No prior Entry rows
        Reset();

        // [WHEN] TryProcess runs twice for two different accepted rows
        Assert.IsTrue(Runner.TryProcess(2), 'First clean run should return true');
        Assert.IsTrue(Runner.TryProcess(7), 'Second clean run should return true');

        // [THEN] Both rows persist with their own opaque computed values
        Assert.IsTrue(Entry.Get(2), 'First entry row must persist');
        Assert.IsTrue(Entry.Processed, 'First entry must be processed');
        Assert.AreEqual(22, Entry.Result, 'First entry result must match the worker formula');

        Assert.IsTrue(Entry.Get(7), 'Second entry row must persist');
        Assert.IsTrue(Entry.Processed, 'Second entry must be processed');
        Assert.AreEqual(67, Entry.Result, 'Second entry result must match the worker formula');
    end;
}
