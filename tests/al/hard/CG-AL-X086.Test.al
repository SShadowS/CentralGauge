codeunit 89083 "CG-AL-X086 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods (SOAP
    // runner), so every test clears both tables before seeding its own rows.
    // Sentinel field values are always distinct from anything a sync call
    // would write, so "untouched" and "overwritten by the feed" stay
    // distinguishable.

    local procedure SeedContact(ContactId: Code[20]; CompanyName: Text[100]; VATRegistrationNo: Text[20]; Address: Text[100]; Status: Text[20]; LastSynced: DateTime)
    var
        Contact: Record "CG X086 Contact";
    begin
        Contact.Init();
        Contact."Contact Id" := ContactId;
        Contact."Company Name" := CompanyName;
        Contact."VAT Registration No." := VATRegistrationNo;
        Contact."Address" := Address;
        Contact."Status" := Status;
        Contact."Last Synced" := LastSynced;
        Contact.Insert();
    end;

    local procedure SeedFeedLine(LineNo: Integer; ExternalContactId: Code[20]; NewExternalContactId: Code[20]; CompanyName: Text[100]; VATRegistrationNo: Text[20]; Address: Text[100]; Status: Text[20])
    var
        FeedLine: Record "CG X086 Feed Line";
    begin
        FeedLine.Init();
        FeedLine."Line No." := LineNo;
        FeedLine."External Contact Id" := ExternalContactId;
        FeedLine."New External Contact Id" := NewExternalContactId;
        FeedLine."Company Name" := CompanyName;
        FeedLine."VAT Registration No." := VATRegistrationNo;
        FeedLine."Address" := Address;
        FeedLine."Status" := Status;
        FeedLine.Insert();
    end;

    [Test]
    procedure NewContactIsInsertedFromFeedWithNoRenameRequested()
    var
        FeedLine: Record "CG X086 Feed Line";
        Contact: Record "CG X086 Contact";
        FeedImport: Codeunit "CG X086 Feed Import";
    begin
        Contact.DeleteAll();
        FeedLine.DeleteAll();
        SeedContact('UNTOUCH1', 'Untouched Co', 'UNTOUCHVAT', 'Untouched Addr', 'UntouchedStat', CreateDateTime(20250101D, 080000T));
        SeedFeedLine(1, 'NEWCUST1', '', 'Brand New Co', 'NEWVAT01', 'New Addr', 'Active');

        FeedImport.ImportFeed(FeedLine);

        Contact.Get('NEWCUST1');
        Assert.AreEqual('Brand New Co', Contact."Company Name", 'A first-time feed contact must be created with the feed''s company name');
        Assert.AreEqual('NEWVAT01', Contact."VAT Registration No.", 'A first-time feed contact must be created with the feed''s VAT registration number');
        Assert.AreEqual('New Addr', Contact."Address", 'A first-time feed contact must be created with the feed''s address');
        Assert.AreEqual('Active', Contact."Status", 'A first-time feed contact must be created with the feed''s status');

        Contact.Get('UNTOUCH1');
        Assert.AreEqual('Untouched Co', Contact."Company Name", 'An unrelated contact must not be affected by importing a different feed line');
    end;

    [Test]
    procedure CleanRenameMovesContactAndRefreshesFieldsUnderTheNewId()
    var
        Contact: Record "CG X086 Contact";
        ContactSync: Codeunit "CG X086 Contact Sync";
    begin
        Contact.DeleteAll();
        SeedContact('OLDID1', 'Old Name', 'OLDVAT01', 'Old Addr', 'OldStat', CreateDateTime(20250101D, 080000T));

        ContactSync.SyncContact('OLDID1', 'NEWID1', 'Renamed Co', 'NEWVAT01', 'New Addr', 'Active');

        Assert.IsTrue(Contact.Get('NEWID1'), 'The contact must be found under the feed''s new id after a non-colliding rename');
        Assert.AreEqual('Renamed Co', Contact."Company Name", 'The renamed contact''s company name must come from the feed');
        Assert.AreEqual('NEWVAT01', Contact."VAT Registration No.", 'The renamed contact''s VAT registration number must come from the feed');
        Assert.AreEqual('New Addr', Contact."Address", 'The renamed contact''s address must come from the feed');
        Assert.AreEqual('Active', Contact."Status", 'The renamed contact''s status must come from the feed');
        Assert.IsFalse(Contact.Get('OLDID1'), 'The contact must no longer be found under its old id once the rename has been applied');
    end;

    [Test]
    procedure CleanMergeViaImportFeedMovesContactAndRefreshesFieldsUnderTheNewId()
    var
        FeedLine: Record "CG X086 Feed Line";
        Contact: Record "CG X086 Contact";
        FeedImport: Codeunit "CG X086 Feed Import";
    begin
        Contact.DeleteAll();
        FeedLine.DeleteAll();
        SeedContact('OLDID2', 'Old Name Two', 'OLDVAT02', 'Old Addr Two', 'OldStat2', CreateDateTime(20250101D, 080000T));
        SeedFeedLine(1, 'OLDID2', 'NEWID2', 'Merged Co', 'MERGEVAT2', 'Merged Addr', 'Active');

        FeedImport.ImportFeed(FeedLine);

        Assert.IsTrue(Contact.Get('NEWID2'), 'The contact must be found under the feed''s merged id after ImportFeed applies a non-colliding merge');
        Assert.AreEqual('Merged Co', Contact."Company Name", 'The merged contact''s company name must come from the feed');
        Assert.AreEqual('MERGEVAT2', Contact."VAT Registration No.", 'The merged contact''s VAT registration number must come from the feed');
        Assert.AreEqual('Merged Addr', Contact."Address", 'The merged contact''s address must come from the feed');
        Assert.AreEqual('Active', Contact."Status", 'The merged contact''s status must come from the feed');
        Assert.IsFalse(Contact.Get('OLDID2'), 'The contact must no longer be found under its old id once ImportFeed has applied the merge');
    end;

    [Test]
    procedure CollisionSkipLeavesTheLosingContactUnderItsOldIdWithStaleFields()
    var
        FeedLine: Record "CG X086 Feed Line";
        Contact: Record "CG X086 Contact";
        FeedImport: Codeunit "CG X086 Feed Import";
    begin
        Contact.DeleteAll();
        FeedLine.DeleteAll();
        SeedContact('TARGET1', 'Target Co', 'TARGVAT01', 'Target Addr', 'TargetStat', CreateDateTime(20250101D, 080000T));
        SeedContact('LOSING1', 'Losing Co', 'LOSEVAT01', 'Losing Addr', 'LosingStat', CreateDateTime(20250102D, 080000T));
        SeedFeedLine(1, 'LOSING1', 'TARGET1', 'Feed Update Co', 'FEEDVAT1', 'Feed Addr', 'FeedStat');
        Commit();

        asserterror FeedImport.ImportFeed(FeedLine);

        Assert.IsTrue(Contact.Get('LOSING1'), 'The losing contact must still be found under its old id after a colliding sync is attempted');
        Assert.AreEqual('Losing Co', Contact."Company Name", 'A colliding sync must not refresh the losing contact''s company name');
        Assert.AreEqual('LOSEVAT01', Contact."VAT Registration No.", 'A colliding sync must not refresh the losing contact''s VAT registration number');
        Assert.AreEqual('Losing Addr', Contact."Address", 'A colliding sync must not refresh the losing contact''s address');
        Assert.AreEqual('LosingStat', Contact."Status", 'A colliding sync must not refresh the losing contact''s status');
        Assert.AreEqual(CreateDateTime(20250102D, 080000T), Contact."Last Synced", 'A colliding sync must not refresh the losing contact''s last-synced time');
    end;

    [Test]
    procedure CollisionSkipLeavesTheCollidingContactUntouched()
    var
        FeedLine: Record "CG X086 Feed Line";
        Contact: Record "CG X086 Contact";
        FeedImport: Codeunit "CG X086 Feed Import";
    begin
        Contact.DeleteAll();
        FeedLine.DeleteAll();
        SeedContact('TARGET2', 'Target Co Two', 'TARGVAT02', 'Target Addr Two', 'TargetStatTwo', CreateDateTime(20250101D, 080000T));
        SeedContact('LOSING2', 'Losing Co Two', 'LOSEVAT02', 'Losing Addr Two', 'LosingStatTwo', CreateDateTime(20250102D, 080000T));
        SeedFeedLine(1, 'LOSING2', 'TARGET2', 'Feed Update Co Two', 'FEEDVAT2', 'Feed Addr Two', 'FeedStatTwo');
        Commit();

        asserterror FeedImport.ImportFeed(FeedLine);

        Assert.IsTrue(Contact.Get('TARGET2'), 'The already-correct target contact must still exist after a colliding sync is attempted');
        Assert.AreEqual('Target Co Two', Contact."Company Name", 'A colliding sync must not overwrite the target contact''s company name with the losing contact''s feed data');
        Assert.AreEqual('TARGVAT02', Contact."VAT Registration No.", 'A colliding sync must not overwrite the target contact''s VAT registration number with the losing contact''s feed data');
        Assert.AreEqual('Target Addr Two', Contact."Address", 'A colliding sync must not overwrite the target contact''s address with the losing contact''s feed data');
        Assert.AreEqual('TargetStatTwo', Contact."Status", 'A colliding sync must not overwrite the target contact''s status with the losing contact''s feed data');
        Assert.AreEqual(CreateDateTime(20250101D, 080000T), Contact."Last Synced", 'A colliding sync must not overwrite the target contact''s last-synced time with the losing contact''s feed data');
    end;

    [Test]
    procedure CollisionSkipStaysInEffectOnEveryRepeatedSync()
    var
        FeedLine: Record "CG X086 Feed Line";
        Contact: Record "CG X086 Contact";
        FeedImport: Codeunit "CG X086 Feed Import";
    begin
        Contact.DeleteAll();
        FeedLine.DeleteAll();
        SeedContact('TARGET3', 'Target Co Three', 'TARGVAT03', 'Target Addr Three', 'TargetStat3', CreateDateTime(20250101D, 080000T));
        SeedContact('LOSING3', 'Losing Co Three', 'LOSEVAT03', 'Losing Addr Three', 'LosingStat3', CreateDateTime(20250102D, 080000T));
        SeedFeedLine(1, 'LOSING3', 'TARGET3', 'First Feed Update', 'FEEDVAT3A', 'Feed Addr 3A', 'FeedStat3A');
        Commit();

        asserterror FeedImport.ImportFeed(FeedLine);
        Commit();

        FeedLine.Get(1);
        FeedLine."Company Name" := 'Second Feed Update';
        FeedLine."VAT Registration No." := 'FEEDVAT3B';
        FeedLine."Address" := 'Feed Addr 3B';
        FeedLine."Status" := 'FeedStat3B';
        FeedLine.Modify();
        Commit();

        asserterror FeedImport.ImportFeed(FeedLine);

        Assert.IsTrue(Contact.Get('LOSING3'), 'The losing contact must still be found under its old id after repeated colliding syncs');
        Assert.AreEqual('Losing Co Three', Contact."Company Name", 'Repeated colliding syncs must not eventually refresh the losing contact''s company name');
        Assert.AreEqual('LOSEVAT03', Contact."VAT Registration No.", 'Repeated colliding syncs must not eventually refresh the losing contact''s VAT registration number');
    end;
}
