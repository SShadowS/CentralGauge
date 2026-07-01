codeunit 80313 "CG-AL-X024 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure ClearState()
    var
        Rec: Record "CG X024 Token";
    begin
        // [GIVEN] self-heal: a prior run's trap-failure aborts the test
        // procedure on assertion failure and never reaches any end-of-test
        // cleanup, which can leave "CG X024 Token" rows behind on the
        // shared container. Wipe them before seeding.
        Rec.DeleteAll();
    end;

    [Test]
    procedure MixedCaseRefsAreReturnedExactly()
    var
        Registrar: Codeunit "CG X024 Registrar";
    begin
        ClearState();
        Commit();

        // [GIVEN/WHEN] several distinct external references registered,
        // each mixed-case with a lowercase form that differs from its
        // original casing.
        Registrar.Register(1, 'aB3xY9');
        Registrar.Register(2, 'Tok-9f2Kd');
        Registrar.Register(3, 'zzTOPz');

        // [THEN] each must come back byte-for-byte identical to what was
        // supplied, case preserved.
        Assert.AreEqual(
            'aB3xY9', Registrar.GetRef(1),
            'Entry 1 ref must be returned with its original casing preserved');
        Assert.AreEqual(
            'Tok-9f2Kd', Registrar.GetRef(2),
            'Entry 2 ref must be returned with its original casing preserved');
        Assert.AreEqual(
            'zzTOPz', Registrar.GetRef(3),
            'Entry 3 ref must be returned with its original casing preserved');

        ClearState();
    end;

    [Test]
    procedure AllUppercaseRefIsUnaffected()
    var
        Registrar: Codeunit "CG X024 Registrar";
    begin
        ClearState();
        Commit();

        // [GIVEN/WHEN] a reference that happens to already be all
        // uppercase/digits -- a sanity case that must pass regardless of
        // how case is (or isn't) preserved internally, since uppercasing a
        // value with no lowercase characters is a no-op.
        Registrar.Register(10, 'ABC123');

        // [THEN]
        Assert.AreEqual(
            'ABC123', Registrar.GetRef(10),
            'An already-uppercase ref must be returned unchanged');

        ClearState();
    end;

    [Test]
    procedure OverwritingAnExistingEntryUpdatesTheStoredRefExactly()
    var
        Registrar: Codeunit "CG X024 Registrar";
    begin
        ClearState();
        Commit();

        // [GIVEN] an entry registered once
        Registrar.Register(20, 'FirstRefXyz');
        Assert.AreEqual(
            'FirstRefXyz', Registrar.GetRef(20),
            'Initial ref must round-trip with casing preserved');

        // [WHEN] the same entry is re-registered with a different,
        // still-mixed-case reference
        Registrar.Register(20, 'SecondRefAbC');

        // [THEN] the stored value must be fully replaced, exact case
        // preserved, not merged/appended/left as the old value.
        Assert.AreEqual(
            'SecondRefAbC', Registrar.GetRef(20),
            'Re-registering an entry must overwrite the stored ref exactly, casing preserved');

        ClearState();
    end;
}
