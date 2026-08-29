codeunit 89388 "CG-AL-X168 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods (see
    // tests/al/hard/CG-AL-X065.Test.al for the same note), so every test
    // clears the two persisted tables before seeding its own rows. The
    // rollup result buffer is a temporary record owned by the caller, so it
    // never needs clearing - each test declares its own.

    local procedure ClearAll()
    var
        Group: Record "CG X168 Cost Group";
        Entry: Record "CG X168 Cost Entry";
    begin
        Group.DeleteAll();
        Entry.DeleteAll();
    end;

    local procedure SeedGroup(GroupCode: Code[20]; ParentCode: Code[20]; GroupName: Text[100])
    var
        Group: Record "CG X168 Cost Group";
    begin
        Group.Init();
        Group."Code" := GroupCode;
        Group."Parent Code" := ParentCode;
        Group.Name := GroupName;
        Group.Insert();
    end;

    local procedure SeedEntry(GroupCode: Code[20]; EntryAmount: Decimal)
    var
        Entry: Record "CG X168 Cost Entry";
    begin
        Entry.Init();
        Entry."Group Code" := GroupCode;
        Entry.Amount := EntryAmount;
        Entry.Insert();
    end;

    local procedure SeedBroom(RootCode: Code[20]; ArmCount: Integer; ArmDepth: Integer)
    var
        ArmIndex: Integer;
        Level: Integer;
        ParentCode: Code[20];
        NodeCode: Code[20];
    begin
        // A root cost center with ArmCount branches hanging off it, each
        // branch a straight chain ArmDepth cost centers deep. Every cost
        // center - the root and every node on every branch - carries
        // exactly one posting of 1, so the grand total always equals the
        // total cost center count and every node's total always equals the
        // size of the chain below and including it.
        SeedGroup(RootCode, '', RootCode);
        SeedEntry(RootCode, 1);
        for ArmIndex := 1 to ArmCount do begin
            ParentCode := RootCode;
            for Level := 1 to ArmDepth do begin
                NodeCode := CopyStr(StrSubstNo('%1-%2-%3', RootCode, ArmIndex, Level), 1, 20);
                SeedGroup(NodeCode, ParentCode, NodeCode);
                SeedEntry(NodeCode, 1);
                ParentCode := NodeCode;
            end;
        end;
    end;

    local procedure MaxRollupStatements(): Integer
    begin
        exit(30);
    end;

    [Test]
    procedure FourDeepChainAccumulatesOwnPlusDescendantsAtEveryLevel()
    var
        RollupBuilder: Codeunit "CG X168 Rollup Builder";
        RollupResult: Record "CG X168 Rollup Result" temporary;
    begin
        ClearAll();
        SeedGroup('CHAIN-0', '', 'Level 0');
        SeedGroup('CHAIN-1', 'CHAIN-0', 'Level 1');
        SeedGroup('CHAIN-2', 'CHAIN-1', 'Level 2');
        SeedGroup('CHAIN-3', 'CHAIN-2', 'Level 3');
        SeedEntry('CHAIN-0', 2);
        SeedEntry('CHAIN-1', 3);
        SeedEntry('CHAIN-2', 5);
        SeedEntry('CHAIN-3', 7);

        RollupBuilder.BuildRollup(RollupResult);

        RollupResult.Get('CHAIN-3');
        Assert.AreEqual(7, RollupResult."Own Amount",
            'Expected the deepest cost center''s own amount to be its own posted amount');
        Assert.AreEqual(7, RollupResult."Total Amount",
            'Expected the deepest cost center''s total to equal its own amount, since nothing sits beneath it');

        RollupResult.Get('CHAIN-2');
        Assert.AreEqual(5, RollupResult."Own Amount",
            'Expected this cost center''s own amount to be unaffected by what sits beneath it');
        Assert.AreEqual(12, RollupResult."Total Amount",
            'Expected this cost center''s total to be its own amount plus everything beneath it');

        RollupResult.Get('CHAIN-1');
        Assert.AreEqual(3, RollupResult."Own Amount",
            'Expected this cost center''s own amount to be unaffected by what sits beneath it');
        Assert.AreEqual(15, RollupResult."Total Amount",
            'Expected this cost center''s total to be its own amount plus everything beneath it');

        RollupResult.Get('CHAIN-0');
        Assert.AreEqual(2, RollupResult."Own Amount",
            'Expected the top cost center''s own amount to be its own posted amount');
        Assert.AreEqual(17, RollupResult."Total Amount",
            'Expected the top cost center''s total to add its own amount and everything beneath it, with nothing counted twice');
    end;

    [Test]
    procedure SiblingCostGroupsDoNotLeakAmountsIntoEachOther()
    var
        RollupBuilder: Codeunit "CG X168 Rollup Builder";
        RollupResult: Record "CG X168 Rollup Result" temporary;
    begin
        ClearAll();
        SeedGroup('SIB-P', '', 'Parent');
        SeedGroup('SIB-A', 'SIB-P', 'Child A');
        SeedGroup('SIB-B', 'SIB-P', 'Child B');
        SeedEntry('SIB-P', 17);
        SeedEntry('SIB-A', 11);
        SeedEntry('SIB-B', 13);

        RollupBuilder.BuildRollup(RollupResult);

        RollupResult.Get('SIB-A');
        Assert.AreEqual(11, RollupResult."Total Amount",
            'Expected one sibling''s total to hold only its own amount, not its sibling''s');

        RollupResult.Get('SIB-B');
        Assert.AreEqual(13, RollupResult."Total Amount",
            'Expected the other sibling''s total to hold only its own amount, not its sibling''s');

        RollupResult.Get('SIB-P');
        Assert.AreEqual(41, RollupResult."Total Amount",
            'Expected the parent''s total to add its own amount and both children''s amounts exactly once each');
    end;

    [Test]
    procedure StandaloneCostGroupWithEntriesAndNoChildrenTotalsOnlyItsOwnAmount()
    var
        RollupBuilder: Codeunit "CG X168 Rollup Builder";
        RollupResult: Record "CG X168 Rollup Result" temporary;
    begin
        ClearAll();
        SeedGroup('SOLO', '', 'Solo');
        SeedEntry('SOLO', 4);
        SeedEntry('SOLO', 6);

        RollupBuilder.BuildRollup(RollupResult);

        RollupResult.Get('SOLO');
        Assert.AreEqual(10, RollupResult."Own Amount",
            'Expected a cost center with no cost centers beneath it to report the sum of all its own postings');
        Assert.AreEqual(10, RollupResult."Total Amount",
            'Expected a cost center with no cost centers beneath it to have a total equal to its own amount');
    end;

    [Test]
    procedure CostGroupWithNoEntriesAndNoChildrenHasZeroOwnAndZeroTotal()
    var
        RollupBuilder: Codeunit "CG X168 Rollup Builder";
        RollupResult: Record "CG X168 Rollup Result" temporary;
    begin
        ClearAll();
        SeedGroup('EMPTY', '', 'Empty');

        RollupBuilder.BuildRollup(RollupResult);

        RollupResult.Get('EMPTY');
        Assert.AreEqual(0, RollupResult."Own Amount",
            'Expected a cost center with no postings and nothing beneath it to have a zero own amount');
        Assert.AreEqual(0, RollupResult."Total Amount",
            'Expected a cost center with no postings and nothing beneath it to have a zero total');
    end;

    [Test]
    procedure RootTotalEqualsTheGrandTotalOfABranchingHierarchy()
    var
        RollupBuilder: Codeunit "CG X168 Rollup Builder";
        RollupResult: Record "CG X168 Rollup Result" temporary;
    begin
        ClearAll();
        SeedGroup('BR-ROOT', '', 'Root');
        SeedGroup('BR-C1', 'BR-ROOT', 'Child 1');
        SeedGroup('BR-C2', 'BR-ROOT', 'Child 2');
        SeedGroup('BR-G1', 'BR-C1', 'Grandchild 1');
        SeedEntry('BR-ROOT', 2);
        SeedEntry('BR-C1', 3);
        SeedEntry('BR-C2', 5);
        SeedEntry('BR-G1', 7);

        RollupBuilder.BuildRollup(RollupResult);

        RollupResult.Get('BR-C1');
        Assert.AreEqual(10, RollupResult."Total Amount",
            'Expected a branch with its own posting and one cost center beneath it to total both exactly once');

        RollupResult.Get('BR-ROOT');
        Assert.AreEqual(17, RollupResult."Total Amount",
            'Expected the top cost center''s total to equal the grand total of every posting in the whole hierarchy');
    end;

    [Test]
    procedure RebuildingReplacesStaleTotalsAfterANewCostEntryIsLogged()
    var
        RollupBuilder: Codeunit "CG X168 Rollup Builder";
        RollupResult: Record "CG X168 Rollup Result" temporary;
    begin
        ClearAll();
        SeedGroup('RB-ROOT', '', 'Root');
        SeedGroup('RB-CHILD', 'RB-ROOT', 'Child');
        SeedEntry('RB-ROOT', 2);
        SeedEntry('RB-CHILD', 3);

        RollupBuilder.BuildRollup(RollupResult);
        Assert.AreEqual(2, RollupResult.Count(),
            'Expected one result row per cost center after the first rollup');
        RollupResult.Get('RB-ROOT');
        Assert.AreEqual(5, RollupResult."Total Amount",
            'Expected the root''s total before the new posting was logged');

        SeedEntry('RB-CHILD', 4);
        RollupBuilder.BuildRollup(RollupResult);

        Assert.AreEqual(2, RollupResult.Count(),
            'Expected the rebuild to replace the previous rows, not add duplicates alongside them');
        RollupResult.Get('RB-CHILD');
        Assert.AreEqual(7, RollupResult."Own Amount",
            'Expected the child''s own amount to include the newly logged posting');
        RollupResult.Get('RB-ROOT');
        Assert.AreEqual(9, RollupResult."Total Amount",
            'Expected the root''s total to reflect the newly logged posting after a rebuild');
    end;

    [Test]
    procedure RollupCostsTheSameForABushyFourLevelHierarchy()
    var
        RollupBuilder: Codeunit "CG X168 Rollup Builder";
        WarmResult: Record "CG X168 Rollup Result" temporary;
        RollupResult: Record "CG X168 Rollup Result" temporary;
        StatementsBefore: BigInteger;
        StatementsUsed: BigInteger;
    begin
        ClearAll();
        // Warm up on a tiny, unrelated hierarchy first, so first-touch
        // metadata/plan loading lands outside the measurement window below.
        SeedGroup('WARM-A', '', 'Warm');
        SeedEntry('WARM-A', 1);
        RollupBuilder.BuildRollup(WarmResult);
        ClearAll();

        // 20 branches x 4 levels beneath the root = 81 cost centers.
        SeedBroom('VOL-A-ROOT', 20, 4);

        SelectLatestVersion();
        StatementsBefore := SessionInformation.SqlStatementsExecuted();
        RollupBuilder.BuildRollup(RollupResult);
        StatementsUsed := SessionInformation.SqlStatementsExecuted() - StatementsBefore;

        RollupResult.Get('VOL-A-ROOT');
        Assert.AreEqual(81, RollupResult."Total Amount",
            'Expected the correct grand total on the low-cost hierarchy before judging its cost');
        RollupResult.Get('VOL-A-ROOT-1-4');
        Assert.AreEqual(1, RollupResult."Total Amount",
            'Expected the correct total on the deepest cost center of one branch before judging cost');
        RollupResult.Get('VOL-A-ROOT-1-1');
        Assert.AreEqual(4, RollupResult."Total Amount",
            'Expected the correct total partway down one branch before judging cost');
        Assert.IsTrue(StatementsUsed <= MaxRollupStatements(),
            StrSubstNo('Expected refreshing the rollup to cost about the same regardless of how many cost centers exist: budget %1, actual %2 against 81 cost centers', MaxRollupStatements(), StatementsUsed));
    end;

    [Test]
    procedure RollupCostsTheSameForABushyThreeLevelHierarchy()
    var
        RollupBuilder: Codeunit "CG X168 Rollup Builder";
        WarmResult: Record "CG X168 Rollup Result" temporary;
        RollupResult: Record "CG X168 Rollup Result" temporary;
        StatementsBefore: BigInteger;
        StatementsUsed: BigInteger;
    begin
        ClearAll();
        SeedGroup('WARM-B', '', 'Warm');
        SeedEntry('WARM-B', 1);
        RollupBuilder.BuildRollup(WarmResult);
        ClearAll();

        // 23 branches x 3 levels beneath the root = 70 cost centers - a
        // different size and depth from the hierarchy above, so a fix
        // tuned to one specific size cannot pass by coincidence.
        SeedBroom('VOL-B-ROOT', 23, 3);

        SelectLatestVersion();
        StatementsBefore := SessionInformation.SqlStatementsExecuted();
        RollupBuilder.BuildRollup(RollupResult);
        StatementsUsed := SessionInformation.SqlStatementsExecuted() - StatementsBefore;

        RollupResult.Get('VOL-B-ROOT');
        Assert.AreEqual(70, RollupResult."Total Amount",
            'Expected the correct grand total on this hierarchy before judging its cost');
        RollupResult.Get('VOL-B-ROOT-1-3');
        Assert.AreEqual(1, RollupResult."Total Amount",
            'Expected the correct total on the deepest cost center of one branch before judging cost');
        RollupResult.Get('VOL-B-ROOT-1-1');
        Assert.AreEqual(3, RollupResult."Total Amount",
            'Expected the correct total partway down one branch before judging cost');
        Assert.IsTrue(StatementsUsed <= MaxRollupStatements(),
            StrSubstNo('Expected refreshing the rollup to cost about the same regardless of how many cost centers exist: budget %1, actual %2 against 70 cost centers', MaxRollupStatements(), StatementsUsed));
    end;

    [Test]
    procedure RollupCostsTheSameForAWideShallowHierarchy()
    var
        RollupBuilder: Codeunit "CG X168 Rollup Builder";
        WarmResult: Record "CG X168 Rollup Result" temporary;
        RollupResult: Record "CG X168 Rollup Result" temporary;
        StatementsBefore: BigInteger;
        StatementsUsed: BigInteger;
    begin
        ClearAll();
        SeedGroup('WARM-C', '', 'Warm');
        SeedEntry('WARM-C', 1);
        RollupBuilder.BuildRollup(WarmResult);
        ClearAll();

        // 119 cost centers all directly beneath the root, none nested any
        // deeper = 120 cost centers - the same rough count as the first
        // hierarchy above, but flat rather than deep, so a fix that only
        // addresses deep nesting cannot pass by coincidence either.
        SeedBroom('SHP-C-ROOT', 119, 1);

        SelectLatestVersion();
        StatementsBefore := SessionInformation.SqlStatementsExecuted();
        RollupBuilder.BuildRollup(RollupResult);
        StatementsUsed := SessionInformation.SqlStatementsExecuted() - StatementsBefore;

        RollupResult.Get('SHP-C-ROOT');
        Assert.AreEqual(120, RollupResult."Total Amount",
            'Expected the correct grand total on this hierarchy before judging its cost');
        RollupResult.Get('SHP-C-ROOT-1-1');
        Assert.AreEqual(1, RollupResult."Total Amount",
            'Expected the correct total on a cost center directly beneath the root before judging cost');
        Assert.IsTrue(StatementsUsed <= MaxRollupStatements(),
            StrSubstNo('Expected refreshing the rollup to cost about the same regardless of how many cost centers exist or how they are nested: budget %1, actual %2 against 120 cost centers', MaxRollupStatements(), StatementsUsed));
    end;
}
