codeunit 80324 "CG-AL-X035 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure Reset()
    var
        Attempt: Record "CG X035 Attempt";
    begin
        Attempt.DeleteAll();
        Commit();
    end;

    [Test]
    procedure SuccessfulRunPersistsOpaqueResult()
    var
        Runner: Codeunit "CG X035 Runner";
        Attempt: Record "CG X035 Attempt";
    begin
        // [GIVEN] No prior Attempt rows
        Reset();

        // [WHEN] TryProcess runs for a row the engine will accept
        Assert.IsTrue(Runner.TryProcess(5), 'A clean run should return true');

        // [THEN] The row persists, fully processed, with the engine's own
        // (opaque) computed value — never derivable without really calling it.
        Assert.IsTrue(Attempt.Get(5), 'Attempt row must persist after a clean run');
        Assert.IsTrue(Attempt.Processed, 'Processed must be true after a clean run');
        Assert.AreEqual(49, Attempt.Result, 'Result must equal the engine''s computed value');
    end;

    [Test]
    procedure EngineFailureIsSwallowedButRowPersists()
    var
        Runner: Codeunit "CG X035 Runner";
        Attempt: Record "CG X035 Attempt";
    begin
        // [GIVEN] No prior Attempt rows
        Reset();

        // [WHEN] TryProcess runs for a row the engine will refuse to process
        Assert.IsFalse(Runner.TryProcess(-3), 'A refused run must return false, not throw');

        // [THEN] The Attempt row still exists (creation is unconditional) but
        // was never marked processed, since the engine's own write rolled back.
        Assert.IsTrue(Attempt.Get(-3), 'Attempt row must persist even when the engine refuses it');
        Assert.IsFalse(Attempt.Processed, 'Processed must remain false when the engine refuses the row');
        Assert.AreEqual(0, Attempt.Result, 'Result must remain unset when the engine refuses the row');
    end;

    [Test]
    procedure TwoSuccessfulRunsBothPersist()
    var
        Runner: Codeunit "CG X035 Runner";
        Attempt: Record "CG X035 Attempt";
    begin
        // [GIVEN] No prior Attempt rows
        Reset();

        // [WHEN] TryProcess runs twice for two different accepted rows
        Assert.IsTrue(Runner.TryProcess(2), 'First clean run should return true');
        Assert.IsTrue(Runner.TryProcess(7), 'Second clean run should return true');

        // [THEN] Both rows persist with their own opaque computed values
        Assert.IsTrue(Attempt.Get(2), 'First attempt row must persist');
        Assert.IsTrue(Attempt.Processed, 'First attempt must be processed');
        Assert.AreEqual(22, Attempt.Result, 'First attempt result must match the engine formula');

        Assert.IsTrue(Attempt.Get(7), 'Second attempt row must persist');
        Assert.IsTrue(Attempt.Processed, 'Second attempt must be processed');
        Assert.AreEqual(67, Attempt.Result, 'Second attempt result must match the engine formula');
    end;
}
