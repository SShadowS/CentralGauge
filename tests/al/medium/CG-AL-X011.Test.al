codeunit 80300 "CG-AL-X011 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure ClearState()
    var
        Rec: Record "CG X011 Record";
    begin
        Rec.DeleteAll();
    end;

    [Test]
    procedure SetCViaUpdaterPreservesUpdaterFields()
    var
        Rec: Record "CG X011 Record";
        Modifier: Codeunit "CG X011 Modifier";
    begin
        // [GIVEN] self-heal: a prior run's trap-failure aborts the test
        // procedure on assertion failure and never reaches any end-of-test
        // cleanup, which can leave a "CG X011 Record" row behind on the
        // shared container. Wipe it, committed, before seeding.
        ClearState();
        Commit();

        // [GIVEN] a seeded row with every field at zero
        Rec.Init();
        Rec."Code" := 'R1';
        Rec.A := 0;
        Rec.B := 0;
        Rec.C := 0;
        Rec.Insert();

        // [WHEN]
        Modifier.SetCViaUpdater('R1', 5);

        // [THEN] the persisted row must carry BOTH the updater's field
        // updates AND this call's own update -- none may be lost
        Rec.Get('R1');
        Assert.AreEqual(10, Rec.A, 'A must carry the value the Updater applied');
        Assert.AreEqual(20, Rec.B, 'B must carry the value the Updater applied');
        Assert.AreEqual(5, Rec.C, 'C must carry the value SetCViaUpdater applied');

        ClearState();
    end;

    [Test]
    procedure SetCViaUpdaterPreservesUpdaterFieldsFromNonZeroStart()
    var
        Rec: Record "CG X011 Record";
        Modifier: Codeunit "CG X011 Modifier";
    begin
        // [GIVEN] self-heal
        ClearState();
        Commit();

        // [GIVEN] a second row with different, non-zero starting values and
        // a different target C, so a solution can't pass by coincidence on a
        // single scenario
        Rec.Init();
        Rec."Code" := 'R2';
        Rec.A := 1;
        Rec.B := 2;
        Rec.C := 3;
        Rec.Insert();

        // [WHEN]
        Modifier.SetCViaUpdater('R2', 99);

        // [THEN]
        Rec.Get('R2');
        Assert.AreEqual(10, Rec.A, 'A must carry the value the Updater applied');
        Assert.AreEqual(20, Rec.B, 'B must carry the value the Updater applied');
        Assert.AreEqual(99, Rec.C, 'C must carry the value SetCViaUpdater applied');

        ClearState();
    end;
}
