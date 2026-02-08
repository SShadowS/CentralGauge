codeunit 80010 "CG-AL-E010 Test"
{
    // Tests for CG-AL-E010: Event Subscriber - Item Event Subscriber
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        LibraryInventory: Codeunit "Library - Inventory";
        LastMessageText: Text;

    [Test]
    procedure TestCodeunitExists()
    var
        AllObj: Record AllObj;
    begin
        // [SCENARIO] Item Event Subscriber codeunit exists with correct ID and name
        AllObj.SetRange("Object Type", AllObj."Object Type"::Codeunit);
        AllObj.SetRange("Object ID", 70001);
        Assert.IsTrue(AllObj.FindFirst(), 'Codeunit 70001 should exist');
        Assert.AreEqual('Item Event Subscriber', AllObj."Object Name", 'Codeunit should be named "Item Event Subscriber"');
    end;

    [Test]
    [HandlerFunctions('MessageHandler')]
    procedure TestMessageOnInsert()
    var
        Item: Record Item;
    begin
        // [SCENARIO] Subscriber fires and displays a message containing the item number
        // [GIVEN] The event subscriber is bound to Item.OnAfterInsertEvent
        LastMessageText := '';

        // [WHEN] We insert an item
        LibraryInventory.CreateItem(Item);

        // [THEN] A message was displayed containing the item number
        Assert.IsTrue(StrPos(LastMessageText, Item."No.") > 0,
            'Message should contain the item number ' + Item."No.");

        // Cleanup
        Item.Delete();
    end;

    [Test]
    [HandlerFunctions('MessageHandler')]
    procedure TestMultipleInsertsEachFireMessage()
    var
        Item1: Record Item;
        Item2: Record Item;
        Item3: Record Item;
    begin
        // [SCENARIO] Each item insert fires the subscriber independently
        // [GIVEN] The event subscriber is bound to OnAfterInsertEvent

        // [WHEN] We insert the first item
        LastMessageText := '';
        LibraryInventory.CreateItem(Item1);
        // [THEN] Message contains first item number
        Assert.IsTrue(StrPos(LastMessageText, Item1."No.") > 0,
            'Message should contain first item number ' + Item1."No.");

        // [WHEN] We insert the second item
        LastMessageText := '';
        LibraryInventory.CreateItem(Item2);
        // [THEN] Message contains second item number
        Assert.IsTrue(StrPos(LastMessageText, Item2."No.") > 0,
            'Message should contain second item number ' + Item2."No.");

        // [WHEN] We insert the third item
        LastMessageText := '';
        LibraryInventory.CreateItem(Item3);
        // [THEN] Message contains third item number
        Assert.IsTrue(StrPos(LastMessageText, Item3."No.") > 0,
            'Message should contain third item number ' + Item3."No.");

        // Cleanup
        Item1.Delete();
        Item2.Delete();
        Item3.Delete();
    end;

    [Test]
    [HandlerFunctions('MessageHandler')]
    procedure TestSubscriberDoesNotBlockModification()
    var
        Item: Record Item;
    begin
        // [SCENARIO] Item can be modified after insert (subscriber doesn't block)
        // [GIVEN] An inserted item (subscriber fires)
        LastMessageText := '';
        LibraryInventory.CreateItem(Item);

        // [WHEN] We modify the item description
        Item.Description := 'Modified after insert';
        Item.Modify();

        // [THEN] Modification persists
        Item.Get(Item."No.");
        Assert.AreEqual('Modified after insert', Item.Description, 'Item should be modifiable after insert');

        // Cleanup
        Item.Delete();
    end;

    [Test]
    [HandlerFunctions('MessageHandler')]
    procedure TestSubscriberDoesNotBlockDeletion()
    var
        Item: Record Item;
        ItemNo: Code[20];
    begin
        // [SCENARIO] Item can be deleted after insert (subscriber doesn't block deletion)
        // [GIVEN] An inserted item (subscriber fires)
        LastMessageText := '';
        LibraryInventory.CreateItem(Item);
        ItemNo := Item."No.";

        // [WHEN] We delete the item
        Item.Delete();

        // [THEN] Item no longer exists
        Assert.IsFalse(Item.Get(ItemNo), 'Item should be deleted');
    end;

    [MessageHandler]
    procedure MessageHandler(Message: Text[1024])
    begin
        LastMessageText := Message;
    end;
}
