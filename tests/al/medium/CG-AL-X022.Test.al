codeunit 80311 "CG-AL-X022 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure ClearState()
    var
        Rec: Record "CG X022 Account";
    begin
        // [GIVEN] self-heal: a prior run's trap-failure aborts the test
        // procedure on assertion failure and never reaches any end-of-test
        // cleanup, which can leave a "CG X022 Account" row behind on the
        // shared container. Wipe it, committed, before seeding.
        Rec.DeleteAll();
    end;

    [Test]
    procedure NoOpModifyProducesZeroDelta()
    var
        Rec: Record "CG X022 Account";
    begin
        ClearState();
        Commit();

        // [GIVEN] a seeded row
        Rec.Init();
        Rec."No." := 'C';
        Rec.Balance := 100;
        Rec.Insert(true);

        // [WHEN] modified without changing Balance at all -- proves the
        // trigger fires sanely (zero delta) rather than being universally
        // broken, regardless of how "previous value" is determined.
        Rec.Get('C');
        Rec.Modify(true);

        // [THEN]
        Rec.Get('C');
        Assert.AreEqual(
            0,
            Rec."Last Delta",
            'Last Delta must be zero when Balance did not actually change');

        ClearState();
    end;

    [Test]
    procedure ModifyViaFreshGetProducesCorrectDelta()
    var
        Rec: Record "CG X022 Account";
    begin
        ClearState();
        Commit();

        // [GIVEN] a seeded row
        Rec.Init();
        Rec."No." := 'A';
        Rec.Balance := 100;
        Rec.Insert(true);

        // [WHEN] modified through a variable that was freshly Get'd
        // immediately before the change.
        Rec.Get('A');
        Rec.Balance := 260;
        Rec.Modify(true);

        // [THEN] the persisted delta must reflect the true change against
        // what was actually stored beforehand.
        Rec.Get('A');
        Assert.AreEqual(
            160,
            Rec."Last Delta",
            'Last Delta must reflect the true Balance change on a fresh-Get modify path');

        ClearState();
    end;

    [Test]
    procedure ModifyViaFreshVariableStillProducesCorrectDelta()
    var
        Rec: Record "CG X022 Account";
        Other: Record "CG X022 Account";
    begin
        ClearState();
        Commit();

        // [GIVEN] a seeded row
        Rec.Init();
        Rec."No." := 'B';
        Rec.Balance := 100;
        Rec.Insert(true);

        // [WHEN] modified through a SEPARATE variable that was never
        // positioned on the row via Get/Find -- only initialized, given the
        // primary key, given the new value, and modified. A plausible
        // caller pattern (e.g. a helper procedure that builds a record from
        // scratch to apply a targeted update) that never read this row's
        // true previous persisted state into this particular variable.
        Other.Init();
        Other."No." := 'B';
        Other.Balance := 175;
        Other.Modify(true);

        // [THEN] the persisted delta must still reflect the true change
        // against what was actually stored, regardless of which variable
        // performed the modification.
        Rec.Get('B');
        Assert.AreEqual(
            75,
            Rec."Last Delta",
            'Last Delta must reflect the true prior Balance actually stored, not a blank/zero value from an unread variable');

        ClearState();
    end;
}
