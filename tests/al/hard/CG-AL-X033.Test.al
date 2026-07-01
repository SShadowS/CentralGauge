codeunit 80322 "CG-AL-X033 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure ClearState()
    var
        Doc: Record "CG X033 Doc";
        Archive: Record "CG X033 Archive";
    begin
        // [GIVEN] self-heal: a prior run's trap-failure aborts on assertion
        // failure and never reaches end-of-test cleanup, which can leave
        // rows behind on the shared container.
        Doc.DeleteAll();
        Archive.DeleteAll();
    end;

    [Test]
    procedure ArchiveDocCopiesFieldsByNameForFirstDoc()
    var
        Doc: Record "CG X033 Doc";
        Archive: Record "CG X033 Archive";
        Archiver: Codeunit "CG X033 Archiver";
        ArchiveCheck: Record "CG X033 Archive";
    begin
        // [GIVEN]
        ClearState();

        // [GIVEN] opaque, distinct values so a field-number swap between
        // "Net Amount" and "Freight Amount" is unambiguously detectable
        Doc.Init();
        Doc."No." := 'D1';
        Doc."Net Amount" := 137.25;
        Doc."Freight Amount" := 42.50;
        Doc.Note := 'NOTE-D1';
        Doc.Insert();

        // [WHEN]
        Archiver.ArchiveDoc(Doc, Archive);

        // [THEN] read back the persisted row directly, not the in-memory var,
        // so the assertion proves the record was actually inserted
        Assert.IsTrue(ArchiveCheck.Get('D1'), 'Archive row for D1 must be inserted');
        Assert.AreEqual(137.25, ArchiveCheck."Net Amount", 'Archive Net Amount must hold the Doc Net Amount value');
        Assert.AreEqual(42.50, ArchiveCheck."Freight Amount", 'Archive Freight Amount must hold the Doc Freight Amount value');
        Assert.AreEqual('D1', ArchiveCheck."No.", 'Archive No. must match the Doc No.');
        Assert.AreEqual('NOTE-D1', ArchiveCheck.Note, 'Archive Note must match the Doc Note');

        ClearState();
    end;

    [Test]
    procedure ArchiveDocCopiesFieldsByNameForSecondDoc()
    var
        Doc: Record "CG X033 Doc";
        Archive: Record "CG X033 Archive";
        Archiver: Codeunit "CG X033 Archiver";
        ArchiveCheck: Record "CG X033 Archive";
    begin
        // [GIVEN]
        ClearState();

        // [GIVEN] a second, independently distinct value set, so the
        // discrimination isn't a one-off coincidence tied to a single pair
        // of numbers
        Doc.Init();
        Doc."No." := 'D2';
        Doc."Net Amount" := 88.10;
        Doc."Freight Amount" := 15.75;
        Doc.Note := 'NOTE-D2';
        Doc.Insert();

        // [WHEN]
        Archiver.ArchiveDoc(Doc, Archive);

        // [THEN]
        Assert.IsTrue(ArchiveCheck.Get('D2'), 'Archive row for D2 must be inserted');
        Assert.AreEqual(88.10, ArchiveCheck."Net Amount", 'Archive Net Amount must hold the Doc Net Amount value');
        Assert.AreEqual(15.75, ArchiveCheck."Freight Amount", 'Archive Freight Amount must hold the Doc Freight Amount value');
        Assert.AreEqual('D2', ArchiveCheck."No.", 'Archive No. must match the Doc No.');
        Assert.AreEqual('NOTE-D2', ArchiveCheck.Note, 'Archive Note must match the Doc Note');

        ClearState();
    end;
}
