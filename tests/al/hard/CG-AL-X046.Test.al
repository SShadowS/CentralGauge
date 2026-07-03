codeunit 80335 "CG-AL-X046 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure ClearState()
    var
        Doc: Record "CG X046 Doc";
        Archive: Record "CG X046 Archive";
    begin
        // [GIVEN] self-heal: a prior run's trap-failure aborts on assertion
        // failure and never reaches end-of-test cleanup, which can leave
        // rows behind on the shared container.
        Doc.DeleteAll();
        Archive.DeleteAll();
    end;

    [Test]
    procedure ArchivePreservesIdentityAndCurrentPayloadForFirstDoc()
    var
        Doc: Record "CG X046 Doc";
        DecoyDoc: Record "CG X046 Doc";
        DecoyArchive: Record "CG X046 Archive";
        ArchiveCountCheck: Record "CG X046 Archive";
        Archiver: Codeunit "CG X046 Archiver";
        DocCheck: Record "CG X046 Doc";
        ArchiveCheck: Record "CG X046 Archive";
    begin
        // [GIVEN]
        ClearState();

        // [GIVEN] opaque, distinct seed values
        Doc.Init();
        Doc."No." := 'D1';
        Doc.Amount := 500;
        Doc.Note := 'NOTE-D1';
        Doc.Insert();

        // [GIVEN] a decoy doc that is never archived, plus a pre-existing
        // decoy archive row that must be left completely untouched by
        // archiving D1
        DecoyDoc.Init();
        DecoyDoc."No." := 'D9';
        DecoyDoc.Amount := 999;
        DecoyDoc.Note := 'NOTE-D9';
        DecoyDoc.Insert();

        DecoyArchive.Init();
        DecoyArchive."No." := 'D9';
        DecoyArchive.Amount := 999;
        DecoyArchive.Note := 'NOTE-D9';
        DecoyArchive.Insert();

        // [WHEN]
        Archiver.Archive('D1');

        // [THEN] the Vault's stash actually ran: the doc row's payload must
        // have moved off the seed values (proves the archive path cannot be
        // reading a pre-stash snapshot)
        Assert.IsTrue(DocCheck.Get('D1'), 'Doc D1 must still exist after Archive');
        Assert.AreNotEqual(500, DocCheck.Amount, 'Vault.Stash must have run on D1 before archiving (Amount unchanged from seed)');
        Assert.AreEqual(847, DocCheck.Amount, 'Doc D1 Amount must reflect the Vault stash');
        Assert.AreEqual('VAULT-D1-NOTE-D1', DocCheck.Note, 'Doc D1 Note must reflect the Vault stash');

        // [THEN] exactly one archive row for D1, carrying the CURRENT
        // (post-stash) payload
        Assert.IsTrue(ArchiveCheck.Get('D1'), 'Archive row for D1 must be inserted');
        Assert.AreEqual(DocCheck.Amount, ArchiveCheck.Amount, 'Archive Amount must equal the Doc row current Amount');
        Assert.AreEqual(DocCheck.Note, ArchiveCheck.Note, 'Archive Note must equal the Doc row current Note');

        // [THEN] identity preserved: Archive carries the SAME SystemId as Doc
        Assert.AreEqual(DocCheck.SystemId, ArchiveCheck.SystemId, 'Archive SystemId must equal the Doc SystemId (identity must be carried, not regenerated)');

        // [THEN] decoy row completely untouched
        DecoyArchive.Get('D9');
        Assert.AreEqual(999, DecoyArchive.Amount, 'Decoy archive row for D9 must be untouched');
        Assert.AreEqual('NOTE-D9', DecoyArchive.Note, 'Decoy archive row for D9 must be untouched');

        // [THEN] no stray extra archive rows were created
        ArchiveCountCheck.Reset();
        Assert.AreEqual(2, ArchiveCountCheck.Count(), 'Exactly D1 + decoy D9 archive rows must exist, no extras');

        ClearState();
    end;

    [Test]
    procedure ArchivePreservesIdentityAndCurrentPayloadForSecondDoc()
    var
        Doc: Record "CG X046 Doc";
        Archiver: Codeunit "CG X046 Archiver";
        DocCheck: Record "CG X046 Doc";
        ArchiveCheck: Record "CG X046 Archive";
    begin
        // [GIVEN] a second, independently distinct value set, so the
        // discrimination isn't a one-off coincidence tied to a single delta
        ClearState();

        Doc.Init();
        Doc."No." := 'D2';
        Doc.Amount := 120;
        Doc.Note := 'NOTE-D2';
        Doc.Insert();

        // [WHEN]
        Archiver.Archive('D2');

        // [THEN]
        Assert.IsTrue(DocCheck.Get('D2'), 'Doc D2 must still exist after Archive');
        Assert.AreEqual(932, DocCheck.Amount, 'Doc D2 Amount must reflect the Vault stash');
        Assert.AreEqual('VAULT-D2-NOTE-D2', DocCheck.Note, 'Doc D2 Note must reflect the Vault stash');

        Assert.IsTrue(ArchiveCheck.Get('D2'), 'Archive row for D2 must be inserted');
        Assert.AreEqual(DocCheck.Amount, ArchiveCheck.Amount, 'Archive Amount must equal the Doc row current Amount');
        Assert.AreEqual(DocCheck.Note, ArchiveCheck.Note, 'Archive Note must equal the Doc row current Note');
        Assert.AreEqual(DocCheck.SystemId, ArchiveCheck.SystemId, 'Archive SystemId must equal the Doc SystemId (identity must be carried, not regenerated)');

        ClearState();
    end;
}
