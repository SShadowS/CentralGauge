codeunit 80308 "CG-AL-X019 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure ClearState()
    var
        Doc: Record "CG X019 Doc";
    begin
        Doc.DeleteAll();
    end;

    local procedure SeedData(var RefId1: Guid; var RefId2: Guid)
    var
        Doc: Record "CG X019 Doc";
    begin
        // [GIVEN] self-heal: a prior run's trap-failure aborts the test
        // procedure on assertion failure and never reaches ClearState() at
        // the end. Everything below runs under the default per-test
        // TestIsolation = Codeunit rollback (no Commit anywhere in this
        // task's flow, including the Normalizer's Rename), so no explicit
        // Commit is needed here either -- wipe-then-reseed is enough.
        ClearState();

        RefId1 := CreateGuid();
        RefId2 := CreateGuid();

        Doc.Init();
        Doc."No." := 'DOC-A';
        Doc."Ref ID" := RefId1;
        Doc.Amount := 10;
        Doc.Insert();

        Doc.Init();
        Doc."No." := 'DOC-B';
        Doc."Ref ID" := RefId2;
        Doc.Amount := 20;
        Doc.Insert();
    end;

    [Test]
    procedure NormalizeAndGetAmountReturnsCurrentAmountForFirstDoc()
    var
        Doc: Record "CG X019 Doc";
        Processor: Codeunit "CG X019 Processor";
        RefId1: Guid;
        RefId2: Guid;
    begin
        // [GIVEN] two documents with distinct Ref IDs, so a correct re-find
        // by Ref ID must land on the RIGHT row, not merely "whichever row
        // exists" or "the first row in the table".
        SeedData(RefId1, RefId2);

        // [WHEN/THEN] the discriminator: the Normalizer renames the targeted
        // doc's "No." (its primary key) to a value driven by its OLD Amount
        // (10*3+11 -> "DOC-41") and separately rewrites Amount to
        // 10*7+2 = 72. A caller that re-reads the same Record variable by its
        // now-stale primary key (Find('=') / Get on the old "No.") after the
        // Normalize call does not observe that mutation and returns
        // something other than 72.
        Assert.AreEqual(
            72,
            Processor.NormalizeAndGetAmount(RefId1),
            'Must return the current amount of the normalized document');

        // [THEN] the row is still reachable, but only by its stable Ref ID
        Doc.SetRange("Ref ID", RefId1);
        Assert.IsTrue(Doc.FindFirst(), 'Normalized doc must still be locatable by its Ref ID');
        Assert.AreEqual('DOC-41', Doc."No.", 'Doc must carry the Normalizer''s new primary key value');
        Assert.AreEqual(72, Doc.Amount, 'Doc must carry the Normalizer''s new Amount');

        // [THEN] the second, untouched document must be unaffected
        Doc.SetRange("Ref ID", RefId2);
        Assert.IsTrue(Doc.FindFirst(), 'Second doc must be untouched and still locatable');
        Assert.AreEqual('DOC-B', Doc."No.", 'Second doc primary key must be unchanged');
        Assert.AreEqual(20, Doc.Amount, 'Second doc Amount must be unchanged');

        ClearState();
    end;

    [Test]
    procedure NormalizeAndGetAmountReturnsCurrentAmountForSecondDoc()
    var
        Doc: Record "CG X019 Doc";
        Processor: Codeunit "CG X019 Processor";
        RefId1: Guid;
        RefId2: Guid;
    begin
        // [GIVEN] re-seed the same two documents, but this time target the
        // SECOND one -- guards against an implementation that happens to
        // pass only because it always operates on whichever row is first.
        SeedData(RefId1, RefId2);

        // [WHEN/THEN] 20*3+11 -> "DOC-71"; 20*7+2 = 142
        Assert.AreEqual(
            142,
            Processor.NormalizeAndGetAmount(RefId2),
            'Must return the current amount of the normalized document');

        Doc.SetRange("Ref ID", RefId2);
        Assert.IsTrue(Doc.FindFirst(), 'Normalized doc must still be locatable by its Ref ID');
        Assert.AreEqual('DOC-71', Doc."No.", 'Doc must carry the Normalizer''s new primary key value');
        Assert.AreEqual(142, Doc.Amount, 'Doc must carry the Normalizer''s new Amount');

        Doc.SetRange("Ref ID", RefId1);
        Assert.IsTrue(Doc.FindFirst(), 'First doc must be untouched and still locatable');
        Assert.AreEqual('DOC-A', Doc."No.", 'First doc primary key must be unchanged');
        Assert.AreEqual(10, Doc.Amount, 'First doc Amount must be unchanged');

        ClearState();
    end;
}
