codeunit 80303 "CG-AL-X014 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure ClearState()
    var
        Item: Record "CG X014 Item";
    begin
        Item.DeleteAll();
    end;

    local procedure SeedItems()
    var
        Item: Record "CG X014 Item";
    begin
        // [GIVEN] self-heal: a prior run's trap-failure aborts the test
        // procedure on assertion failure and never reaches any end-of-test
        // cleanup, which can leave "CG X014 Item" rows behind on the shared
        // container. Wipe it, committed, before seeding.
        ClearState();
        Commit();

        Item.Init();
        Item."Code" := 'A&B';
        Item.Name := 'Ampersand Item';
        Item.Insert();

        Item.Init();
        Item."Code" := 'C|D';
        Item.Name := 'Pipe Item';
        Item.Insert();

        Item.Init();
        Item."Code" := 'PLAIN';
        Item.Name := 'Plain Item';
        Item.Insert();

        // 'NOPE' is deliberately never inserted.
    end;

    [Test]
    procedure FindByCodeReturnsTrueForAmpersandValue()
    var
        Finder: Codeunit "CG X014 Finder";
    begin
        // [GIVEN]
        SeedItems();

        // [WHEN/THEN] the discriminator: a value containing '&' misparsed as
        // a filter expression (AND operator) never matches the literal row
        Assert.IsTrue(Finder.FindByCode('A&B'), 'FindByCode must find an item whose Code is exactly ''A&B''');

        ClearState();
    end;

    [Test]
    procedure FindByCodeReturnsTrueForPipeValue()
    var
        Finder: Codeunit "CG X014 Finder";
    begin
        // [GIVEN]
        SeedItems();

        // [WHEN/THEN] the discriminator: a value containing '|' misparsed as
        // a filter expression (OR operator) never matches the literal row
        Assert.IsTrue(Finder.FindByCode('C|D'), 'FindByCode must find an item whose Code is exactly ''C|D''');

        ClearState();
    end;

    [Test]
    procedure FindByCodeReturnsTrueForPlainValue()
    var
        Finder: Codeunit "CG X014 Finder";
    begin
        // [GIVEN] a plain value with no filter-special characters; both a
        // naive and a correct implementation must agree here (sanity case)
        SeedItems();

        // [WHEN/THEN]
        Assert.IsTrue(Finder.FindByCode('PLAIN'), 'FindByCode must find an item whose Code is exactly ''PLAIN''');

        ClearState();
    end;

    [Test]
    procedure FindByCodeReturnsFalseForAbsentCode()
    var
        Finder: Codeunit "CG X014 Finder";
    begin
        // [GIVEN] no item with Code = 'NOPE' exists
        SeedItems();

        // [WHEN/THEN]
        Assert.IsFalse(Finder.FindByCode('NOPE'), 'FindByCode must return false when no item has that exact Code');

        ClearState();
    end;
}
