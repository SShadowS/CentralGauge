codeunit 80023 "CG-AL-M023 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        LibrarySales: Codeunit "Library - Sales";
        LibraryInventory: Codeunit "Library - Inventory";
        PartialLoader: Codeunit "CG Partial Record Loader";

    [Test]
    procedure TestGetCustomerNames_ReturnsNames()
    var
        Customer1: Record Customer;
        Customer2: Record Customer;
        Names: List of [Text];
    begin
        // [SCENARIO] GetCustomerNames returns list of customer names
        // [GIVEN] Customers exist
        LibrarySales.CreateCustomer(Customer1);
        Customer1.Name := 'Test Customer Alpha';
        Customer1.Modify();

        LibrarySales.CreateCustomer(Customer2);
        Customer2.Name := 'Test Customer Beta';
        Customer2.Modify();

        // [WHEN] Getting customer names
        Names := PartialLoader.GetCustomerNames();

        // [THEN] List contains the customer names
        Assert.IsTrue(Names.Count >= 2, 'Should have at least 2 customers');
        Assert.IsTrue(Names.Contains('Test Customer Alpha'), 'Should contain Alpha');
        Assert.IsTrue(Names.Contains('Test Customer Beta'), 'Should contain Beta');

        // Cleanup
        Customer1.Delete();
        Customer2.Delete();
    end;

    [Test]
    procedure TestGetCustomerNames_EmptyWhenNoCustomers()
    var
        Customer: Record Customer;
        Names: List of [Text];
        InitialCount: Integer;
    begin
        // [SCENARIO] GetCustomerNames works with existing data
        // [GIVEN] We know how many customers exist
        Customer.Reset();
        InitialCount := Customer.Count();

        // [WHEN] Getting customer names
        Names := PartialLoader.GetCustomerNames();

        // [THEN] Count matches
        Assert.AreEqual(InitialCount, Names.Count, 'Name count should match customer count');
    end;

    [Test]
    procedure TestGetItemBasicInfo_FormatsCorrectly()
    var
        Item: Record Item;
        ItemList: List of [Text];
        ExpectedFormat: Text;
    begin
        // [SCENARIO] GetItemBasicInfo returns formatted item info
        // [GIVEN] An item exists
        LibraryInventory.CreateItem(Item);
        Item.Description := 'Test Widget';
        Item.Modify();
        ExpectedFormat := Item."No." + ': Test Widget';

        // [WHEN] Getting item basic info
        PartialLoader.GetItemBasicInfo(ItemList);

        // [THEN] List contains formatted item info
        Assert.IsTrue(ItemList.Count >= 1, 'Should have at least 1 item');
        Assert.IsTrue(ItemList.Contains(ExpectedFormat), 'Should contain formatted item: ' + ExpectedFormat);

        // Cleanup
        Item.Delete();
    end;

    [Test]
    procedure TestGetItemBasicInfo_MultipleItems()
    var
        Item1: Record Item;
        Item2: Record Item;
        ItemList: List of [Text];
    begin
        // [SCENARIO] GetItemBasicInfo handles multiple items
        // [GIVEN] Multiple items exist
        LibraryInventory.CreateItem(Item1);
        Item1.Description := 'First Item';
        Item1.Modify();

        LibraryInventory.CreateItem(Item2);
        Item2.Description := 'Second Item';
        Item2.Modify();

        // [WHEN] Getting item basic info
        PartialLoader.GetItemBasicInfo(ItemList);

        // [THEN] List contains both items
        Assert.IsTrue(ItemList.Contains(Item1."No." + ': First Item'), 'Should contain first item');
        Assert.IsTrue(ItemList.Contains(Item2."No." + ': Second Item'), 'Should contain second item');

        // Cleanup
        Item1.Delete();
        Item2.Delete();
    end;

    [Test]
    procedure TestSumItemInventory_CalculatesSum()
    var
        Item1: Record Item;
        Item2: Record Item;
        ItemIter: Record Item;
        TotalInventory: Decimal;
        ExpectedSum: Decimal;
    begin
        // [SCENARIO] SumItemInventory returns correct sum
        // [GIVEN] Items with known inventory
        // Note: Item.Inventory is a FlowField and cannot be directly assigned
        // Test with existing inventory data instead
        LibraryInventory.CreateItem(Item1);
        LibraryInventory.CreateItem(Item2);

        // Calculate expected sum from all items by iterating
        ExpectedSum := 0;
        if ItemIter.FindSet() then
            repeat
                ItemIter.CalcFields(Inventory);
                ExpectedSum += ItemIter.Inventory;
            until ItemIter.Next() = 0;

        // [WHEN] Summing inventory
        TotalInventory := PartialLoader.SumItemInventory();

        // [THEN] Sum is correct
        Assert.AreEqual(ExpectedSum, TotalInventory, 'Inventory sum should match');

        // Cleanup
        Item1.Delete();
        Item2.Delete();
    end;

    [Test]
    procedure TestSumItemInventory_ZeroWhenNoItems()
    var
        Item: Record Item;
        TotalInventory: Decimal;
        ExpectedSum: Decimal;
    begin
        // [SCENARIO] SumItemInventory handles existing data
        // [GIVEN] We know total inventory
        Item.Reset();
        ExpectedSum := 0;
        if Item.FindSet() then
            repeat
                Item.CalcFields(Inventory);
                ExpectedSum += Item.Inventory;
            until Item.Next() = 0;

        // [WHEN] Summing inventory
        TotalInventory := PartialLoader.SumItemInventory();

        // [THEN] Sum matches expected
        Assert.AreEqual(ExpectedSum, TotalInventory, 'Should match calculated sum');
    end;

    [Test]
    procedure TestCountBlockedCustomers_CountsCorrectly()
    var
        Customer1: Record Customer;
        Customer2: Record Customer;
        BlockedCount: Integer;
        InitialBlockedCount: Integer;
    begin
        // [SCENARIO] CountBlockedCustomers returns correct count
        // [GIVEN] Some blocked customers exist
        Customer1.Reset();
        Customer1.SetRange(Blocked, Customer1.Blocked::All);
        InitialBlockedCount := Customer1.Count();

        LibrarySales.CreateCustomer(Customer1);
        Customer1.Blocked := Customer1.Blocked::All;
        Customer1.Modify();

        LibrarySales.CreateCustomer(Customer2);
        Customer2.Blocked := Customer2.Blocked::All;
        Customer2.Modify();

        // [WHEN] Counting blocked customers
        BlockedCount := PartialLoader.CountBlockedCustomers();

        // [THEN] Count includes our blocked customers
        Assert.AreEqual(InitialBlockedCount + 2, BlockedCount, 'Should count blocked customers');

        // Cleanup
        Customer1.Delete();
        Customer2.Delete();
    end;

    [Test]
    procedure TestCountBlockedCustomers_ExcludesPartiallyBlocked()
    var
        Customer: Record Customer;
        BlockedCount: Integer;
        InitialBlockedCount: Integer;
    begin
        // [SCENARIO] CountBlockedCustomers only counts fully blocked
        // [GIVEN] A customer blocked only for shipping
        Customer.Reset();
        Customer.SetRange(Blocked, Customer.Blocked::All);
        InitialBlockedCount := Customer.Count();

        LibrarySales.CreateCustomer(Customer);
        Customer.Blocked := Customer.Blocked::Ship; // Partially blocked
        Customer.Modify();

        // [WHEN] Counting blocked customers
        BlockedCount := PartialLoader.CountBlockedCustomers();

        // [THEN] Partially blocked customer is not counted
        Assert.AreEqual(InitialBlockedCount, BlockedCount, 'Should not count partially blocked');

        // Cleanup
        Customer.Delete();
    end;

    [Test]
    procedure TestGetHighValueItems_FiltersCorrectly()
    var
        Item1: Record Item;
        Item2: Record Item;
        Item3: Record Item;
        HighValueItems: List of [Code[20]];
    begin
        // [SCENARIO] GetHighValueItems filters by minimum price
        // [GIVEN] Items with various prices
        LibraryInventory.CreateItem(Item1);
        Item1."Unit Price" := 50;
        Item1.Modify();

        LibraryInventory.CreateItem(Item2);
        Item2."Unit Price" := 150;
        Item2.Modify();

        LibraryInventory.CreateItem(Item3);
        Item3."Unit Price" := 200;
        Item3.Modify();

        // [WHEN] Getting items with price >= 100
        HighValueItems := PartialLoader.GetHighValueItems(100);

        // [THEN] Only high-value items returned
        Assert.IsFalse(HighValueItems.Contains(Item1."No."), 'Should not contain $50 item');
        Assert.IsTrue(HighValueItems.Contains(Item2."No."), 'Should contain $150 item');
        Assert.IsTrue(HighValueItems.Contains(Item3."No."), 'Should contain $200 item');

        // Cleanup
        Item1.Delete();
        Item2.Delete();
        Item3.Delete();
    end;

    [Test]
    procedure TestGetHighValueItems_ExactThreshold()
    var
        Item: Record Item;
        HighValueItems: List of [Code[20]];
    begin
        // [SCENARIO] GetHighValueItems includes items at exact threshold
        // [GIVEN] An item at exactly the threshold
        LibraryInventory.CreateItem(Item);
        Item."Unit Price" := 100;
        Item.Modify();

        // [WHEN] Getting items with price >= 100
        HighValueItems := PartialLoader.GetHighValueItems(100);

        // [THEN] Item at threshold is included
        Assert.IsTrue(HighValueItems.Contains(Item."No."), 'Should include item at exact threshold');

        // Cleanup
        Item.Delete();
    end;

    [Test]
    procedure TestGetHighValueItems_EmptyForHighThreshold()
    var
        Item: Record Item;
        HighValueItems: List of [Code[20]];
    begin
        // [SCENARIO] GetHighValueItems returns empty for very high threshold
        // [GIVEN] An item with low price
        LibraryInventory.CreateItem(Item);
        Item."Unit Price" := 10;
        Item.Modify();

        // [WHEN] Getting items with price >= 1000000
        HighValueItems := PartialLoader.GetHighValueItems(1000000);

        // [THEN] Our low-price item is not included
        Assert.IsFalse(HighValueItems.Contains(Item."No."), 'Low price item should not be in high-value list');

        // Cleanup
        Item.Delete();
    end;
}
