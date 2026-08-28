codeunit 80003 "CG-AL-H003 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    /// Give an item a priced, stocked position. Inventory is a FlowField over
    /// Item Ledger Entry, so it cannot be assigned - the entry is what makes
    /// CalcFields(Inventory) return anything.
    local procedure SeedStockedItem(ItemNo: Code[20]; UnitPrice: Decimal; Quantity: Decimal)
    var
        Item: Record Item;
        ItemLedgerEntry: Record "Item Ledger Entry";
        LastEntry: Record "Item Ledger Entry";
        NextEntryNo: Integer;
    begin
        if not Item.Get(ItemNo) then begin
            Item.Init();
            Item."No." := ItemNo;
            Item.Insert(false);
        end;
        Item."Unit Price" := UnitPrice;
        Item.Modify(false);

        ItemLedgerEntry.SetRange("Item No.", ItemNo);
        ItemLedgerEntry.DeleteAll(false);

        NextEntryNo := 1;
        if LastEntry.FindLast() then
            NextEntryNo := LastEntry."Entry No." + 1;

        ItemLedgerEntry.Init();
        ItemLedgerEntry."Entry No." := NextEntryNo;
        ItemLedgerEntry."Item No." := ItemNo;
        ItemLedgerEntry.Quantity := Quantity;
        ItemLedgerEntry."Remaining Quantity" := Quantity;
        ItemLedgerEntry.Open := true;
        ItemLedgerEntry.Insert(false);
    end;

    [Test]
    procedure TestHighInventoryDiscount()
    var
        TempResult: Record "CG Discount Result" temporary;
        Processor: Codeunit "CG Temp Table Processor";
        Found: Boolean;
    begin
        // [SCENARIO] Items with inventory >= 100 get 15% discount
        // Seeded rather than searched for: `if not Item.FindFirst() then exit`
        // made this test pass having asserted nothing in any company without a
        // priced, stocked item.
        SeedStockedItem('CGH003-HI', 250, 150);

        Processor.ProcessItemsWithDiscount(TempResult, 15);

        TempResult.SetRange("Item No.", 'CGH003-HI');
        Found := TempResult.FindFirst();
        Assert.IsTrue(Found, 'High inventory item should be in results');
        Assert.AreEqual(15, TempResult."Discount Percent", 'Discount should be 15%');
    end;

    [Test]
    procedure TestMinDiscountFilter()
    var
        TempResult: Record "CG Discount Result" temporary;
        Processor: Codeunit "CG Temp Table Processor";
    begin
        // [SCENARIO] Only items meeting minimum discount are included
        Processor.ProcessItemsWithDiscount(TempResult, 10);

        // All results should have discount >= 10
        if TempResult.FindSet() then
            repeat
                Assert.IsTrue(TempResult."Discount Percent" >= 10, 'All items should meet minimum discount');
            until TempResult.Next() = 0;
    end;

    [Test]
    procedure TestFinalPriceCalculation()
    var
        TempResult: Record "CG Discount Result" temporary;
        Processor: Codeunit "CG Temp Table Processor";
        ExpectedPrice: Decimal;
    begin
        // [SCENARIO] Final price is calculated correctly with rounding
        Processor.ProcessItemsWithDiscount(TempResult, 0);

        if TempResult.FindSet() then
            repeat
                ExpectedPrice := Round(TempResult."Original Price" * (1 - TempResult."Discount Percent" / 100), 0.01);
                Assert.AreEqual(ExpectedPrice, TempResult."Final Price", 'Final price calculation incorrect');
            until TempResult.Next() = 0;
    end;

    [Test]
    procedure TestTempTableCleared()
    var
        TempResult: Record "CG Discount Result" temporary;
        Processor: Codeunit "CG Temp Table Processor";
        InitialCount: Integer;
    begin
        // [SCENARIO] Temp table is cleared before processing
        // Pre-populate with dummy data
        TempResult.Init();
        TempResult."Line No." := 99999;
        TempResult."Item No." := 'DUMMY';
        TempResult."Original Price" := 999;
        TempResult.Insert();
        InitialCount := TempResult.Count();

        // Process should clear existing data
        Processor.ProcessItemsWithDiscount(TempResult, 0);

        // Dummy record should be gone
        TempResult.SetRange("Item No.", 'DUMMY');
        Assert.IsTrue(TempResult.IsEmpty(), 'Temp table should be cleared before processing');
    end;

    [Test]
    procedure TestZeroPriceItemsExcluded()
    var
        TempResult: Record "CG Discount Result" temporary;
        Processor: Codeunit "CG Temp Table Processor";
    begin
        // [SCENARIO] Items with zero price are not included
        Processor.ProcessItemsWithDiscount(TempResult, 0);

        if TempResult.FindSet() then
            repeat
                Assert.IsTrue(TempResult."Original Price" > 0, 'Zero price items should be excluded');
            until TempResult.Next() = 0;
    end;
}
