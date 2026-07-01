codeunit 80307 "CG-AL-X018 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure ClearState()
    var
        Group: Record "CG X018 Group";
        Entry: Record "CG X018 Entry";
    begin
        Group.DeleteAll();
        Entry.DeleteAll();
    end;

    local procedure SeedData()
    var
        Group: Record "CG X018 Group";
        Entry: Record "CG X018 Entry";
    begin
        // [GIVEN] self-heal: a prior run's trap-failure aborts the test
        // procedure on assertion failure and never reaches any end-of-test
        // cleanup, which can leave rows behind on the shared container.
        // Wipe both tables, committed, before seeding.
        ClearState();
        Commit();

        Entry.Init();
        Entry."Entry No." := 1;
        Entry."Account No." := '10';
        Entry.Amount := 7;
        Entry.Insert();

        Entry.Init();
        Entry."Entry No." := 2;
        Entry."Account No." := '15';
        Entry.Amount := 13;
        Entry.Insert();

        Entry.Init();
        Entry."Entry No." := 3;
        Entry."Account No." := '20';
        Entry.Amount := 29;
        Entry.Insert();

        Entry.Init();
        Entry."Entry No." := 4;
        Entry."Account No." := '30';
        Entry.Amount := 51;
        Entry.Insert();

        Entry.Init();
        Entry."Entry No." := 5;
        Entry."Account No." := '40';
        Entry.Amount := 3;
        Entry.Insert();

        Group.Init();
        Group."Code" := 'A';
        Group."Totaling" := '10..20';
        Group.Insert();

        Group.Init();
        Group."Code" := 'B';
        Group."Totaling" := '10|40';
        Group.Insert();

        Group.Init();
        Group."Code" := 'C';
        Group."Totaling" := '30';
        Group.Insert();
    end;

    [Test]
    procedure SumForGroupAMatchesRangeExpression()
    var
        Roller: Codeunit "CG X018 Roller";
    begin
        // [GIVEN]
        SeedData();

        // [WHEN/THEN] the discriminator: 'A' Totaling '10..20' is a RANGE
        // expression spanning accounts 10, 15, 20 (7 + 13 + 29 = 49). A
        // literal-match implementation never matches an account literally
        // named "10..20" and returns 0.
        Assert.AreEqual(49, Roller.SumForGroup('A'), 'Group A must sum accounts 10, 15, 20');

        ClearState();
    end;

    [Test]
    procedure SumForGroupBMatchesOrExpression()
    var
        Roller: Codeunit "CG X018 Roller";
    begin
        // [GIVEN]
        SeedData();

        // [WHEN/THEN] the discriminator: 'B' Totaling '10|40' is an OR
        // expression over accounts 10 and 40 (7 + 3 = 10). A literal-match
        // implementation never matches an account literally named "10|40"
        // and returns 0.
        Assert.AreEqual(10, Roller.SumForGroup('B'), 'Group B must sum accounts 10 and 40');

        ClearState();
    end;

    [Test]
    procedure SumForGroupCMatchesSingleValue()
    var
        Roller: Codeunit "CG X018 Roller";
    begin
        // [GIVEN] 'C' Totaling '30' has no filter-expression operators, so
        // both a literal-match and a range-aware implementation agree here
        // (sanity case, not a discriminator).
        SeedData();

        // [WHEN/THEN]
        Assert.AreEqual(51, Roller.SumForGroup('C'), 'Group C must sum account 30');

        ClearState();
    end;
}
