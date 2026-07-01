codeunit 80315 "CG-AL-X026 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure ClearState()
    var
        Item: Record "CG X026 Item";
    begin
        Item.DeleteAll();
    end;

    local procedure SeedItems()
    var
        Item: Record "CG X026 Item";
    begin
        // [GIVEN] self-heal: a prior run's trap-failure aborts the test
        // procedure on assertion failure and never reaches any end-of-test
        // cleanup, which can leave "CG X026 Item" rows behind on the shared
        // container. Wipe it, committed, before seeding.
        ClearState();
        Commit();

        Item.Init();
        Item."No." := 'I1';
        Item.Category := 'A';
        Item.Amount := 7;
        Item.Insert();

        Item.Init();
        Item."No." := 'I2';
        Item.Category := 'A';
        Item.Amount := 13;
        Item.Insert();

        Item.Init();
        Item."No." := 'I3';
        Item.Category := 'B';
        Item.Amount := 29;
        Item.Insert();

        // These two items deliberately carry a blank Category. Their
        // presence is what makes a naive blank-filter implementation land
        // on a plausible-looking WRONG total (54) instead of an obviously
        // broken 0 for the blank case below.
        Item.Init();
        Item."No." := 'I4';
        Item.Category := '';
        Item.Amount := 51;
        Item.Insert();

        Item.Init();
        Item."No." := 'I5';
        Item.Category := '';
        Item.Amount := 3;
        Item.Insert();
    end;

    [Test]
    procedure SumByCategoryReturnsTotalForCategoryA()
    var
        Filter: Codeunit "CG X026 Filter";
    begin
        // [GIVEN] a non-blank category filter; both a naive and a correct
        // implementation agree here (sanity case).
        SeedItems();

        // [WHEN/THEN]
        Assert.AreEqual(20, Filter.SumByCategory('A'), 'Category A must sum to 7 + 13');

        ClearState();
    end;

    [Test]
    procedure SumByCategoryReturnsTotalForCategoryB()
    var
        Filter: Codeunit "CG X026 Filter";
    begin
        // [GIVEN] another non-blank category filter (sanity case).
        SeedItems();

        // [WHEN/THEN]
        Assert.AreEqual(29, Filter.SumByCategory('B'), 'Category B must sum to 29');

        ClearState();
    end;

    [Test]
    procedure SumByCategoryReturnsGrandTotalForBlankFilter()
    var
        Filter: Codeunit "CG X026 Filter";
    begin
        // [GIVEN]
        SeedItems();

        // [WHEN/THEN] the discriminator: a blank CategoryFilter must return
        // the total across ALL items (7 + 13 + 29 + 51 + 3 = 103), not just
        // the items that happen to carry a blank Category (51 + 3 = 54).
        Assert.AreEqual(103, Filter.SumByCategory(''), 'Blank filter must sum every item, not just blank-category items');

        ClearState();
    end;
}
