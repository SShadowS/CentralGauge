codeunit 80291 "CG-AL-X002 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure Reset()
    var
        State: Record "CG X002 State";
        Input: Record "CG X002 Input";
        Result: Record "CG X002 Result";
    begin
        State.DeleteAll();
        Input.DeleteAll();
        Result.DeleteAll();
        Commit();
    end;

    local procedure AddInput(EntryNo: Integer; Value: Integer)
    var
        Input: Record "CG X002 Input";
    begin
        Input.Init();
        Input."Entry No." := EntryNo;
        Input.Value := Value;
        Input.Insert();
    end;

    [Test]
    procedure CleanRunCompletesAndPersists()
    var
        Migration: Codeunit "CG X002 Migration";
        Result: Record "CG X002 Result";
        State: Record "CG X002 State";
    begin
        // [GIVEN] Three valid inputs, no prior state
        Reset();
        AddInput(1, 10);
        AddInput(2, 20);
        AddInput(3, 30);
        Commit();

        // [WHEN] The migration runs
        Assert.IsTrue(Migration.RunOnce(), 'Clean run should return true');

        // [THEN] All result rows persist and the guard is set
        Assert.AreEqual(3, Result.Count(), 'All three inputs produce result rows');
        Assert.IsTrue(State.Get('') and State.Done, 'Guard Done must be true after a clean run');
    end;

    [Test]
    procedure FailureRollsBackAndIsCatchable()
    var
        Migration: Codeunit "CG X002 Migration";
        Result: Record "CG X002 Result";
        State: Record "CG X002 State";
    begin
        // [GIVEN] A poison input (negative value) between valid ones
        Reset();
        AddInput(1, 10);
        AddInput(2, -1);
        AddInput(3, 30);
        Commit();

        // [WHEN] The migration runs — it must NOT crash this test
        Assert.IsFalse(Migration.RunOnce(), 'Failed run should return false, not throw');

        // [THEN] Every write rolled back: no result rows, guard not set
        Assert.AreEqual(0, Result.Count(), 'A failed run rolls back all result rows');
        if State.Get('') then
            Assert.IsFalse(State.Done, 'Guard must not be set when the run failed');
    end;

    [Test]
    procedure RetryAfterFixSucceeds()
    var
        Migration: Codeunit "CG X002 Migration";
        Result: Record "CG X002 Result";
        Input: Record "CG X002 Input";
    begin
        // [GIVEN] A poison run happened, then the poison is removed
        Reset();
        AddInput(1, 10);
        AddInput(2, -1);
        Commit();
        Migration.RunOnce();
        Input.Get(2);
        Input.Value := 20;
        Input.Modify();
        Commit();

        // [WHEN] The migration is retried
        Assert.IsTrue(Migration.RunOnce(), 'Retry after fixing input should succeed');

        // [THEN] Both rows now persist
        Assert.AreEqual(2, Result.Count(), 'Retry produces the full result set');
    end;

    [Test]
    procedure AlreadyDoneIsNoOp()
    var
        Migration: Codeunit "CG X002 Migration";
        Result: Record "CG X002 Result";
    begin
        // [GIVEN] A completed migration, then a late input arrives
        Reset();
        AddInput(1, 10);
        Commit();
        Migration.RunOnce();
        AddInput(2, 20);
        Commit();

        // [WHEN] The migration runs again
        Assert.IsTrue(Migration.RunOnce(), 'Re-run returns true');

        // [THEN] The late input is ignored (guard short-circuits)
        Assert.AreEqual(1, Result.Count(), 'Guard prevents re-processing');
    end;
}
