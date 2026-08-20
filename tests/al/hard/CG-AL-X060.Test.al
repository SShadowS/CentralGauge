codeunit 88813 "CG-AL-X060 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure Seed()
    var
        Item: Record "CG X060 Item";
    begin
        Item.DeleteAll();
        Item.Init();
        Item."No." := 'ITEM-1';
        Item.Description := 'A description';
        Item.Amount := 777;
        Item.Note := 'A note';
        Item.Insert();
    end;

    [Test]
    procedure FetchReturnsTheRequestedRow()
    var
        Fetcher: Codeunit "CG X060 Fetcher";
        Item: Record "CG X060 Item";
    begin
        Seed();
        Fetcher.Fetch('ITEM-1', Item);
        Assert.AreEqual('A description', Item.Description, 'Description must be fetched');
    end;

    [Test]
    procedure FetchDoesNotBringBackTheOtherColumns()
    var
        Fetcher: Codeunit "CG X060 Fetcher";
        Item: Record "CG X060 Item";
    begin
        Seed();
        Fetcher.Fetch('ITEM-1', Item);

        // AreFieldsLoaded reports what was fetched without itself fetching.
        Assert.IsFalse(Item.AreFieldsLoaded(Item.Amount), 'Amount must not have been fetched');
        Assert.IsFalse(Item.AreFieldsLoaded(Item.Note), 'Note must not have been fetched');
    end;

    [Test]
    procedure FetchStillBringsBackTheKeyAndDescription()
    var
        Fetcher: Codeunit "CG X060 Fetcher";
        Item: Record "CG X060 Item";
    begin
        Seed();
        Fetcher.Fetch('ITEM-1', Item);

        Assert.IsTrue(Item.AreFieldsLoaded(Item.Description), 'Description must have been fetched');
        Assert.IsTrue(Item.AreFieldsLoaded(Item."No."), 'The primary key must be available');
        Assert.AreEqual('ITEM-1', Item."No.", 'The primary key must carry the requested value');
    end;
}
