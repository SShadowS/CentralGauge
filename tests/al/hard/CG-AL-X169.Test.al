codeunit 89389 "CG-AL-X169 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods (see
    // tests/al/hard/CG-AL-X065.Test.al for the same note), so every test
    // clears the five persisted tables before seeding its own rows. The
    // priced-line buffer is a temporary record owned by the caller, so it
    // never needs clearing - each test declares its own.

    local procedure ClearAll()
    var
        Setup: Record "CG X169 Pricing Setup";
        Item: Record "CG X169 Item";
        PriceRule: Record "CG X169 Price Rule";
        BatchLine: Record "CG X169 Batch Line";
    begin
        Setup.DeleteAll();
        Item.DeleteAll();
        PriceRule.DeleteAll();
        BatchLine.DeleteAll();
    end;

    local procedure SeedSetup(MarginPct: Decimal; RoundingPrecision: Decimal)
    var
        Setup: Record "CG X169 Pricing Setup";
    begin
        Setup.Init();
        Setup."Code" := 'SETUP';
        Setup."Base Margin Pct" := MarginPct;
        Setup."Rounding Precision" := RoundingPrecision;
        Setup.Insert();
    end;

    local procedure SeedItem(ItemNo: Code[20]; UnitCost: Decimal; PriceGroup: Code[20])
    var
        Item: Record "CG X169 Item";
    begin
        Item.Init();
        Item."No." := ItemNo;
        Item."Unit Cost" := UnitCost;
        Item."Price Group" := PriceGroup;
        Item.Insert();
    end;

    local procedure SeedPriceRule(PriceGroup: Code[20]; MarkupPct: Decimal)
    var
        PriceRule: Record "CG X169 Price Rule";
    begin
        PriceRule.Init();
        PriceRule."Price Group" := PriceGroup;
        PriceRule."Markup Pct" := MarkupPct;
        PriceRule.Insert();
    end;

    local procedure SeedBatchLine(BatchNoValue: Code[20]; LineNoValue: Integer; ItemNo: Code[20]; Qty: Decimal)
    var
        BatchLine: Record "CG X169 Batch Line";
    begin
        BatchLine.Init();
        BatchLine."Batch No." := BatchNoValue;
        BatchLine."Line No." := LineNoValue;
        BatchLine."Item No." := ItemNo;
        BatchLine.Quantity := Qty;
        BatchLine.Insert();
    end;

    local procedure FlushDataCache()
    begin
        // The warm-up call and the fixture-seeding loop leave the session's
        // data cache warm, and a cache-served read costs zero in the
        // counters below - the graded call would then measure nothing. A
        // write to an unrelated row, followed by SelectLatestVersion, forces
        // real statements again for the measured call.
        SeedItem('PI-DECOY', 1, 'PG-DECOY');
        SelectLatestVersion();
    end;

    local procedure MaxStatements(): Integer
    begin
        exit(100);
    end;

    local procedure SeedPerfFixture(BatchNoValue: Code[20]; LineCount: Integer; DistinctItemCount: Integer)
    var
        Line: Integer;
        ItemIndex: Integer;
        GroupIndex: Integer;
        ItemNo: Code[20];
        GroupCode: Code[20];
    begin
        for ItemIndex := 1 to DistinctItemCount do begin
            ItemNo := CopyStr(StrSubstNo('PI-%1', ItemIndex), 1, MaxStrLen(ItemNo));
            GroupIndex := ((ItemIndex - 1) mod 4) + 1;
            GroupCode := CopyStr(StrSubstNo('PG-%1', GroupIndex), 1, MaxStrLen(GroupCode));
            SeedItem(ItemNo, 100 + ItemIndex, GroupCode);
        end;

        for GroupIndex := 1 to 4 do begin
            GroupCode := CopyStr(StrSubstNo('PG-%1', GroupIndex), 1, MaxStrLen(GroupCode));
            SeedPriceRule(GroupCode, 2 * GroupIndex);
        end;

        for Line := 1 to LineCount do begin
            ItemIndex := ((Line - 1) mod DistinctItemCount) + 1;
            ItemNo := CopyStr(StrSubstNo('PI-%1', ItemIndex), 1, MaxStrLen(ItemNo));
            SeedBatchLine(BatchNoValue, Line, ItemNo, 1);
        end;
    end;

    [Test]
    procedure PriceBatchAppliesMarginMarkupAndRoundingAtTwoDecimalPrecision()
    var
        Pricer: Codeunit "CG X169 Batch Pricer";
        PricedLine: Record "CG X169 Priced Line" temporary;
    begin
        ClearAll();
        SeedSetup(10.25, 0.01);
        SeedItem('ITM-1', 199.99, 'GRP-1');
        SeedPriceRule('GRP-1', 4.5);
        SeedBatchLine('B1', 1, 'ITM-1', 3);

        Pricer.PriceBatch('B1', PricedLine);

        PricedLine.Get('B1', 1);
        Assert.AreEqual(229.49, PricedLine."Unit Price",
            'Expected the unit price to reflect the item cost increased by the base margin and the price group markup, rounded to the setup precision');
        Assert.AreEqual(688.47, PricedLine."Line Amount",
            'Expected the line amount to be the unit price times the line quantity');
    end;

    [Test]
    procedure PriceBatchRoundsToAFiveCentPrecisionWhenTheSetupSaysSo()
    var
        Pricer: Codeunit "CG X169 Batch Pricer";
        PricedLine: Record "CG X169 Priced Line" temporary;
    begin
        ClearAll();
        SeedSetup(9, 0.05);
        SeedItem('ITM-2', 137, 'GRP-2');
        SeedPriceRule('GRP-2', 3);
        SeedBatchLine('B2', 1, 'ITM-2', 2);

        Pricer.PriceBatch('B2', PricedLine);

        PricedLine.Get('B2', 1);
        Assert.AreEqual(153.45, PricedLine."Unit Price",
            'Expected the unit price to be rounded to the setup''s five-cent precision, not to the nearest cent');
        Assert.AreEqual(306.90, PricedLine."Line Amount",
            'Expected the line amount to use the five-cent-rounded unit price');
    end;

    [Test]
    procedure PriceBatchRoundsToAWholeNumberPrecisionWhenTheSetupSaysSo()
    var
        Pricer: Codeunit "CG X169 Batch Pricer";
        PricedLine: Record "CG X169 Priced Line" temporary;
    begin
        ClearAll();
        SeedSetup(6.5, 1);
        SeedItem('ITM-3', 88, 'GRP-3');
        SeedPriceRule('GRP-3', 1.25);
        SeedBatchLine('B3', 1, 'ITM-3', 4);

        Pricer.PriceBatch('B3', PricedLine);

        PricedLine.Get('B3', 1);
        Assert.AreEqual(95, PricedLine."Unit Price",
            'Expected the unit price to be rounded to the setup''s whole-number precision');
        Assert.AreEqual(380, PricedLine."Line Amount",
            'Expected the line amount to use the whole-number-rounded unit price');
    end;

    [Test]
    procedure TwoLinesOnTheSameItemEachGetTheirOwnCorrectLineAmount()
    var
        Pricer: Codeunit "CG X169 Batch Pricer";
        PricedLine: Record "CG X169 Priced Line" temporary;
    begin
        ClearAll();
        SeedSetup(5, 0.01);
        SeedItem('ITM-4', 80, 'GRP-4');
        SeedPriceRule('GRP-4', 5);
        SeedBatchLine('B4', 1, 'ITM-4', 2);
        SeedBatchLine('B4', 2, 'ITM-4', 7);

        Pricer.PriceBatch('B4', PricedLine);

        PricedLine.Get('B4', 1);
        Assert.AreEqual(88, PricedLine."Unit Price",
            'Expected the first line referencing this item to carry the item''s priced unit price');
        Assert.AreEqual(176, PricedLine."Line Amount",
            'Expected the first line''s amount to scale with its own quantity');
        PricedLine.Get('B4', 2);
        Assert.AreEqual(88, PricedLine."Unit Price",
            'Expected the second line referencing the same item to carry the same unit price as the first');
        Assert.AreEqual(616, PricedLine."Line Amount",
            'Expected the second line''s amount to scale with its own quantity, not the first line''s');
    end;

    [Test]
    procedure APriceGroupWithNoMatchingRuleContributesNoMarkup()
    var
        Pricer: Codeunit "CG X169 Batch Pricer";
        PricedLine: Record "CG X169 Priced Line" temporary;
    begin
        ClearAll();
        SeedSetup(10, 0.01);
        SeedItem('ITM-5', 100, 'GRP-NONE');
        // Deliberately no "CG X169 Price Rule" row for 'GRP-NONE'.
        SeedBatchLine('B5', 1, 'ITM-5', 1);

        Pricer.PriceBatch('B5', PricedLine);

        PricedLine.Get('B5', 1);
        Assert.AreEqual(110, PricedLine."Unit Price",
            'Expected only the base margin to apply when the item''s price group has no matching markup rule');
        Assert.AreEqual(110, PricedLine."Line Amount",
            'Expected the line amount to reflect the base-margin-only unit price');
    end;

    [Test]
    procedure PricingOneBatchLeavesAnotherBatchsExistingPricingUntouched()
    var
        Pricer: Codeunit "CG X169 Batch Pricer";
        PricedLineX: Record "CG X169 Priced Line" temporary;
        PricedLineY: Record "CG X169 Priced Line" temporary;
    begin
        ClearAll();
        SeedSetup(10, 0.01);
        SeedItem('ITM-6X', 60, 'GRP-6X');
        SeedPriceRule('GRP-6X', 5);
        SeedBatchLine('B6X', 1, 'ITM-6X', 1);
        SeedItem('ITM-6Y', 200, 'GRP-6Y');
        SeedPriceRule('GRP-6Y', 3);
        SeedBatchLine('B6Y', 1, 'ITM-6Y', 1);

        Pricer.PriceBatch('B6X', PricedLineX);
        Pricer.PriceBatch('B6Y', PricedLineY);

        PricedLineX.Reset();
        Assert.AreEqual(1, PricedLineX.Count(),
            'Expected batch B6X''s own buffer to hold only its own line');
        PricedLineX.Get('B6X', 1);
        Assert.AreEqual(69, PricedLineX."Unit Price",
            'Expected batch B6X''s line to still carry its own correct price after batch B6Y was priced');

        PricedLineY.Reset();
        Assert.AreEqual(1, PricedLineY.Count(),
            'Expected batch B6Y''s own buffer to hold only its own line');
        PricedLineY.Get('B6Y', 1);
        Assert.AreEqual(226, PricedLineY."Unit Price",
            'Expected batch B6Y''s line to carry its own correct price');
    end;

    [Test]
    procedure RepricingABatchAfterALineWasAddedReplacesItsOldPricingAndKeepsTheOriginalLineCorrect()
    var
        Pricer: Codeunit "CG X169 Batch Pricer";
        PricedLine: Record "CG X169 Priced Line" temporary;
    begin
        ClearAll();
        SeedSetup(10, 0.01);
        SeedItem('ITM-7A', 50, 'GRP-7');
        SeedPriceRule('GRP-7', 5);
        SeedBatchLine('B7', 1, 'ITM-7A', 1);

        Pricer.PriceBatch('B7', PricedLine);
        PricedLine.Reset();
        Assert.AreEqual(1, PricedLine.Count(),
            'Expected exactly one priced line after the first pricing with one batch line');

        SeedItem('ITM-7B', 90, 'GRP-7');
        SeedBatchLine('B7', 2, 'ITM-7B', 1);
        Pricer.PriceBatch('B7', PricedLine);

        PricedLine.Reset();
        Assert.AreEqual(2, PricedLine.Count(),
            'Expected the repriced batch to include the line added since the last pricing, not a duplicate of it');
        PricedLine.Get('B7', 1);
        Assert.AreEqual(57.5, PricedLine."Unit Price",
            'Expected the original line''s price to still be correct after repricing, not stale or dropped');
        PricedLine.Get('B7', 2);
        Assert.AreEqual(103.5, PricedLine."Unit Price",
            'Expected the newly added line to be priced correctly after repricing');
    end;

    [Test]
    procedure PricingASecondBatchIntoTheSameBufferKeepsTheFirstBatchsRows()
    var
        Pricer: Codeunit "CG X169 Batch Pricer";
        PricedLine: Record "CG X169 Priced Line" temporary;
    begin
        ClearAll();
        SeedSetup(10, 0.01);
        SeedItem('ITM-8P', 40, 'GRP-8P');
        SeedPriceRule('GRP-8P', 5);
        SeedBatchLine('B8P', 1, 'ITM-8P', 1);
        SeedItem('ITM-8Q', 70, 'GRP-8Q');
        SeedPriceRule('GRP-8Q', 5);
        SeedBatchLine('B8Q', 1, 'ITM-8Q', 1);

        Pricer.PriceBatch('B8P', PricedLine);
        Pricer.PriceBatch('B8Q', PricedLine);

        PricedLine.Reset();
        Assert.AreEqual(2, PricedLine.Count(),
            'Expected the shared buffer to hold one line per batch across both batches after pricing each once');
        PricedLine.Get('B8P', 1);
        Assert.AreEqual(46, PricedLine."Unit Price",
            'Expected the first batch''s line to survive unchanged after a second batch was priced into the same buffer');
        PricedLine.Get('B8Q', 1);
        Assert.AreEqual(80.5, PricedLine."Unit Price",
            'Expected the second batch''s line to carry its own correct price in the shared buffer');
    end;

    [Test]
    procedure PricingABatchWithNoLinesProducesNoPricedLinesAndNoError()
    var
        Pricer: Codeunit "CG X169 Batch Pricer";
        PricedLine: Record "CG X169 Priced Line" temporary;
    begin
        ClearAll();
        SeedSetup(10, 0.01);

        Pricer.PriceBatch('B9', PricedLine);

        PricedLine.Reset();
        Assert.AreEqual(0, PricedLine.Count(),
            'Expected no priced lines at all for a batch with no lines - and no error either');
    end;

    [Test]
    procedure PricingALargeBatchCostsTheSameAsASmallOneAtAHighDistinctItemRatio()
    var
        Pricer: Codeunit "CG X169 Batch Pricer";
        WarmPricedLine: Record "CG X169 Priced Line" temporary;
        PricedLine: Record "CG X169 Priced Line" temporary;
        StatementsBefore: BigInteger;
        StatementsUsed: BigInteger;
        LineCount: Integer;
        DistinctItemCount: Integer;
    begin
        ClearAll();

        // Warm up on a small, unrelated batch first, so first-touch
        // metadata/plan loading lands outside the measurement window below.
        SeedSetup(10, 0.01);
        SeedItem('PI-WARM', 5, 'PG-WARM');
        SeedPriceRule('PG-WARM', 1);
        SeedBatchLine('WARM-A', 1, 'PI-WARM', 1);
        Pricer.PriceBatch('WARM-A', WarmPricedLine);
        ClearAll();

        // A large batch: 800 lines across 500 distinct items - most lines
        // reference their own item, with some repetition.
        LineCount := 800;
        DistinctItemCount := 500;
        SeedSetup(10, 0.01);
        SeedPerfFixture('PERF-A', LineCount, DistinctItemCount);

        FlushDataCache();
        StatementsBefore := SessionInformation.SqlStatementsExecuted();
        Pricer.PriceBatch('PERF-A', PricedLine);
        StatementsUsed := SessionInformation.SqlStatementsExecuted() - StatementsBefore;

        PricedLine.Get('PERF-A', 1);
        Assert.AreEqual(113.12, PricedLine."Unit Price",
            'Expected the correct price on the low-cost pricing before judging its cost');
        PricedLine.Get('PERF-A', LineCount);
        Assert.AreEqual(472, PricedLine."Unit Price",
            'Expected the correct price on the low-cost pricing before judging its cost - including the last line in a large batch');
        Assert.IsTrue(StatementsUsed <= MaxStatements(),
            StrSubstNo('Expected pricing a large batch to cost the same as a small one: budget %1, actual %2 against %3 lines', MaxStatements(), StatementsUsed, LineCount));
    end;

    [Test]
    procedure PricingALargeBatchCostsTheSameAsASmallOneAtALowDistinctItemRatio()
    var
        Pricer: Codeunit "CG X169 Batch Pricer";
        WarmPricedLine: Record "CG X169 Priced Line" temporary;
        PricedLine: Record "CG X169 Priced Line" temporary;
        StatementsBefore: BigInteger;
        StatementsUsed: BigInteger;
        LineCount: Integer;
        DistinctItemCount: Integer;
    begin
        ClearAll();

        // Warm up on a small, unrelated batch first, so first-touch
        // metadata/plan loading lands outside the measurement window below.
        SeedSetup(10, 0.01);
        SeedItem('PI-WARM', 5, 'PG-WARM');
        SeedPriceRule('PG-WARM', 1);
        SeedBatchLine('WARM-B', 1, 'PI-WARM', 1);
        Pricer.PriceBatch('WARM-B', WarmPricedLine);
        ClearAll();

        // A large batch: 1000 lines across only 250 distinct items - most
        // lines repeat an item already seen earlier in the batch, the
        // opposite shape from the test above.
        LineCount := 1000;
        DistinctItemCount := 250;
        SeedSetup(10, 0.01);
        SeedPerfFixture('PERF-B', LineCount, DistinctItemCount);

        FlushDataCache();
        StatementsBefore := SessionInformation.SqlStatementsExecuted();
        Pricer.PriceBatch('PERF-B', PricedLine);
        StatementsUsed := SessionInformation.SqlStatementsExecuted() - StatementsBefore;

        PricedLine.Get('PERF-B', 1);
        Assert.AreEqual(113.12, PricedLine."Unit Price",
            'Expected the correct price on the low-cost pricing before judging its cost');
        PricedLine.Get('PERF-B', LineCount);
        Assert.AreEqual(399, PricedLine."Unit Price",
            'Expected the correct price on the low-cost pricing before judging its cost - including the last line in a large batch');
        Assert.IsTrue(StatementsUsed <= MaxStatements(),
            StrSubstNo('Expected pricing a large batch to cost the same as a small one: budget %1, actual %2 against %3 lines', MaxStatements(), StatementsUsed, LineCount));
    end;
}
