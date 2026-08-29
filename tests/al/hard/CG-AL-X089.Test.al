codeunit 89086 "CG-AL-X089 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods (see
    // tests/al/hard/CG-AL-X065.Test.al for the same note), so every test
    // clears both tables before seeding its own rows.

    local procedure ClearAll()
    var
        Item: Record "CG X089 Item";
        JnlLine: Record "CG X089 Journal Line";
    begin
        JnlLine.DeleteAll();
        Item.DeleteAll();
    end;

    local procedure CreateItem(ItemNo: Code[20]; UnitPrice: Decimal)
    var
        Item: Record "CG X089 Item";
    begin
        Item.Init();
        Item."No." := ItemNo;
        Item.Description := ItemNo;
        Item."Unit Price" := UnitPrice;
        Item.Insert();
    end;

    local procedure AddLine(TemplateName: Code[10]; BatchName: Code[10]; ItemNo: Code[20]; Qty: Decimal; StampedUnitAmount: Decimal)
    var
        JnlLine: Record "CG X089 Journal Line";
    begin
        JnlLine.Init();
        JnlLine."Template Name" := TemplateName;
        JnlLine."Batch Name" := BatchName;
        JnlLine."Item No." := ItemNo;
        JnlLine.Quantity := Qty;
        JnlLine."Unit Amount" := StampedUnitAmount;
        JnlLine.Insert(true);
    end;

    local procedure GetValue(Totals: Dictionary of [Code[20], Decimal]; ItemNo: Code[20]): Decimal
    begin
        Assert.IsTrue(Totals.ContainsKey(ItemNo), StrSubstNo('Expected item %1 to appear in the valuation', ItemNo));
        exit(Totals.Get(ItemNo));
    end;

    [Test]
    procedure SumsAllLinesOfOneItemIntoOneTotal()
    var
        BatchValuation: Codeunit "CG X089 Batch Valuation";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateItem('CGX89-A', 12.5);
        AddLine('CGXT1', 'CGXB1', 'CGX89-A', 3, 12.5);
        AddLine('CGXT1', 'CGXB1', 'CGX89-A', 2, 12.5);
        AddLine('CGXT1', 'CGXB1', 'CGX89-A', 4, 12.5);

        Totals := BatchValuation.ValueByItem('CGXT1', 'CGXB1');

        Assert.AreEqual(9 * 12.5, GetValue(Totals, 'CGX89-A'),
            'Expected the item''s value to add up quantity times unit price across every line of the batch');
    end;

    [Test]
    procedure KeepsEachItemsValueSeparate()
    var
        BatchValuation: Codeunit "CG X089 Batch Valuation";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateItem('CGX89-A', 10);
        CreateItem('CGX89-B', 250);
        AddLine('CGXT2', 'CGXB2', 'CGX89-A', 4, 10);
        AddLine('CGXT2', 'CGXB2', 'CGX89-B', 3, 250);

        Totals := BatchValuation.ValueByItem('CGXT2', 'CGXB2');

        Assert.AreEqual(40, GetValue(Totals, 'CGX89-A'), 'Expected item A''s value to be built only from item A''s own lines and price');
        Assert.AreEqual(750, GetValue(Totals, 'CGX89-B'), 'Expected item B''s value to be built only from item B''s own lines and price');
    end;

    [Test]
    procedure NegativeQuantityReducesTheValue()
    var
        BatchValuation: Codeunit "CG X089 Batch Valuation";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateItem('CGX89-A', 20);
        AddLine('CGXT3', 'CGXB3', 'CGX89-A', 8, 20);
        AddLine('CGXT3', 'CGXB3', 'CGX89-A', -3, 20);

        Totals := BatchValuation.ValueByItem('CGXT3', 'CGXB3');

        Assert.AreEqual(100, GetValue(Totals, 'CGX89-A'), 'Expected the negative quantity (an outbound adjustment) to reduce the item''s value, not to be skipped');
    end;

    [Test]
    procedure UsesTheItemCardPriceNotTheLineStamp()
    var
        BatchValuation: Codeunit "CG X089 Batch Valuation";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateItem('CGX89-A', 500);
        AddLine('CGXT4', 'CGXB4', 'CGX89-A', 2, 50);

        Totals := BatchValuation.ValueByItem('CGXT4', 'CGXB4');

        Assert.AreEqual(1000, GetValue(Totals, 'CGX89-A'),
            'Expected the value at the item''s current price - a different value stamped on the line itself must be ignored');
    end;

    [Test]
    procedure LinesOutsideTheBatchAreNotCounted()
    var
        BatchValuation: Codeunit "CG X089 Batch Valuation";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateItem('CGX89-A', 10);
        AddLine('CGXT5', 'CGXB5', 'CGX89-A', 5, 10);
        AddLine('CGXT5', 'CGXB5X', 'CGX89-A', 7, 10);
        AddLine('CGXT5X', 'CGXB5', 'CGX89-A', 9, 10);

        Totals := BatchValuation.ValueByItem('CGXT5', 'CGXB5');

        Assert.AreEqual(1, Totals.Count(), 'Expected exactly one item in the valuation - the other lines belong to a different template or a different batch');
        Assert.AreEqual(50, GetValue(Totals, 'CGX89-A'), 'Expected the value to be built only from lines matching both the template name and the batch name');
    end;

    [Test]
    procedure EveryItemAppearsExactlyOnce()
    var
        BatchValuation: Codeunit "CG X089 Batch Valuation";
        Totals: Dictionary of [Code[20], Decimal];
        ItemNo: Code[20];
        i: Integer;
    begin
        ClearAll();
        for i := 1 to 6 do begin
            ItemNo := CopyStr(StrSubstNo('CGX89-M%1', i), 1, MaxStrLen(ItemNo));
            CreateItem(ItemNo, 10);
            AddLine('CGXT6', 'CGXB6', ItemNo, 1, 10);
            AddLine('CGXT6', 'CGXB6', ItemNo, 2, 10);
        end;

        Totals := BatchValuation.ValueByItem('CGXT6', 'CGXB6');

        Assert.AreEqual(6, Totals.Count(), 'Expected exactly one entry per distinct item, however many lines that item has');
        for i := 1 to 6 do begin
            ItemNo := CopyStr(StrSubstNo('CGX89-M%1', i), 1, MaxStrLen(ItemNo));
            Assert.AreEqual(30, GetValue(Totals, ItemNo), StrSubstNo('Expected item %1 to appear once with both its lines added together', ItemNo));
        end;
    end;

    [Test]
    procedure ItemWithoutLinesDoesNotAppear()
    var
        BatchValuation: Codeunit "CG X089 Batch Valuation";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateItem('CGX89-A', 10);
        CreateItem('CGX89-B', 20);
        AddLine('CGXT7', 'CGXB7', 'CGX89-A', 5, 10);

        Totals := BatchValuation.ValueByItem('CGXT7', 'CGXB7');

        Assert.IsFalse(Totals.ContainsKey('CGX89-B'), 'Expected an item that sits on no line of the batch to stay out of the valuation - the master record alone earns no entry');
        Assert.AreEqual(1, Totals.Count(), 'Expected only the item that actually appears on the batch''s lines');
    end;

    [Test]
    procedure ZeroPriceItemAppearsWithZeroValue()
    var
        BatchValuation: Codeunit "CG X089 Batch Valuation";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateItem('CGX89-A', 0);
        AddLine('CGXT8', 'CGXB8', 'CGX89-A', 5, 123.45);

        Totals := BatchValuation.ValueByItem('CGXT8', 'CGXB8');

        Assert.IsTrue(Totals.ContainsKey('CGX89-A'), 'Expected the item to stay in the valuation even though its current price is 0');
        Assert.AreEqual(0, GetValue(Totals, 'CGX89-A'), 'Expected a value of exactly 0 for a zero-price item - the non-zero amount stamped on the line must not step in');
    end;

    [Test]
    procedure EmptyBatchReturnsEmpty()
    var
        BatchValuation: Codeunit "CG X089 Batch Valuation";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateItem('CGX89-A', 10);

        Totals := BatchValuation.ValueByItem('CGXTE', 'CGXBE');

        Assert.AreEqual(0, Totals.Count(), 'Expected an empty valuation and no error for a batch with no lines at all');
    end;

    [Test]
    procedure PriceChangedBeforeTheNextCallIsPickedUp()
    var
        BatchValuation: Codeunit "CG X089 Batch Valuation";
        Item: Record "CG X089 Item";
        Totals: Dictionary of [Code[20], Decimal];
    begin
        ClearAll();
        CreateItem('CGX89-A', 15);
        AddLine('CGXT10', 'CGXB10', 'CGX89-A', 4, 15);

        // first call on the very same codeunit variable primes any cache a submission keeps across calls
        BatchValuation.ValueByItem('CGXT10', 'CGXB10');
        Item.Get('CGX89-A');
        Item."Unit Price" := 200;
        Item.Modify();

        Totals := BatchValuation.ValueByItem('CGXT10', 'CGXB10');

        Assert.AreEqual(800, GetValue(Totals, 'CGX89-A'),
            'Expected the second call to value the batch at the item''s new current price - a price remembered from an earlier call must not step in');
    end;

    [Test]
    procedure ValuingALargeBatchCostsTheSameHoweverManyDistinctItemsItTouches()
    var
        BatchValuation: Codeunit "CG X089 Batch Valuation";
        Totals: Dictionary of [Code[20], Decimal];
        ItemNo: Code[20];
        ItemCount: Integer;
        StmtBefore: BigInteger;
        StmtAfter: BigInteger;
        StmtDelta: BigInteger;
        i: Integer;
    begin
        ClearAll();

        // Warm-up: exercise the procedure once on a small, unrelated batch so
        // first-touch metadata/plan loading lands outside the measurement
        // window below.
        CreateItem('CGX89-WARM', 5);
        AddLine('CGXTW', 'CGXBW', 'CGX89-WARM', 1, 5);
        BatchValuation.ValueByItem('CGXTW', 'CGXBW');
        ClearAll();

        // 200 distinct items, each on its own line - the case that must not
        // cost work proportional to how many distinct items the batch touches.
        // Every distinct item's price must appear in the returned dictionary,
        // so any correct implementation reads at least 200 item rows here -
        // row count cannot separate a bulk fetch from a per-item one. The
        // number of ROUND TRIPS to get there is what must stay flat, so only
        // the SQL statement count is budgeted below.
        ItemCount := 200;
        for i := 1 to ItemCount do begin
            ItemNo := CopyStr(StrSubstNo('CGX89-B%1', i), 1, MaxStrLen(ItemNo));
            CreateItem(ItemNo, 10);
            AddLine('CGXT9', 'CGXB9', ItemNo, 2, 10);
        end;

        StmtBefore := SessionInformation.SqlStatementsExecuted;

        Totals := BatchValuation.ValueByItem('CGXT9', 'CGXB9');

        StmtAfter := SessionInformation.SqlStatementsExecuted;
        StmtDelta := StmtAfter - StmtBefore;

        Assert.AreEqual(ItemCount, Totals.Count(),
            StrSubstNo('Expected every one of the %1 items in the valuation before judging the cost', ItemCount));
        Assert.AreEqual(20, GetValue(Totals, 'CGX89-B1'), 'Expected the low-cost valuation to still carry the real numbers');
        Assert.IsTrue(
            StmtDelta <= 20,
            StrSubstNo('Expected the valuation''s cost to stay flat no matter how many distinct items the batch touches: budget %1, actual %2 for %3 distinct items', 20, StmtDelta, ItemCount));
    end;
}
