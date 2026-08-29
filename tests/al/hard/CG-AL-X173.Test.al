codeunit 89393 "CG-AL-X173 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods, so
    // every test clears every persisted table before seeding its own rows.
    // The posting-line input and posted-purchase output buffers are both
    // temporary records owned by the caller, so they never need clearing -
    // each test declares its own.

    local procedure ClearAll()
    var
        Requisition: Record "CG X156 Requisition";
        Item: Record "CG X158 Item";
        OrderLine: Record "CG X158 Order Line";
        Vendor: Record "CG X173 Vendor";
        Terms: Record "CG X173 Payment Terms";
        BlockEntry: Record "CG X151 Block Entry";
        BlockList: Codeunit "CG X151 Block List";
    begin
        Requisition.DeleteAll();
        Item.DeleteAll();
        OrderLine.DeleteAll();
        Vendor.DeleteAll();
        Terms.DeleteAll();
        BlockEntry.DeleteAll();
        BlockList.Invalidate();
    end;

    local procedure SeedRequisition(No: Code[20]; RequisitionDescription: Text[100]; RequisitionQuantity: Decimal; RequisitionStatus: Enum "CG X156 Requisition Status")
    var
        Requisition: Record "CG X156 Requisition";
    begin
        Requisition.Init();
        Requisition."No." := No;
        Requisition.Description := RequisitionDescription;
        Requisition.Quantity := RequisitionQuantity;
        Requisition.Status := RequisitionStatus;
        Requisition.Insert();
    end;

    local procedure SeedItem(No: Code[20]; ItemDescription: Text[100]; BaseQtyPerSalesUnit: Decimal; QtyOnHand: Decimal)
    var
        Item: Record "CG X158 Item";
    begin
        Item.Init();
        Item."No." := No;
        Item.Description := ItemDescription;
        Item."Base Qty per Sales Unit" := BaseQtyPerSalesUnit;
        Item."Qty on Hand (Base)" := QtyOnHand;
        Item.Insert();
    end;

    local procedure SeedOrderLine(OrderNo: Code[20]; LineNo: Integer; ItemNo: Code[20]; LineQuantity: Decimal)
    var
        OrderLine: Record "CG X158 Order Line";
    begin
        OrderLine.Init();
        OrderLine."Order No." := OrderNo;
        OrderLine."Line No." := LineNo;
        OrderLine."Item No." := ItemNo;
        OrderLine.Quantity := LineQuantity;
        OrderLine.Insert();
    end;

    local procedure SeedVendor(No: Code[20]; VendorName: Text[100]; TermsCode: Code[10])
    var
        Vendor: Record "CG X173 Vendor";
    begin
        Vendor.Init();
        Vendor."No." := No;
        Vendor.Name := VendorName;
        Vendor."Terms Code" := TermsCode;
        Vendor.Insert();
    end;

    local procedure SeedTerms(Code: Code[10]; DiscountPct: Decimal)
    var
        Terms: Record "CG X173 Payment Terms";
    begin
        Terms.Init();
        Terms."Code" := Code;
        Terms."Discount Pct" := DiscountPct;
        Terms.Insert();
    end;

    local procedure SeedPostingLine(var PostingLine: Record "CG X173 Posting Line" temporary; RequisitionNo: Code[20]; VendorNo: Code[20]; ItemNo: Code[20]; UnitCost: Decimal)
    begin
        PostingLine.Init();
        PostingLine."Requisition No." := RequisitionNo;
        PostingLine."Vendor No." := VendorNo;
        PostingLine."Item No." := ItemNo;
        PostingLine."Unit Cost" := UnitCost;
        PostingLine.Insert();
    end;

    local procedure AssertPosted(var PostedPurchase: Record "CG X173 Posted Purchase" temporary; RequisitionNo: Code[20]; ExpectedVendorNo: Code[20]; ExpectedVendorName: Text[100]; ExpectedQuantity: Decimal; ExpectedUnitCost: Decimal; ExpectedDiscountPct: Decimal; ExpectedNetAmount: Decimal; MessagePrefix: Text)
    begin
        Assert.IsTrue(PostedPurchase.Get(RequisitionNo), MessagePrefix + ' - line was posted');
        Assert.AreEqual(ExpectedVendorNo, PostedPurchase."Vendor No.", MessagePrefix + ' - vendor no.');
        Assert.AreEqual(ExpectedVendorName, PostedPurchase."Vendor Name", MessagePrefix + ' - vendor name');
        Assert.AreEqual(ExpectedQuantity, PostedPurchase.Quantity, MessagePrefix + ' - quantity');
        Assert.AreEqual(ExpectedUnitCost, PostedPurchase."Unit Cost", MessagePrefix + ' - unit cost');
        Assert.AreEqual(ExpectedDiscountPct, PostedPurchase."Discount Pct", MessagePrefix + ' - discount pct');
        Assert.AreEqual(ExpectedNetAmount, PostedPurchase."Net Amount", MessagePrefix + ' - net amount');
    end;

    local procedure AssertNotPosted(var PostedPurchase: Record "CG X173 Posted Purchase" temporary; RequisitionNo: Code[20]; MessagePrefix: Text)
    begin
        Assert.IsFalse(PostedPurchase.Get(RequisitionNo), MessagePrefix + ' - line must not be posted');
    end;

    local procedure FlushDataCache()
    begin
        // Fixture-seeding writes leave the session's data cache warm, and a
        // cache-served read costs zero in the counters below - the measured
        // call would then measure nothing. A write to an unrelated row,
        // followed by SelectLatestVersion, forces real statements again for
        // the measured call.
        SeedVendor('VEND-DECOY', 'Decoy Vendor', 'DECOY-TC');
        SelectLatestVersion();
    end;

    local procedure MaxStatements(): Integer
    begin
        exit(40);
    end;

    // =================================================================
    // Requisition lifecycle tests (regression: CG X156)
    // =================================================================

    [Test]
    procedure RequisitionStatusAdvancesThroughEachStageInOrder()
    var
        Mgt: Codeunit "CG X156 Requisition Mgt";
        Requisition: Record "CG X156 Requisition";
    begin
        ClearAll();
        SeedRequisition('REQ-LC1', 'Forklift service', 3, Enum::"CG X156 Requisition Status"::Open);

        Mgt.SubmitForApproval('REQ-LC1');
        Requisition.Get('REQ-LC1');
        Assert.AreEqual(Enum::"CG X156 Requisition Status"::PendingApproval.AsInteger(), Requisition.Status.AsInteger(),
            'Expected the requisition to move to Pending Approval after being submitted');

        Mgt.ConfirmPrepayment('REQ-LC1');
        Requisition.Get('REQ-LC1');
        Assert.AreEqual(Enum::"CG X156 Requisition Status"::PrepaymentWait.AsInteger(), Requisition.Status.AsInteger(),
            'Expected the requisition to move to Prepayment Wait after its prepayment is confirmed');

        Mgt.Release('REQ-LC1');
        Requisition.Get('REQ-LC1');
        Assert.AreEqual(Enum::"CG X156 Requisition Status"::Released.AsInteger(), Requisition.Status.AsInteger(),
            'Expected the requisition to move to Released after being released');
    end;

    [Test]
    procedure UpdateQuantityIsRefusedOnceReleasedAndLeavesItUnchanged()
    var
        Mgt: Codeunit "CG X156 Requisition Mgt";
        Requisition: Record "CG X156 Requisition";
    begin
        ClearAll();
        SeedRequisition('REQ-LC2', 'Annual software licences', 50, Enum::"CG X156 Requisition Status"::Open);
        Mgt.SubmitForApproval('REQ-LC2');
        Mgt.ConfirmPrepayment('REQ-LC2');
        Mgt.Release('REQ-LC2');
        Commit();

        asserterror Mgt.UpdateQuantity('REQ-LC2', 999);
        Assert.ExpectedError('already been released');

        Requisition.Get('REQ-LC2');
        Assert.AreEqual(50, Requisition.Quantity,
            'Expected a refused quantity change to leave the Released requisition''s quantity unchanged');
    end;

    [Test]
    procedure UpdatingOneRequisitionsQuantityDoesNotAffectAnother()
    var
        Mgt: Codeunit "CG X156 Requisition Mgt";
        RequisitionA: Record "CG X156 Requisition";
        RequisitionB: Record "CG X156 Requisition";
    begin
        ClearAll();
        SeedRequisition('REQ-LC3A', 'North depot pallets', 30, Enum::"CG X156 Requisition Status"::Open);
        SeedRequisition('REQ-LC3B', 'South depot pallets', 45, Enum::"CG X156 Requisition Status"::Open);

        Mgt.UpdateQuantity('REQ-LC3A', 60);

        RequisitionA.Get('REQ-LC3A');
        Assert.AreEqual(60, RequisitionA.Quantity, 'Expected REQ-LC3A''s own quantity to change');
        RequisitionB.Get('REQ-LC3B');
        Assert.AreEqual(45, RequisitionB.Quantity, 'Expected REQ-LC3B''s quantity to survive an unrelated requisition''s update');
    end;

    // =================================================================
    // Item fulfillment tests (regression: CG X158)
    // =================================================================

    [Test]
    procedure ItemFulfillmentAcceptsALineWithinStock()
    var
        Fulfillment: Codeunit "CG X158 Fulfillment";
        OrderLine: Record "CG X158 Order Line";
    begin
        ClearAll();
        SeedItem('ITM-F1', 'Single unit', 1, 20);
        SeedOrderLine('ORD-F1', 10000, 'ITM-F1', 15);

        OrderLine.Get('ORD-F1', 10000);
        Assert.IsTrue(Fulfillment.CanFulfill(OrderLine), 'Expected a line within stock to be accepted');
    end;

    [Test]
    procedure ItemFulfillmentRefusesALineOverStock()
    var
        Fulfillment: Codeunit "CG X158 Fulfillment";
        OrderLine: Record "CG X158 Order Line";
    begin
        ClearAll();
        SeedItem('ITM-F2', 'Single unit', 1, 20);
        SeedOrderLine('ORD-F2', 10000, 'ITM-F2', 25);

        OrderLine.Get('ORD-F2', 10000);
        Assert.IsFalse(Fulfillment.CanFulfill(OrderLine), 'Expected a line over stock to be refused');
    end;

    [Test]
    procedure FulfillReducesOnlyTheConsumedItemsStock()
    var
        Fulfillment: Codeunit "CG X158 Fulfillment";
        Item: Record "CG X158 Item";
        Sentinel: Record "CG X158 Item";
        OrderLine: Record "CG X158 Order Line";
    begin
        ClearAll();
        SeedItem('ITM-F3', 'Six-pack', 1, 50);
        SeedItem('ITM-F3-SENT', 'Untouched', 1, 999);
        SeedOrderLine('ORD-F3', 10000, 'ITM-F3', 6);

        OrderLine.Get('ORD-F3', 10000);
        Fulfillment.Fulfill(OrderLine);

        Item.Get('ITM-F3');
        Assert.AreEqual(44, Item."Qty on Hand (Base)", 'Expected fulfilling a line to reduce its own item''s on-hand stock by the consumed quantity');
        Sentinel.Get('ITM-F3-SENT');
        Assert.AreEqual(999, Sentinel."Qty on Hand (Base)", 'Expected an unrelated item''s stock to survive fulfilling a different item''s line');
    end;

    // =================================================================
    // Vendor block-list tests (regression: CG X151)
    // =================================================================

    [Test]
    procedure BlockingAVendorTakesEffectImmediatelyAndClearingStopsIt()
    var
        BlockList: Codeunit "CG X151 Block List";
    begin
        ClearAll();
        Assert.IsFalse(BlockList.IsBlocked('VEND-BL1'), 'Expected a code with no history to not be reported as blocked');

        BlockList.SetBlocked('VEND-BL1');
        Assert.IsTrue(BlockList.IsBlocked('VEND-BL1'), 'Expected blocking a code to be reported immediately');

        BlockList.ClearBlocked('VEND-BL1');
        Assert.IsFalse(BlockList.IsBlocked('VEND-BL1'), 'Expected clearing a code to stop it being reported as blocked');
    end;

    [Test]
    procedure ClearingOneVendorLeavesAnotherBlockedVendorUntouched()
    var
        BlockList: Codeunit "CG X151 Block List";
    begin
        ClearAll();
        BlockList.SetBlocked('VEND-BL2A');
        BlockList.SetBlocked('VEND-BL2B');

        BlockList.ClearBlocked('VEND-BL2B');

        Assert.IsTrue(BlockList.IsBlocked('VEND-BL2A'), 'Expected clearing one code to leave another blocked code untouched');
        Assert.IsFalse(BlockList.IsBlocked('VEND-BL2B'), 'Expected the cleared code to stop being reported as blocked');
    end;

    // =================================================================
    // Composed purchase-posting tests (glue: CG X173)
    // =================================================================

    [Test]
    procedure ReleasedLineIsPostedWithExactComputedValues()
    var
        Poster: Codeunit "CG X173 Purchase Poster";
        PostingLine: Record "CG X173 Posting Line" temporary;
        PostedPurchase: Record "CG X173 Posted Purchase" temporary;
    begin
        ClearAll();
        SeedRequisition('REQ-G1', 'Office chairs', 10, Enum::"CG X156 Requisition Status"::Released);
        SeedItem('ITM-G1', 'Chair', 1, 1000);
        SeedVendor('VEND-G1', 'Nordic Office Supply', 'NET30');
        SeedTerms('NET30', 2);
        SeedPostingLine(PostingLine, 'REQ-G1', 'VEND-G1', 'ITM-G1', 45);

        Poster.PostPurchaseRun(PostingLine, PostedPurchase);

        AssertPosted(PostedPurchase, 'REQ-G1', 'VEND-G1', 'Nordic Office Supply', 10, 45, 2, 10 * 45 * (1 - 2 / 100),
            'A single released, unblocked, fulfillable line');
    end;

    [Test]
    procedure NonReleasedRequisitionsAreExcludedFromEveryStatus()
    var
        Poster: Codeunit "CG X173 Purchase Poster";
        PostingLine: Record "CG X173 Posting Line" temporary;
        PostedPurchase: Record "CG X173 Posted Purchase" temporary;
    begin
        ClearAll();
        SeedRequisition('REQ-G2-OPEN', 'Open req', 5, Enum::"CG X156 Requisition Status"::Open);
        SeedRequisition('REQ-G2-PEND', 'Pending req', 5, Enum::"CG X156 Requisition Status"::PendingApproval);
        SeedRequisition('REQ-G2-PREP', 'Prepay req', 5, Enum::"CG X156 Requisition Status"::PrepaymentWait);
        SeedRequisition('REQ-G2-REL', 'Released req', 5, Enum::"CG X156 Requisition Status"::Released);
        SeedItem('ITM-G2', 'Widget', 1, 1000);
        SeedVendor('VEND-G2', 'Widget Vendor', 'NET30');
        SeedTerms('NET30', 0);

        SeedPostingLine(PostingLine, 'REQ-G2-OPEN', 'VEND-G2', 'ITM-G2', 10);
        SeedPostingLine(PostingLine, 'REQ-G2-PEND', 'VEND-G2', 'ITM-G2', 10);
        SeedPostingLine(PostingLine, 'REQ-G2-PREP', 'VEND-G2', 'ITM-G2', 10);
        SeedPostingLine(PostingLine, 'REQ-G2-REL', 'VEND-G2', 'ITM-G2', 10);

        Poster.PostPurchaseRun(PostingLine, PostedPurchase);

        Assert.AreEqual(1, PostedPurchase.Count(), 'Expected only the Released requisition''s line to post');
        AssertNotPosted(PostedPurchase, 'REQ-G2-OPEN', 'An Open requisition');
        AssertNotPosted(PostedPurchase, 'REQ-G2-PEND', 'A requisition awaiting approval');
        AssertNotPosted(PostedPurchase, 'REQ-G2-PREP', 'A requisition awaiting prepayment');
        Assert.IsTrue(PostedPurchase.Get('REQ-G2-REL'), 'Expected the Released requisition''s line to post');
    end;

    [Test]
    procedure BlockedVendorLineIsExcludedButOtherLinesStillPost()
    var
        Poster: Codeunit "CG X173 Purchase Poster";
        BlockList: Codeunit "CG X151 Block List";
        PostingLine: Record "CG X173 Posting Line" temporary;
        PostedPurchase: Record "CG X173 Posted Purchase" temporary;
    begin
        ClearAll();
        SeedRequisition('REQ-G3A', 'Blocked vendor line', 5, Enum::"CG X156 Requisition Status"::Released);
        SeedRequisition('REQ-G3B', 'Clean vendor line', 5, Enum::"CG X156 Requisition Status"::Released);
        SeedItem('ITM-G3', 'Widget', 1, 1000);
        SeedVendor('VEND-G3A', 'Blocked Vendor', 'NET30');
        SeedVendor('VEND-G3B', 'Clean Vendor', 'NET30');
        SeedTerms('NET30', 0);
        BlockList.SetBlocked('VEND-G3A');

        SeedPostingLine(PostingLine, 'REQ-G3A', 'VEND-G3A', 'ITM-G3', 10);
        SeedPostingLine(PostingLine, 'REQ-G3B', 'VEND-G3B', 'ITM-G3', 10);

        Poster.PostPurchaseRun(PostingLine, PostedPurchase);

        AssertNotPosted(PostedPurchase, 'REQ-G3A', 'A line whose vendor is blocked');
        Assert.IsTrue(PostedPurchase.Get('REQ-G3B'), 'Expected an unrelated line''s own unblocked vendor to still post');
    end;

    [Test]
    procedure BlockedItemLineIsExcludedButOtherLinesStillPost()
    var
        Poster: Codeunit "CG X173 Purchase Poster";
        BlockList: Codeunit "CG X151 Block List";
        PostingLine: Record "CG X173 Posting Line" temporary;
        PostedPurchase: Record "CG X173 Posted Purchase" temporary;
    begin
        ClearAll();
        SeedRequisition('REQ-G4A', 'Blocked item line', 5, Enum::"CG X156 Requisition Status"::Released);
        SeedRequisition('REQ-G4B', 'Clean item line', 5, Enum::"CG X156 Requisition Status"::Released);
        SeedItem('ITM-G4A', 'Blocked Item', 1, 1000);
        SeedItem('ITM-G4B', 'Clean Item', 1, 1000);
        SeedVendor('VEND-G4', 'Shared Vendor', 'NET30');
        SeedTerms('NET30', 0);
        BlockList.SetBlocked('ITM-G4A');

        SeedPostingLine(PostingLine, 'REQ-G4A', 'VEND-G4', 'ITM-G4A', 10);
        SeedPostingLine(PostingLine, 'REQ-G4B', 'VEND-G4', 'ITM-G4B', 10);

        Poster.PostPurchaseRun(PostingLine, PostedPurchase);

        AssertNotPosted(PostedPurchase, 'REQ-G4A', 'A line whose item is blocked');
        Assert.IsTrue(PostedPurchase.Get('REQ-G4B'), 'Expected an unrelated line''s own unblocked item to still post');
    end;

    [Test]
    procedure UnfulfillableLineIsExcludedButOtherLinesStillPost()
    var
        Poster: Codeunit "CG X173 Purchase Poster";
        PostingLine: Record "CG X173 Posting Line" temporary;
        PostedPurchase: Record "CG X173 Posted Purchase" temporary;
    begin
        ClearAll();
        SeedRequisition('REQ-G5A', 'Short stock line', 50, Enum::"CG X156 Requisition Status"::Released);
        SeedRequisition('REQ-G5B', 'Well stocked line', 5, Enum::"CG X156 Requisition Status"::Released);
        SeedItem('ITM-G5A', 'Scarce Item', 1, 10);
        SeedItem('ITM-G5B', 'Plentiful Item', 1, 1000);
        SeedVendor('VEND-G5', 'Shared Vendor', 'NET30');
        SeedTerms('NET30', 0);

        SeedPostingLine(PostingLine, 'REQ-G5A', 'VEND-G5', 'ITM-G5A', 10);
        SeedPostingLine(PostingLine, 'REQ-G5B', 'VEND-G5', 'ITM-G5B', 10);

        Poster.PostPurchaseRun(PostingLine, PostedPurchase);

        AssertNotPosted(PostedPurchase, 'REQ-G5A', 'A line whose item cannot cover the requested quantity');
        Assert.IsTrue(PostedPurchase.Get('REQ-G5B'), 'Expected an unrelated, well-stocked line to still post');
    end;

    [Test]
    procedure SeveralVendorsAndTermsEachKeepTheirOwnDiscountAndNetAmount()
    var
        Poster: Codeunit "CG X173 Purchase Poster";
        PostingLine: Record "CG X173 Posting Line" temporary;
        PostedPurchase: Record "CG X173 Posted Purchase" temporary;
    begin
        ClearAll();
        SeedRequisition('REQ-G6A', 'Line A', 20, Enum::"CG X156 Requisition Status"::Released);
        SeedRequisition('REQ-G6B', 'Line B', 8, Enum::"CG X156 Requisition Status"::Released);
        SeedRequisition('REQ-G6C', 'Line C', 12, Enum::"CG X156 Requisition Status"::Released);
        SeedItem('ITM-G6', 'Shared Item', 1, 100000);
        SeedVendor('VEND-G6A', 'Vendor A', 'T-A');
        SeedVendor('VEND-G6B', 'Vendor B', 'T-B');
        SeedVendor('VEND-G6C', 'Vendor C', 'T-C');
        SeedTerms('T-A', 5);
        SeedTerms('T-B', 0);
        SeedTerms('T-C', 12.5);

        SeedPostingLine(PostingLine, 'REQ-G6A', 'VEND-G6A', 'ITM-G6', 100);
        SeedPostingLine(PostingLine, 'REQ-G6B', 'VEND-G6B', 'ITM-G6', 250);
        SeedPostingLine(PostingLine, 'REQ-G6C', 'VEND-G6C', 'ITM-G6', 60);

        Poster.PostPurchaseRun(PostingLine, PostedPurchase);

        AssertPosted(PostedPurchase, 'REQ-G6A', 'VEND-G6A', 'Vendor A', 20, 100, 5, 20 * 100 * (1 - 5 / 100),
            'Line A keeps its own vendor''s discount');
        AssertPosted(PostedPurchase, 'REQ-G6B', 'VEND-G6B', 'Vendor B', 8, 250, 0, 8 * 250 * (1 - 0 / 100),
            'Line B''s zero-discount terms must not borrow another line''s discount');
        AssertPosted(PostedPurchase, 'REQ-G6C', 'VEND-G6C', 'Vendor C', 12, 60, 12.5, 12 * 60 * (1 - 12.5 / 100),
            'Line C keeps its own vendor''s discount even after two other lines were posted first');
    end;

    [Test]
    procedure RunningASecondPostingRunReplacesTheOutputNotAccumulates()
    var
        Poster: Codeunit "CG X173 Purchase Poster";
        PostingLine: Record "CG X173 Posting Line" temporary;
        PostedPurchase: Record "CG X173 Posted Purchase" temporary;
    begin
        ClearAll();
        SeedRequisition('REQ-G7A', 'First run line', 5, Enum::"CG X156 Requisition Status"::Released);
        SeedItem('ITM-G7', 'Shared Item', 1, 1000);
        SeedVendor('VEND-G7', 'Shared Vendor', 'NET30');
        SeedTerms('NET30', 0);

        SeedPostingLine(PostingLine, 'REQ-G7A', 'VEND-G7', 'ITM-G7', 10);
        Poster.PostPurchaseRun(PostingLine, PostedPurchase);
        Assert.AreEqual(1, PostedPurchase.Count(), 'Expected the first run to post exactly its own one line');

        PostingLine.Reset();
        PostingLine.DeleteAll();
        SeedRequisition('REQ-G7B', 'Second run line', 7, Enum::"CG X156 Requisition Status"::Released);
        SeedPostingLine(PostingLine, 'REQ-G7B', 'VEND-G7', 'ITM-G7', 10);

        Poster.PostPurchaseRun(PostingLine, PostedPurchase);

        Assert.AreEqual(1, PostedPurchase.Count(), 'Expected a second run reusing the same output buffer to replace the first run''s line, not add to it');
        AssertNotPosted(PostedPurchase, 'REQ-G7A', 'The first run''s line after a second run replaced the buffer');
        Assert.IsTrue(PostedPurchase.Get('REQ-G7B'), 'Expected the second run''s own line to be present after replacing the buffer');
    end;

    // =================================================================
    // Performance tests (live symptom: CG X173)
    // =================================================================

    [Test]
    procedure PostingALargeRunCostsNoMoreThanPostingASmallOne()
    var
        Poster: Codeunit "CG X173 Purchase Poster";
        WarmPostingLine: Record "CG X173 Posting Line" temporary;
        WarmPostedPurchase: Record "CG X173 Posted Purchase" temporary;
        PostingLine: Record "CG X173 Posting Line" temporary;
        PostedPurchase: Record "CG X173 Posted Purchase" temporary;
        Any: Codeunit Any;
        StmtBefore: BigInteger;
        StmtAfter: BigInteger;
        StmtDelta: BigInteger;
        NSeed: Integer;
        ItemCount: Integer;
        RequisitionNo: Code[20];
        VendorNo: Code[20];
        ItemNo: Code[20];
        i: Integer;
    begin
        // [SCENARIO] Posting a large run costs no more than posting a small
        // one, even though every line names its own distinct requisition and
        // its own distinct vendor
        ClearAll();

        // Warm-up on a DIFFERENT, disjoint run, cleared before the graded
        // data is seeded, so nothing the measured call needs was resolved
        // beforehand.
        SeedRequisition('REQ-WARM-A', 'Warmup line', 1, Enum::"CG X156 Requisition Status"::Released);
        SeedItem('ITM-WARM-A', 'Warmup Item', 1, 1000);
        SeedVendor('VEND-WARM-A', 'Warmup Vendor', 'WARM-TA');
        SeedTerms('WARM-TA', 0);
        SeedPostingLine(WarmPostingLine, 'REQ-WARM-A', 'VEND-WARM-A', 'ITM-WARM-A', 1);
        Poster.PostPurchaseRun(WarmPostingLine, WarmPostedPurchase);
        ClearAll();

        Any.SetSeed(173);
        NSeed := Any.IntegerInRange(680, 720);
        ItemCount := 6;

        // A handful of items shared across every line - the item-
        // availability check itself is not the dimension under test here.
        for i := 1 to ItemCount do begin
            ItemNo := CopyStr(StrSubstNo('ITM-PA%1', i), 1, MaxStrLen(ItemNo));
            SeedItem(ItemNo, CopyStr(StrSubstNo('Perf Item %1', i), 1, 100), 1, 1000000);
        end;
        SeedTerms('TERMS-PA', 2);

        // Every line names its own distinct requisition and its own
        // distinct vendor - a large, one-off run sourced from many
        // different suppliers - so neither lookup can be answered from a
        // handful of already-seen rows.
        for i := 1 to NSeed do begin
            RequisitionNo := CopyStr(StrSubstNo('REQ-PA%1', i), 1, MaxStrLen(RequisitionNo));
            VendorNo := CopyStr(StrSubstNo('VEND-PA%1', i), 1, MaxStrLen(VendorNo));
            ItemNo := CopyStr(StrSubstNo('ITM-PA%1', (i mod ItemCount) + 1), 1, MaxStrLen(ItemNo));
            SeedRequisition(RequisitionNo, CopyStr(StrSubstNo('Perf Line %1', i), 1, 100), 10, Enum::"CG X156 Requisition Status"::Released);
            SeedVendor(VendorNo, CopyStr(StrSubstNo('Perf Vendor %1', i), 1, 100), 'TERMS-PA');
            SeedPostingLine(PostingLine, RequisitionNo, VendorNo, ItemNo, 100);
        end;

        FlushDataCache();
        StmtBefore := SessionInformation.SqlStatementsExecuted;
        Poster.PostPurchaseRun(PostingLine, PostedPurchase);
        StmtAfter := SessionInformation.SqlStatementsExecuted;
        StmtDelta := StmtAfter - StmtBefore;

        // Correctness inside the measured window, so a cheap-but-wrong
        // rewrite cannot pass on cost alone.
        Assert.AreEqual(NSeed, PostedPurchase.Count(),
            'Expected every released, unblocked, fulfillable line to post before judging cost');
        AssertPosted(PostedPurchase, 'REQ-PA1', 'VEND-PA1', 'Perf Vendor 1', 10, 100, 2, 10 * 100 * (1 - 2 / 100),
            'The run''s first line');
        AssertPosted(PostedPurchase, CopyStr(StrSubstNo('REQ-PA%1', NSeed), 1, MaxStrLen(RequisitionNo)),
            CopyStr(StrSubstNo('VEND-PA%1', NSeed), 1, MaxStrLen(VendorNo)),
            CopyStr(StrSubstNo('Perf Vendor %1', NSeed), 1, 100), 10, 100, 2, 10 * 100 * (1 - 2 / 100),
            'The run''s last line');

        Assert.IsTrue(StmtDelta <= MaxStatements(),
            StrSubstNo('Posting a run must not get slower as its line count grows: allowed %1, actual %2 for %3 lines', MaxStatements(), StmtDelta, NSeed));
    end;

    [Test]
    procedure PostingAnEvenLargerRunWithFewerDistinctVendorsStaysJustAsFlat()
    var
        Poster: Codeunit "CG X173 Purchase Poster";
        WarmPostingLine: Record "CG X173 Posting Line" temporary;
        WarmPostedPurchase: Record "CG X173 Posted Purchase" temporary;
        PostingLine: Record "CG X173 Posting Line" temporary;
        PostedPurchase: Record "CG X173 Posted Purchase" temporary;
        Any: Codeunit Any;
        StmtBefore: BigInteger;
        StmtAfter: BigInteger;
        StmtDelta: BigInteger;
        NSeed: Integer;
        ItemCount: Integer;
        VendorCount: Integer;
        LastVendorIndex: Integer;
        RequisitionNo: Code[20];
        VendorNo: Code[20];
        ItemNo: Code[20];
        VendorIndex: Integer;
        i: Integer;
    begin
        // [SCENARIO] An even larger run, this time with several lines
        // sharing each vendor rather than every vendor being unique, costs
        // no more than the smaller run above - the flatness does not depend
        // on how the vendors happen to be mixed across lines
        ClearAll();

        SeedRequisition('REQ-WARM-B', 'Warmup line', 1, Enum::"CG X156 Requisition Status"::Released);
        SeedItem('ITM-WARM-B', 'Warmup Item', 1, 1000);
        SeedVendor('VEND-WARM-B', 'Warmup Vendor', 'WARM-TB');
        SeedTerms('WARM-TB', 0);
        SeedPostingLine(WarmPostingLine, 'REQ-WARM-B', 'VEND-WARM-B', 'ITM-WARM-B', 1);
        Poster.PostPurchaseRun(WarmPostingLine, WarmPostedPurchase);
        ClearAll();

        Any.SetSeed(174);
        NSeed := Any.IntegerInRange(1380, 1420);
        ItemCount := 6;
        VendorCount := NSeed div 5;

        for i := 1 to ItemCount do begin
            ItemNo := CopyStr(StrSubstNo('ITM-PB%1', i), 1, MaxStrLen(ItemNo));
            SeedItem(ItemNo, CopyStr(StrSubstNo('Perf Item %1', i), 1, 100), 1, 1000000);
        end;
        SeedTerms('TERMS-PB', 3);
        for i := 1 to VendorCount do begin
            VendorNo := CopyStr(StrSubstNo('VEND-PB%1', i), 1, MaxStrLen(VendorNo));
            SeedVendor(VendorNo, CopyStr(StrSubstNo('Perf Vendor %1', i), 1, 100), 'TERMS-PB');
        end;

        for i := 1 to NSeed do begin
            RequisitionNo := CopyStr(StrSubstNo('REQ-PB%1', i), 1, MaxStrLen(RequisitionNo));
            VendorIndex := ((i - 1) mod VendorCount) + 1;
            VendorNo := CopyStr(StrSubstNo('VEND-PB%1', VendorIndex), 1, MaxStrLen(VendorNo));
            ItemNo := CopyStr(StrSubstNo('ITM-PB%1', (i mod ItemCount) + 1), 1, MaxStrLen(ItemNo));
            SeedRequisition(RequisitionNo, CopyStr(StrSubstNo('Perf Line %1', i), 1, 100), 10, Enum::"CG X156 Requisition Status"::Released);
            SeedPostingLine(PostingLine, RequisitionNo, VendorNo, ItemNo, 100);
        end;

        FlushDataCache();
        StmtBefore := SessionInformation.SqlStatementsExecuted;
        Poster.PostPurchaseRun(PostingLine, PostedPurchase);
        StmtAfter := SessionInformation.SqlStatementsExecuted;
        StmtDelta := StmtAfter - StmtBefore;

        Assert.AreEqual(NSeed, PostedPurchase.Count(),
            'Expected every released, unblocked, fulfillable line to post before judging cost');
        AssertPosted(PostedPurchase, 'REQ-PB1', 'VEND-PB1', 'Perf Vendor 1', 10, 100, 3, 10 * 100 * (1 - 3 / 100),
            'The run''s first line');

        LastVendorIndex := ((NSeed - 1) mod VendorCount) + 1;
        AssertPosted(PostedPurchase, CopyStr(StrSubstNo('REQ-PB%1', NSeed), 1, MaxStrLen(RequisitionNo)),
            CopyStr(StrSubstNo('VEND-PB%1', LastVendorIndex), 1, MaxStrLen(VendorNo)),
            CopyStr(StrSubstNo('Perf Vendor %1', LastVendorIndex), 1, 100), 10, 100, 3, 10 * 100 * (1 - 3 / 100),
            'The run''s last line');

        Assert.IsTrue(StmtDelta <= MaxStatements(),
            StrSubstNo('Posting a run must not get slower as its line count grows, regardless of how vendors are mixed across lines: allowed %1, actual %2 for %3 lines', MaxStatements(), StmtDelta, NSeed));
    end;
}
