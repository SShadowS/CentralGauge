codeunit 80314 "CG-AL-X025 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure ClearState()
    var
        Doc: Record "CG X025 Doc";
        Log: Record "CG X025 Doc Log";
    begin
        // [GIVEN] self-heal: a prior run's trap-failure aborts the test
        // procedure on assertion failure and never reaches any end-of-test
        // cleanup, which can leave rows behind on the shared container. Wipe
        // both persistent tables, committed, before seeding.
        Doc.DeleteAll();
        Log.DeleteAll();
    end;

    [Test]
    procedure OnlyPersistedInsertsAreLogged()
    var
        Doc: Record "CG X025 Doc";
        TempDoc: Record "CG X025 Doc" temporary;
        Log: Record "CG X025 Doc Log";
    begin
        ClearState();
        Commit();

        // [WHEN] real (persisted) and in-memory document inserts are
        // interleaved -- real(101), temp(201), real(102), temp(202),
        // temp(203) -- so the correct outcome cannot be reproduced by a naive
        // implementation that keys off insertion position or a simple count.

        Doc.Init();
        Doc."Entry No." := 101;
        Doc.Name := 'Real A';
        Doc.Insert(true);

        TempDoc.Init();
        TempDoc."Entry No." := 201;
        TempDoc.Name := 'Temp A';
        TempDoc.Insert(true);

        Doc.Init();
        Doc."Entry No." := 102;
        Doc.Name := 'Real B';
        Doc.Insert(true);

        TempDoc.Init();
        TempDoc."Entry No." := 202;
        TempDoc.Name := 'Temp B';
        TempDoc.Insert(true);

        TempDoc.Init();
        TempDoc."Entry No." := 203;
        TempDoc.Name := 'Temp C';
        TempDoc.Insert(true);

        // [THEN] exactly two log rows exist -- one per persisted document --
        // and none of the three in-memory documents produced a log row.
        Assert.AreEqual(
            2,
            Log.Count(),
            'Exactly the two persisted document inserts must be logged; in-memory inserts must not be');

        // [THEN] the logged entry numbers are the two persisted documents',
        // never an in-memory document's entry number.
        Log.SetRange("Doc Entry No.", 101);
        Assert.AreEqual(1, Log.Count(), 'Persisted document 101 must be logged exactly once');
        Log.SetRange("Doc Entry No.", 102);
        Assert.AreEqual(1, Log.Count(), 'Persisted document 102 must be logged exactly once');

        Log.SetRange("Doc Entry No.", 201);
        Assert.AreEqual(0, Log.Count(), 'In-memory document 201 must never be logged');
        Log.SetRange("Doc Entry No.", 202);
        Assert.AreEqual(0, Log.Count(), 'In-memory document 202 must never be logged');
        Log.SetRange("Doc Entry No.", 203);
        Assert.AreEqual(0, Log.Count(), 'In-memory document 203 must never be logged');

        Log.Reset();
        ClearState();
    end;
}
