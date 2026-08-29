codeunit 89378 "CG-AL-X158 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods, so
    // every test clears its own tables before seeding its own rows.

    local procedure ClearAll()
    var
        Item: Record "CG X158 Item";
        OrderLine: Record "CG X158 Order Line";
    begin
        Item.DeleteAll();
        OrderLine.DeleteAll();
    end;

    local procedure SeedItem(No: Code[20]; Description: Text[100]; BaseQtyPerSalesUnit: Decimal; QtyOnHand: Decimal)
    var
        Item: Record "CG X158 Item";
    begin
        Item.Init();
        Item."No." := No;
        Item.Description := Description;
        Item."Base Qty per Sales Unit" := BaseQtyPerSalesUnit;
        Item."Qty on Hand (Base)" := QtyOnHand;
        Item.Insert();
    end;

    local procedure SeedOrderLine(OrderNo: Code[20]; LineNo: Integer; ItemNo: Code[20]; Quantity: Decimal)
    var
        OrderLine: Record "CG X158 Order Line";
    begin
        OrderLine.Init();
        OrderLine."Order No." := OrderNo;
        OrderLine."Line No." := LineNo;
        OrderLine."Item No." := ItemNo;
        OrderLine.Quantity := Quantity;
        OrderLine.Insert();
    end;

    [Test]
    procedure AcceptsALineWithinStockForASingleUnitItem()
    var
        Fulfillment: Codeunit "CG X158 Fulfillment";
        OrderLine: Record "CG X158 Order Line";
    begin
        ClearAll();
        SeedItem('ITM1', 'Single unit', 1, 20);
        SeedOrderLine('ORD1', 10000, 'ITM1', 15);

        OrderLine.Get('ORD1', 10000);
        Assert.IsTrue(Fulfillment.CanFulfill(OrderLine), 'A single-unit item''s line within its stock is accepted');
    end;

    [Test]
    procedure RefusesALineOverStockForASingleUnitItem()
    var
        Fulfillment: Codeunit "CG X158 Fulfillment";
        OrderLine: Record "CG X158 Order Line";
    begin
        ClearAll();
        SeedItem('ITM1', 'Single unit', 1, 20);
        SeedOrderLine('ORD1', 10000, 'ITM1', 25);

        OrderLine.Get('ORD1', 10000);
        Assert.IsFalse(Fulfillment.CanFulfill(OrderLine), 'A single-unit item''s line over its stock is refused');
    end;

    [Test]
    procedure AcceptsAPackedLineThatExactlyExhaustsOnHandStock()
    var
        Fulfillment: Codeunit "CG X158 Fulfillment";
        OrderLine: Record "CG X158 Order Line";
    begin
        ClearAll();
        SeedItem('ITM1', 'Case of twelve', 12, 60);
        SeedOrderLine('ORD1', 10000, 'ITM1', 5);

        OrderLine.Get('ORD1', 10000);
        Assert.IsTrue(Fulfillment.CanFulfill(OrderLine), 'A packed line that exactly exhausts on-hand stock is accepted');
    end;

    [Test]
    procedure RefusesAPackedLineShortByTheSmallestUnitOfStock()
    var
        Fulfillment: Codeunit "CG X158 Fulfillment";
        OrderLine: Record "CG X158 Order Line";
    begin
        ClearAll();
        SeedItem('ITM1', 'Case of twelve', 12, 59);
        SeedOrderLine('ORD1', 10000, 'ITM1', 5);

        OrderLine.Get('ORD1', 10000);
        Assert.IsFalse(Fulfillment.CanFulfill(OrderLine), 'A packed line one unit of stock short of what it needs is refused');
    end;

    [Test]
    procedure RefusesAPackedLineThatExceedsOnHandStock()
    var
        Fulfillment: Codeunit "CG X158 Fulfillment";
        OrderLine: Record "CG X158 Order Line";
    begin
        ClearAll();
        SeedItem('ITM1', 'Case of twelve', 12, 20);
        SeedOrderLine('ORD1', 10000, 'ITM1', 5);

        OrderLine.Get('ORD1', 10000);
        Assert.IsFalse(Fulfillment.CanFulfill(OrderLine), 'A packed line is refused when on-hand stock cannot cover what it actually consumes');
    end;

    [Test]
    procedure CheckingOneItemsLineIsNotAffectedByAnotherItemsData()
    var
        Fulfillment: Codeunit "CG X158 Fulfillment";
        ItemA: Record "CG X158 Item";
        ItemB: Record "CG X158 Item";
        LineA: Record "CG X158 Order Line";
        LineB: Record "CG X158 Order Line";
    begin
        ClearAll();
        SeedItem('ITMA', 'Small case', 2, 100);
        SeedItem('ITMB', 'Large pallet', 20, 15);
        SeedOrderLine('ORDA', 10000, 'ITMA', 10);
        SeedOrderLine('ORDB', 10000, 'ITMB', 1);

        LineA.Get('ORDA', 10000);
        LineB.Get('ORDB', 10000);

        Assert.IsTrue(Fulfillment.CanFulfill(LineA), 'ITMA''s line is covered by ITMA''s own stock');
        Assert.IsFalse(Fulfillment.CanFulfill(LineB), 'ITMB''s line is not covered by ITMB''s own stock');

        Fulfillment.Fulfill(LineA);

        ItemA.Get('ITMA');
        Assert.AreEqual(80, ItemA."Qty on Hand (Base)", 'ITMA''s stock reflects only ITMA''s own line');
        ItemB.Get('ITMB');
        Assert.AreEqual(15, ItemB."Qty on Hand (Base)", 'ITMB''s stock is untouched by resolving ITMA''s line');
    end;

    [Test]
    procedure FulfillReducesOnHandByWhatTheLineActuallyConsumes()
    var
        Fulfillment: Codeunit "CG X158 Fulfillment";
        Item: Record "CG X158 Item";
        Sentinel: Record "CG X158 Item";
        OrderLine: Record "CG X158 Order Line";
    begin
        ClearAll();
        SeedItem('ITM1', 'Six-pack', 4, 50);
        SeedItem('SENTINEL', 'Untouched', 7, 999);
        SeedOrderLine('ORD1', 10000, 'ITM1', 6);

        OrderLine.Get('ORD1', 10000);
        Fulfillment.Fulfill(OrderLine);

        Item.Get('ITM1');
        Assert.AreEqual(26, Item."Qty on Hand (Base)", 'Fulfilling a line reduces its item''s on-hand stock by the quantity the line consumes');

        Sentinel.Get('SENTINEL');
        Assert.AreEqual(999, Sentinel."Qty on Hand (Base)", 'An unrelated item''s stock is untouched by fulfilling a different item''s line');
        Assert.AreEqual(7, Sentinel."Base Qty per Sales Unit", 'An unrelated item''s own figures are untouched by fulfilling a different item''s line');
    end;
}
