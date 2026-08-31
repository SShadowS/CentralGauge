codeunit 89486 "CG-AL-X264 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;
    EventSubscriberInstance = Manual;

    // This oracle merges 6 independent modules' test suites into one
    // codeunit. Every test and helper procedure is prefixed with the module
    // it belongs to so identical helper names across the source suites cannot
    // collide. Assembled from already-gated donors; see NOTES.md.

    var
        Assert: Codeunit Assert;
        // The default test isolation persists writes between test methods
        // (measured 2026-08-20, SOAP runner), so every test clears both tables
        // before seeding its own rows.
        // The default test isolation persists writes between test methods, so
        // every test clears both tables before seeding its own rows. Rows that
        // belong to a different document than the one under test are seeded
        // with a nonzero count/value so "untouched" and "coincidentally zero"
        // stay distinguishable.
        // every test clears the table before seeding its own rows.
        // Companies are enumerated at runtime, never hardcoded, and every test
        // that touches the other company deletes what it seeded there BEFORE
        // asserting anything, then Commit()s that delete - so the cleanup is
        // durable even if a later assertion in the same test fails and raises
        // an error (an error only rolls back the CURRENT, still-open
        // transaction; a prior Commit() cannot be undone by it). A defensive
        // clear also runs at the START of every cross-company test in case a
        // still-earlier run was aborted before it could self-heal.

    // ==========================================================
    // X066 - donor CG-AL-X066
    // ==========================================================

    local procedure X066_ClearAllData()
    var
        LedgerEntry: Record "CG X066 Ledger Entry";
        ShipmentCost: Record "CG X066 Shipment Cost";
    begin
        LedgerEntry.DeleteAll();
        ShipmentCost.DeleteAll();
    end;

    // "Entry No." is an AutoIncrement key, so entries are seeded with it
    // left at zero and the platform-assigned value is read back and
    // returned - the returned number is what later ties a shipment back to
    // its recorded "CG X066 Shipment Cost" row.
    local procedure X066_SeedEntry(ItemNo: Code[20]; Qty: Decimal; UnitCost: Decimal): Integer
    var
        LedgerEntry: Record "CG X066 Ledger Entry";
    begin
        LedgerEntry.Init();
        LedgerEntry."Item No." := ItemNo;
        LedgerEntry."Posting Date" := WorkDate();
        LedgerEntry.Quantity := Qty;
        LedgerEntry."Unit Cost" := UnitCost;
        LedgerEntry.Insert(true);
        exit(LedgerEntry."Entry No.");
    end;

    local procedure X066_ShipmentCostOf(LedgerEntryNo: Integer): Decimal
    var
        ShipmentCost: Record "CG X066 Shipment Cost";
    begin
        ShipmentCost.Get(LedgerEntryNo);
        exit(ShipmentCost."Shipment Cost");
    end;

    local procedure X066_ShipmentCostRowCount(ItemNo: Code[20]): Integer
    var
        ShipmentCost: Record "CG X066 Shipment Cost";
    begin
        ShipmentCost.SetRange("Item No.", ItemNo);
        exit(ShipmentCost.Count());
    end;

    [Test]
    procedure X066_ShipmentDrawnFromTwoReceiptsCostsTheExactCombinedTotal()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        ShipmentNo: Integer;
    begin
        X066_ClearAllData();
        X066_SeedEntry('ROUND1', 2, 0.557);
        X066_SeedEntry('ROUND1', 5, 0.52);
        ShipmentNo := X066_SeedEntry('ROUND1', -3.7, 0);

        Engine.CalculateShipmentCosts('ROUND1');

        Assert.AreEqual(2.00, X066_ShipmentCostOf(ShipmentNo),
          'Expected the recorded cost of a shipment drawn from two receipts to equal the exact combined cost of the units taken, to the cent');
    end;

    [Test]
    procedure X066_ShipmentDrawnFromThreeReceiptsCostsTheExactCombinedTotal()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        ShipmentNo: Integer;
    begin
        X066_ClearAllData();
        X066_SeedEntry('ROUND2', 1, 0.503);
        X066_SeedEntry('ROUND2', 1, 0.503);
        X066_SeedEntry('ROUND2', 1, 0.503);
        ShipmentNo := X066_SeedEntry('ROUND2', -3, 0);

        Engine.CalculateShipmentCosts('ROUND2');

        Assert.AreEqual(1.51, X066_ShipmentCostOf(ShipmentNo),
          'Expected the recorded cost of a shipment drawn from three receipts to equal the exact combined cost of the units taken, to the cent');
    end;

    [Test]
    procedure X066_ShipmentDrawnFromTwoFinelyPricedReceiptsCostsTheExactCombinedTotal()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        ShipmentNo: Integer;
    begin
        X066_ClearAllData();
        X066_SeedEntry('ROUND5', 1, 0.48618);
        X066_SeedEntry('ROUND5', 1, 0.90878);
        ShipmentNo := X066_SeedEntry('ROUND5', -2, 0);

        Engine.CalculateShipmentCosts('ROUND5');

        Assert.AreEqual(1.39, X066_ShipmentCostOf(ShipmentNo),
          'Expected the recorded cost of a shipment drawn from two finely priced receipts to equal the exact combined cost of the units taken, to the cent');
    end;

    [Test]
    procedure X066_ShipmentFromASingleReceiptCostsExactlyQuantityTimesUnitCost()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        ShipmentNo: Integer;
    begin
        X066_ClearAllData();
        X066_SeedEntry('ROUND3', 10, 2.50);
        ShipmentNo := X066_SeedEntry('ROUND3', -4, 0);

        Engine.CalculateShipmentCosts('ROUND3');

        Assert.AreEqual(10.00, X066_ShipmentCostOf(ShipmentNo),
          'Expected a shipment drawn entirely from one receipt to cost exactly the quantity taken times that receipt unit cost');
    end;

    [Test]
    procedure X066_ShipmentCostOnAnExactHalfCentRoundsAwayFromZero()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        ShipmentNo: Integer;
    begin
        X066_ClearAllData();
        X066_SeedEntry('ROUND4', 5, 1.005);
        ShipmentNo := X066_SeedEntry('ROUND4', -5, 0);

        Engine.CalculateShipmentCosts('ROUND4');

        Assert.AreEqual(5.03, X066_ShipmentCostOf(ShipmentNo),
          'Expected an exact cost of 5.025 to be recorded as 5.03, away from zero, not 5.02');
    end;

    [Test]
    procedure X066_PartiallyConsumedReceiptCarriesItsRemainderToTheNextShipment()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        FirstShipmentNo: Integer;
        SecondShipmentNo: Integer;
    begin
        X066_ClearAllData();
        X066_SeedEntry('CARRY1', 10, 3.00);
        X066_SeedEntry('CARRY1', 10, 4.00);
        FirstShipmentNo := X066_SeedEntry('CARRY1', -4, 0);
        SecondShipmentNo := X066_SeedEntry('CARRY1', -9, 0);

        Engine.CalculateShipmentCosts('CARRY1');

        Assert.AreEqual(12.00, X066_ShipmentCostOf(FirstShipmentNo),
          'Expected the first shipment to cost only what it drew from the oldest receipt');
        Assert.AreEqual(30.00, X066_ShipmentCostOf(SecondShipmentNo),
          'Expected the second shipment to draw the remainder of the oldest receipt before drawing from the next receipt');
    end;

    [Test]
    procedure X066_ReceiptPostedAfterAShipmentJoinsTheBackOfTheQueue()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        FirstShipmentNo: Integer;
        SecondShipmentNo: Integer;
    begin
        X066_ClearAllData();
        X066_SeedEntry('QUEUE1', 4, 1.00);
        FirstShipmentNo := X066_SeedEntry('QUEUE1', -3, 0);
        X066_SeedEntry('QUEUE1', 4, 10.00);
        SecondShipmentNo := X066_SeedEntry('QUEUE1', -4, 0);

        Engine.CalculateShipmentCosts('QUEUE1');

        Assert.AreEqual(3.00, X066_ShipmentCostOf(FirstShipmentNo),
          'Expected the first shipment to cost only what it drew from the only receipt on hand at that point');
        Assert.AreEqual(31.00, X066_ShipmentCostOf(SecondShipmentNo),
          'Expected the second shipment to draw the last unit of the original receipt plus units from the receipt posted afterward');
    end;

    [Test]
    procedure X066_ShippingMoreThanIsOnHandRaisesAnError()
    var
        Engine: Codeunit "CG X066 Costing Engine";
    begin
        X066_ClearAllData();
        X066_SeedEntry('ERR1', 5, 1.00);
        X066_SeedEntry('ERR1', -3, 0);
        X066_SeedEntry('ERR1', -3, 0);

        asserterror Engine.CalculateShipmentCosts('ERR1');

        Assert.ExpectedError('Insufficient inventory');
    end;

    [Test]
    procedure X066_ShippingMoreThanHasArrivedSoFarFailsEvenWhenMoreArrivesLaterInTheSameRun()
    var
        Engine: Codeunit "CG X066 Costing Engine";
    begin
        X066_ClearAllData();
        X066_SeedEntry('ERR2', 4, 1.00);
        X066_SeedEntry('ERR2', -6, 0);
        X066_SeedEntry('ERR2', 10, 1.00);

        asserterror Engine.CalculateShipmentCosts('ERR2');

        Assert.ExpectedError('Insufficient inventory');
    end;

    [Test]
    procedure X066_RecomputingOneItemLeavesAnotherItemsRecordedCostUntouched()
    var
        ShipmentCost: Record "CG X066 Shipment Cost";
        Engine: Codeunit "CG X066 Costing Engine";
        ShipmentNo: Integer;
        OtherItemLedgerEntryNo: Integer;
    begin
        X066_ClearAllData();

        // A previously recorded cost for an unrelated item, seeded with a
        // nonzero value so an accidental wipe is distinguishable from an
        // untouched row.
        OtherItemLedgerEntryNo := 999001;
        ShipmentCost.Init();
        ShipmentCost."Ledger Entry No." := OtherItemLedgerEntryNo;
        ShipmentCost."Item No." := 'ISO-B';
        ShipmentCost."Posting Date" := WorkDate();
        ShipmentCost."Shipment Cost" := 777.77;
        ShipmentCost.Insert();

        X066_SeedEntry('ISO-A', 6, 2.00);
        ShipmentNo := X066_SeedEntry('ISO-A', -6, 0);

        Engine.CalculateShipmentCosts('ISO-A');
        Engine.CalculateShipmentCosts('ISO-A');

        Assert.AreEqual(12.00, X066_ShipmentCostOf(ShipmentNo),
          'Expected the recomputed cost to reflect the current receipts');
        Assert.AreEqual(1, X066_ShipmentCostRowCount('ISO-A'),
          'Expected exactly one recorded cost for the one shipment, even after recomputing the item twice');
        Assert.AreEqual(777.77, X066_ShipmentCostOf(OtherItemLedgerEntryNo),
          'Expected a recorded cost for a different item to be unaffected by recomputing this item');
    end;

    [Test]
    procedure X066_RecomputingOneItemNeverProcessesAnotherItemsLedgerEntries()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        ShipmentNo: Integer;
    begin
        X066_ClearAllData();
        X066_SeedEntry('MULTI-A', 5, 1.00);
        ShipmentNo := X066_SeedEntry('MULTI-A', -5, 0);
        X066_SeedEntry('MULTI-B', 3, 2.00);
        X066_SeedEntry('MULTI-B', -3, 0);

        Engine.CalculateShipmentCosts('MULTI-A');

        Assert.AreEqual(5.00, X066_ShipmentCostOf(ShipmentNo),
          'Expected the requested item''s shipment to cost exactly its own drawn quantity times unit cost');
        Assert.AreEqual(0, X066_ShipmentCostRowCount('MULTI-B'),
          'Expected recomputing one item to never write a recorded cost row for a different item''s ledger entries');
    end;

    [Test]
    procedure X066_ZeroQuantityEntryStillRecordsAZeroCostShipmentRow()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        ShipmentNo: Integer;
    begin
        X066_ClearAllData();
        ShipmentNo := X066_SeedEntry('ZERO1', 0, 5.00);

        Engine.CalculateShipmentCosts('ZERO1');

        Assert.AreEqual(0.00, X066_ShipmentCostOf(ShipmentNo),
          'Expected a zero-quantity entry to still be recorded as a shipment with zero cost, not skipped entirely');
    end;

    [Test]
    procedure X066_InsufficientInventoryErrorReportsNeededBeforeOnHand()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        ErrorText: Text;
        NeededPos: Integer;
        OnHandPos: Integer;
    begin
        X066_ClearAllData();
        X066_SeedEntry('ERRSWAP', 2, 1.00);
        X066_SeedEntry('ERRSWAP', -5, 0);

        asserterror Engine.CalculateShipmentCosts('ERRSWAP');
        ErrorText := GetLastErrorText();

        NeededPos := StrPos(ErrorText, '5');
        OnHandPos := StrPos(ErrorText, '2');
        Assert.IsTrue(NeededPos > 0, 'Expected the error to mention the quantity actually needed');
        Assert.IsTrue(OnHandPos > 0, 'Expected the error to mention the quantity actually on hand');
        Assert.IsTrue(NeededPos < OnHandPos, 'Expected the error to report the quantity needed before the quantity on hand');
    end;

    [Test]
    procedure X066_ShipmentNeverDrawsOnAnotherItemsReceipts()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        ShipmentNo: Integer;
    begin
        // [SCENARIO] Another item holds a far more expensive receipt that sorts
        // ahead of this item's own. The shipment must be costed from this
        // item's stock, so the foreign layer must never be drawn on - and the
        // only way to see that is to make the foreign layer the one an
        // unfiltered walk would reach first.
        X066_ClearAllData();
        X066_SeedEntry('DRAW-A', 5, 100.00);
        X066_SeedEntry('DRAW-B', 5, 1.00);
        ShipmentNo := X066_SeedEntry('DRAW-B', -5, 0);

        Engine.CalculateShipmentCosts('DRAW-B');

        Assert.AreEqual(5.00, X066_ShipmentCostOf(ShipmentNo),
          'Expected the shipment to cost what the item''s own receipts cost, never another item''s stock that happened to sort earlier');
        Assert.AreEqual(0, X066_ShipmentCostRowCount('DRAW-A'),
          'Expected recomputing one item to leave the other item with no recorded cost row at all');
    end;

    // ==========================================================
    // X067 - donor CG-AL-X067
    // ==========================================================

    local procedure X067_Activate(var Promotion: Codeunit "CG X067 Free Freight Promotion")
    var
        Bound: Boolean;
    begin
        Bound := BindSubscription(Promotion);
    end;

    local procedure X067_Deactivate(var Promotion: Codeunit "CG X067 Free Freight Promotion")
    var
        Unbound: Boolean;
    begin
        Unbound := UnbindSubscription(Promotion);
    end;

    local procedure X067_ActivateFreightOverride(var Override: Codeunit "CG-AL-X264 Test")
    var
        Bound: Boolean;
    begin
        Bound := BindSubscription(Override);
    end;

    local procedure X067_DeactivateFreightOverride(var Override: Codeunit "CG-AL-X264 Test")
    var
        Unbound: Boolean;
    begin
        Unbound := UnbindSubscription(Override);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CG X067 Freight Calculator", 'OnBeforeCalculateFreight', '', false, false)]
    local procedure X067_ApplyAFlatFreightOverride(Amount: Decimal; var Freight: Decimal; var IsHandled: Boolean)
    begin
        Freight := 42.5;
        IsHandled := true;
    end;

    [Test]
    procedure X067_DefaultFreightAppliesForOrdersUnderTheThreshold()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
        Any: Codeunit Any;
        Amount: Decimal;
    begin
        // [SCENARIO] Nothing has activated the promotion, and the order is small
        Amount := Any.DecimalInRange(100, 900, 2);

        Assert.AreEqual(Round(Amount * 0.1, 0.01), Calculator.CalculateFreight(Amount),
            StrSubstNo('Expected the standard charge for an order of %1 with the promotion not activated', Amount));
    end;

    [Test]
    procedure X067_DefaultFreightAppliesJustBelowTheThresholdWhenNotActivated()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
    begin
        // [SCENARIO] One cent below the threshold, still not activated
        Assert.AreEqual(100.00, Calculator.CalculateFreight(999.99),
            'Expected the standard charge for 999.99 with the promotion not activated - the threshold is 1000, one cent below it must not qualify');
    end;

    [Test]
    procedure X067_LargeOrdersPayDefaultFreightWhenThePromotionHasNotBeenActivated()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
        Any: Codeunit Any;
        Amount: Decimal;
    begin
        // [SCENARIO] A large order, but nothing has activated the promotion for this call
        Amount := Any.DecimalInRange(1001, 5000, 2);

        Assert.AreEqual(Round(Amount * 0.1, 0.01), Calculator.CalculateFreight(Amount),
            StrSubstNo('Expected the standard charge for a large order of %1 while the promotion has NOT been activated for this call', Amount));
    end;

    [Test]
    procedure X067_LargeOrdersPayDefaultFreightAtExactlyTheThresholdWhenNotActivated()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
    begin
        // [SCENARIO] Exactly at the threshold, still not activated
        Assert.AreEqual(100.00, Calculator.CalculateFreight(1000),
            'Expected the standard charge for an order of exactly 1000 while the promotion has NOT been activated for this call');
    end;

    [Test]
    procedure X067_ActivatedPromotionGrantsFreeFreightFromTheThresholdUpward()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
        Promotion: Codeunit "CG X067 Free Freight Promotion";
        Any: Codeunit Any;
        Amount: Decimal;
    begin
        // [SCENARIO] The caller has explicitly activated the promotion for this call
        X067_Activate(Promotion);

        Assert.AreEqual(0, Calculator.CalculateFreight(1000),
            'Expected free freight for an order of exactly 1000 while the promotion is activated for this call');

        Amount := Any.DecimalInRange(1001, 5000, 2);
        Assert.AreEqual(0, Calculator.CalculateFreight(Amount),
            StrSubstNo('Expected free freight for an order of %1 while the promotion is activated for this call', Amount));

        X067_Deactivate(Promotion);
    end;

    [Test]
    procedure X067_ActivatedPromotionLeavesOrdersBelowTheThresholdAtTheDefaultCharge()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
        Promotion: Codeunit "CG X067 Free Freight Promotion";
        Any: Codeunit Any;
        Amount: Decimal;
    begin
        // [SCENARIO] Activated, but the order does not reach the threshold
        X067_Activate(Promotion);
        Amount := Any.DecimalInRange(100, 900, 2);

        Assert.AreEqual(Round(Amount * 0.1, 0.01), Calculator.CalculateFreight(Amount),
            StrSubstNo('Expected the standard charge for an order of %1 - below the threshold, the activated promotion must still leave it alone', Amount));

        X067_Deactivate(Promotion);
    end;

    [Test]
    procedure X067_CalculatedFreightReflectsTheAmountAnActiveOverrideSets()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
        Override: Codeunit "CG-AL-X264 Test";
    begin
        // [SCENARIO] A subscriber other than the promotion has taken over this call and set its own charge
        X067_ActivateFreightOverride(Override);

        Assert.AreEqual(42.5, Calculator.CalculateFreight(1),
            'Expected the returned charge to reflect the amount an active override sets, not a fixed zero');

        X067_DeactivateFreightOverride(Override);
    end;

    // ==========================================================
    // X074 - donor CG-AL-X074
    // ==========================================================

    local procedure X074_SeedComment(ExpenseReportNo: Code[20]; LineNo: Integer; CommentText: Text[250])
    var
        CommentLine: Record "CG X074 Comment Line";
    begin
        CommentLine.Init();
        CommentLine."Expense Report No." := ExpenseReportNo;
        CommentLine."Line No." := LineNo;
        CommentLine."Comment Text" := CommentText;
        CommentLine.Insert();
    end;

    local procedure X074_SeedReport(No: Code[20]; InitialCommentCount: Integer)
    var
        ExpenseReport: Record "CG X074 Report";
    begin
        ExpenseReport.Init();
        ExpenseReport."No." := No;
        ExpenseReport."Total Comment Count" := InitialCommentCount;
        ExpenseReport.Insert();
    end;

    [Test]
    procedure X074_BrandNewReportShowsNoRelatedComments()
    var
        CommentLineRec: Record "CG X074 Comment Line";
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
        CommentCount: Integer;
    begin
        CommentLineRec.DeleteAll();

        // Orphaned comment lines left behind by other users' unsaved
        // reports elsewhere in the system - none of these belong to the
        // report being opened.
        X074_SeedComment('', 1, 'orphan one');
        X074_SeedComment('', 2, 'orphan two');
        X074_SeedComment('', 3, 'orphan three');

        // A real, saved report's own comments - also not the one being
        // opened, and must not be counted either.
        X074_SeedComment('R0001', 1, 'unrelated report comment');
        X074_SeedComment('R0001', 2, 'unrelated report comment');

        // A comments list opening for a brand-new, not-yet-saved report has
        // no report key yet.
        CommentLineRec.SetRange("Expense Report No.", '');
        CommentMgt.CountRelatedComments(CommentLineRec, CommentCount);

        Assert.AreEqual(0, CommentCount, 'A brand-new report has no comments of its own yet');
    end;

    [Test]
    procedure X074_SavedReportCountIncludesOnlyItsOwnComments()
    var
        CommentLineRec: Record "CG X074 Comment Line";
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
        CommentCount: Integer;
    begin
        CommentLineRec.DeleteAll();

        X074_SeedComment('R0002', 1, 'r0002 comment');
        X074_SeedComment('R0002', 2, 'r0002 comment');
        X074_SeedComment('R0003', 1, 'r0003 comment');
        X074_SeedComment('R0003', 2, 'r0003 comment');
        X074_SeedComment('R0003', 3, 'r0003 comment');
        X074_SeedComment('R0003', 4, 'r0003 comment');
        X074_SeedComment('', 1, 'orphan');

        // Positioned on one of the report's own lines - the way a saved
        // report's comments list actually lands once it opens, rather than
        // a range with nothing found yet.
        CommentLineRec.SetRange("Expense Report No.", 'R0002');
        CommentLineRec.FindFirst();
        CommentMgt.CountRelatedComments(CommentLineRec, CommentCount);

        Assert.AreEqual(2, CommentCount, 'A saved report only counts its own comments');
    end;

    [Test]
    procedure X074_PositionedRecordWithNoActiveRangeUsesItsOwnKey()
    var
        CommentLineRec: Record "CG X074 Comment Line";
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
        CommentCount: Integer;
    begin
        CommentLineRec.DeleteAll();

        X074_SeedComment('R0004', 1, 'r0004 comment');
        X074_SeedComment('R0004', 2, 'r0004 comment');
        X074_SeedComment('R0004', 3, 'r0004 comment');
        X074_SeedComment('R0004', 4, 'r0004 comment');
        X074_SeedComment('R0004', 5, 'r0004 comment');
        X074_SeedComment('R0005', 1, 'other report comment');

        // Positioned directly on one of the report's own lines, with no
        // range ever set on the field - the way a row looks once you've
        // simply looked it up, rather than searched for it.
        CommentLineRec.Get('R0004', 1);
        CommentMgt.CountRelatedComments(CommentLineRec, CommentCount);

        Assert.AreEqual(5, CommentCount, 'A positioned line must report its own report''s comment count');
    end;

    [Test]
    procedure X074_CommentsAreAppendedWithIncreasingLineNumbers()
    var
        CommentLine: Record "CG X074 Comment Line";
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
    begin
        CommentLine.DeleteAll();

        CommentMgt.AddComment('R0006', 'first note');
        CommentMgt.AddComment('R0006', 'second note');

        CommentLine.Get('R0006', 10000);
        Assert.AreEqual('first note', CommentLine."Comment Text", 'The first comment must be stored at the first line');

        CommentLine.Get('R0006', 20000);
        Assert.AreEqual('second note', CommentLine."Comment Text", 'The second comment must be stored at the next line');
    end;

    [Test]
    procedure X074_ReportSummaryReflectsOnlyItsOwnCommentsAndLeavesOthersAlone()
    var
        CommentLine: Record "CG X074 Comment Line";
        ExpenseReport: Record "CG X074 Report";
        OtherExpenseReport: Record "CG X074 Report";
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
    begin
        CommentLine.DeleteAll();
        ExpenseReport.DeleteAll();

        X074_SeedReport('R0007', 0);
        X074_SeedReport('R0008', 777);

        CommentMgt.AddComment('R0007', 'a');
        CommentMgt.AddComment('R0007', 'b');
        CommentMgt.AddComment('R0007', 'c');

        ExpenseReport.Get('R0007');
        CommentMgt.UpdateReportSummary(ExpenseReport);

        ExpenseReport.Get('R0007');
        Assert.AreEqual(3, ExpenseReport."Total Comment Count", 'The updated report must show its own current comment count');

        OtherExpenseReport.Get('R0008');
        Assert.AreEqual(777, OtherExpenseReport."Total Comment Count", 'A different report''s stored count must not change');
    end;

    [Test]
    procedure X074_UpdateReportSummaryExcludesAnUnrelatedReportsComments()
    var
        CommentLine: Record "CG X074 Comment Line";
        ExpenseReport: Record "CG X074 Report";
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
    begin
        CommentLine.DeleteAll();
        ExpenseReport.DeleteAll();

        X074_SeedReport('R0007', 0);
        CommentMgt.AddComment('R0007', 'a');
        CommentMgt.AddComment('R0007', 'b');

        X074_SeedComment('R0008', 1, 'unrelated');
        X074_SeedComment('R0008', 2, 'unrelated');
        X074_SeedComment('R0008', 3, 'unrelated');

        ExpenseReport.Get('R0007');
        CommentMgt.UpdateReportSummary(ExpenseReport);

        ExpenseReport.Get('R0007');
        Assert.AreEqual(2, ExpenseReport."Total Comment Count",
          'A report''s updated comment count must reflect only its own comments, not another report''s');
    end;

    [Test]
    procedure X074_LineNumberingDoesNotLeakAcrossReports()
    var
        CommentLine: Record "CG X074 Comment Line";
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
    begin
        CommentLine.DeleteAll();

        CommentMgt.AddComment('R9999', 'someone else''s first note');
        CommentMgt.AddComment('R0001', 'first note for a different report');

        CommentLine.Get('R0001', 10000);
        Assert.AreEqual('first note for a different report', CommentLine."Comment Text",
          'A report''s first comment must always start at its own first line, regardless of what other reports already contain');
    end;

    // ==========================================================
    // X076 - donor CG-AL-X076
    // ==========================================================

    local procedure X076_Reset()
    var
        LegacyAmount: Record "CG X076 Legacy Amount";
    begin
        LegacyAmount.DeleteAll();
    end;

    local procedure X076_EntryExists(EntryCode: Code[20]): Boolean
    var
        LegacyAmount: Record "CG X076 Legacy Amount";
    begin
        exit(LegacyAmount.Get(EntryCode));
    end;

    local procedure X076_AmountOf(EntryCode: Code[20]): Decimal
    var
        LegacyAmount: Record "CG X076 Legacy Amount";
    begin
        LegacyAmount.Get(EntryCode);
        exit(LegacyAmount.Amount);
    end;

    [Test]
    procedure X076_ParseAmountReturnsTheValueOfAValidAmountText()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        Any: Codeunit Any;
        Amount: Decimal;
    begin
        Amount := Any.DecimalInRange(1, 900, 2);

        Assert.AreEqual(Amount, Importer.ParseAmount(Format(Amount)),
            'Expected ParseAmount to return the decimal value of a well-formed amount text');
    end;

    [Test]
    procedure X076_ParseAmountAcceptsZero()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
    begin
        Assert.AreEqual(0.0, Importer.ParseAmount('0'),
            'Expected ParseAmount to accept zero - only negative amounts are invalid');
    end;

    [Test]
    procedure X076_ParseAmountErrorsOnTextThatIsNotANumber()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
    begin
        asserterror Importer.ParseAmount('X76-garbage');

        Assert.ExpectedError('''X76-garbage'' is not a valid amount');
    end;

    [Test]
    procedure X076_ParseAmountErrorsOnANegativeAmount()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        Any: Codeunit Any;
        NegativeText: Text;
    begin
        NegativeText := Format(-Any.DecimalInRange(1, 900, 2));

        asserterror Importer.ParseAmount(NegativeText);

        Assert.ExpectedError(StrSubstNo('''%1'' is not a valid amount', NegativeText));
    end;

    [Test]
    procedure X076_TryParseAmountReturnsTrueAndTheValueForAValidText()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        Any: Codeunit Any;
        Expected: Decimal;
        Amount: Decimal;
        FailureReason: Text;
    begin
        Expected := Any.DecimalInRange(1, 900, 2);

        Assert.IsTrue(Importer.TryParseAmount(Format(Expected), Amount, FailureReason),
            'Expected TryParseAmount to return true for a well-formed amount text');
        Assert.AreEqual(Expected, Amount, 'Expected TryParseAmount to put the parsed value into Amount');
        Assert.AreEqual('', FailureReason, 'Expected an empty FailureReason after a successful conversion');
    end;

    [Test]
    procedure X076_TryParseAmountReturnsFalseWithTheReasonInsteadOfFailing()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        Amount: Decimal;
        FailureReason: Text;
    begin
        // No asserterror: TryParseAmount must never raise, whatever the input.
        Assert.IsFalse(Importer.TryParseAmount('X76-not-a-number', Amount, FailureReason),
            'Expected TryParseAmount to return false for text that does not parse as an amount');
        Assert.IsTrue(FailureReason.Contains('''X76-not-a-number'' is not a valid amount'),
            StrSubstNo('Expected FailureReason to carry the conversion error text, got "%1"', FailureReason));
    end;

    [Test]
    procedure X076_TryParseAmountReportsTheLatestFailure()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        Amount: Decimal;
        FailureReason: Text;
    begin
        Importer.TryParseAmount('X76-first-bad', Amount, FailureReason);

        Importer.TryParseAmount('X76-second-bad', Amount, FailureReason);

        Assert.IsTrue(FailureReason.Contains('X76-second-bad'),
            StrSubstNo('Expected FailureReason to describe the latest failed input, got "%1"', FailureReason));
        Assert.IsFalse(FailureReason.Contains('X76-first-bad'),
            StrSubstNo('Expected FailureReason to no longer mention the earlier failed input, got "%1"', FailureReason));
    end;

    [Test]
    procedure X076_ImportLineLeavesNoRowBehindForANonNumericAmount()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
    begin
        X076_Reset();

        Assert.IsFalse(Importer.ImportLine('X76-BAD1', 'X76-not-a-number'),
            'Expected ImportLine to return false for text that does not parse as an amount');
        Assert.IsFalse(X076_EntryExists('X76-BAD1'), 'Expected no stored entry for an amount that failed to parse');
    end;

    [Test]
    procedure X076_ImportLineLeavesNoRowBehindForANegativeAmount()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        Any: Codeunit Any;
    begin
        X076_Reset();

        Assert.IsFalse(Importer.ImportLine('X76-BAD2', Format(-Any.DecimalInRange(1, 900, 2))),
            'Expected ImportLine to return false for a negative amount');
        Assert.IsFalse(X076_EntryExists('X76-BAD2'), 'Expected no stored entry for a rejected negative amount');
    end;

    [Test]
    procedure X076_ImportLineImportsAWellFormedAmount()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
        Any: Codeunit Any;
        Amount: Decimal;
    begin
        X076_Reset();
        Amount := Any.DecimalInRange(1, 900, 2);

        Assert.IsTrue(Importer.ImportLine('X76-V1', Format(Amount)),
            'Expected a well-formed, non-negative amount to be reported as imported');
        Assert.IsTrue(X076_EntryExists('X76-V1'), 'Expected a stored entry for the imported line');
        Assert.AreEqual(Amount, X076_AmountOf('X76-V1'), 'Expected the stored entry to carry the parsed amount');
    end;

    [Test]
    procedure X076_ImportLineAcceptsZeroAsAWellFormedAmount()
    var
        Importer: Codeunit "CG X076 Legacy Importer";
    begin
        X076_Reset();

        Assert.IsTrue(Importer.ImportLine('X76-ZERO', '0'),
            'Expected a zero amount to be reported as imported, not rejected - zero is well-formed and non-negative');
        Assert.IsTrue(X076_EntryExists('X76-ZERO'), 'Expected a stored entry for the zero-amount line');
        Assert.AreEqual(0, X076_AmountOf('X76-ZERO'), 'Expected the stored entry to carry an amount of exactly zero');
    end;

    [Test]
    procedure X076_BatchSkipsEveryBadLineAndImportsNothing()
    var
        Job: Codeunit "CG X076 Import Job";
        Codes: List of [Code[20]];
        Texts: List of [Text];
        Any: Codeunit Any;
    begin
        X076_Reset();
        Codes.Add('X76-B1A');
        Texts.Add('X76-not-a-number');
        Codes.Add('X76-B1B');
        Texts.Add(Format(-Any.DecimalInRange(1, 900, 2)));

        Assert.AreEqual(0, Job.ImportBatch(Codes, Texts),
            'Expected a batch of only malformed or negative lines to import nothing');
        Assert.IsFalse(X076_EntryExists('X76-B1A'), 'Expected no stored entry for the malformed line');
        Assert.IsFalse(X076_EntryExists('X76-B1B'), 'Expected no stored entry for the negative line');
    end;

    [Test]
    procedure X076_BatchImportsEveryWellFormedLineAndCountsThem()
    var
        Job: Codeunit "CG X076 Import Job";
        Codes: List of [Code[20]];
        Texts: List of [Text];
        Any: Codeunit Any;
        Amount1: Decimal;
        Amount2: Decimal;
        Amount3: Decimal;
    begin
        X076_Reset();
        Amount1 := Any.DecimalInRange(1, 300, 2);
        Amount2 := Any.DecimalInRange(1, 300, 2);
        Amount3 := Any.DecimalInRange(1, 300, 2);
        Codes.Add('X76-B2A');
        Texts.Add(Format(Amount1));
        Codes.Add('X76-B2B');
        Texts.Add(Format(Amount2));
        Codes.Add('X76-B2C');
        Texts.Add(Format(Amount3));

        Assert.AreEqual(3, Job.ImportBatch(Codes, Texts),
            'Expected every well-formed line in the batch to be counted as imported');
        Assert.AreEqual(Amount1, X076_AmountOf('X76-B2A'), 'Expected the first line''s parsed amount to be stored');
        Assert.AreEqual(Amount2, X076_AmountOf('X76-B2B'), 'Expected the second line''s parsed amount to be stored');
        Assert.AreEqual(Amount3, X076_AmountOf('X76-B2C'), 'Expected the third line''s parsed amount to be stored');
    end;

    [Test]
    procedure X076_BatchCountsOnlyTheWellFormedLinesInAMixedBatch()
    var
        Job: Codeunit "CG X076 Import Job";
        Codes: List of [Code[20]];
        Texts: List of [Text];
        Any: Codeunit Any;
        GoodAmount: Decimal;
    begin
        X076_Reset();
        GoodAmount := Any.DecimalInRange(1, 300, 2);
        Codes.Add('X76-B3BAD');
        Texts.Add('X76-still-not-a-number');
        Codes.Add('X76-B3GOOD');
        Texts.Add(Format(GoodAmount));

        Assert.AreEqual(1, Job.ImportBatch(Codes, Texts),
            'Expected only the well-formed line to be counted as imported');
        Assert.IsFalse(X076_EntryExists('X76-B3BAD'), 'Expected no stored entry for the malformed line');
        Assert.IsTrue(X076_EntryExists('X76-B3GOOD'), 'Expected a stored entry for the well-formed line');
        Assert.AreEqual(GoodAmount, X076_AmountOf('X76-B3GOOD'), 'Expected the well-formed line''s parsed amount to be stored');
    end;

    // ==========================================================
    // X092 - donor CG-AL-X092
    // ==========================================================

    local procedure X092_AssertDecimalRoundTrips(Original: Decimal)
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Parsed: Decimal;
        WireText: Text;
    begin
        WireText := WireFormat.ToWireDecimal(Original);

        Assert.IsTrue(WireFormat.FromWireDecimal(WireText, Parsed),
            StrSubstNo('Expected the wire text produced for %1 to be accepted back in, but %2 was rejected', Original, WireText));
        Assert.AreEqual(Original, Parsed,
            StrSubstNo('Expected the round trip through %1 to reproduce the original amount %2', WireText, Original));
    end;

    local procedure X092_AssertDateRoundTrips(Original: Date)
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Parsed: Date;
        WireText: Text;
    begin
        WireText := WireFormat.ToWireDate(Original);

        Assert.IsTrue(WireFormat.FromWireDate(WireText, Parsed),
            StrSubstNo('Expected the wire text produced for %1 to be accepted back in, but %2 was rejected', Original, WireText));
        Assert.AreEqual(Original, Parsed,
            StrSubstNo('Expected the round trip through %1 to reproduce the original date %2', WireText, Original));
    end;

    [Test]
    procedure X092_ToWireDecimalRendersPlainDigitsWithDotSeparator()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('1234567.89', WireFormat.ToWireDecimal(1234567.89),
            'Expected the amount as plain digits with a dot before the fraction, with no separator a receiving server would read differently depending on its own regional settings');
    end;

    [Test]
    procedure X092_ToWireDecimalKeepsLeadingMinusForNegativeValues()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('-1234.5', WireFormat.ToWireDecimal(-1234.5),
            'Expected a leading minus with plain digits and a dot before the fraction, the same on every server');
    end;

    [Test]
    procedure X092_ToWireDecimalStaysPlainBelowTheFirstGroupingBoundary()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('999', WireFormat.ToWireDecimal(999),
            'Expected a whole amount under a thousand to render as plain digits');
    end;

    [Test]
    procedure X092_ToWireDecimalHasNoGroupSeparatorAtTheGroupingBoundary()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('1000', WireFormat.ToWireDecimal(1000),
            'Expected a whole amount at a thousand to still render as plain digits, with no separator marking the thousands');
    end;

    [Test]
    procedure X092_ToWireDateRendersYearMonthDay()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('2026-01-23', WireFormat.ToWireDate(DMY2Date(23, 1, 2026)),
            'Expected 23 January 2026 to render as 2026-01-23 on every server');
    end;

    [Test]
    procedure X092_ToWireDatePadsSingleDigitMonthAndDay()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('2026-02-03', WireFormat.ToWireDate(DMY2Date(3, 2, 2026)),
            'Expected zero-padded month and day: 3 February 2026 is 2026-02-03 on every server');
    end;

    [Test]
    procedure X092_FromWireDecimalParsesValidWireText()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Decimal;
    begin
        Assert.IsTrue(WireFormat.FromWireDecimal('1234.56', Value),
            'Expected the wire text 1234.56 to be accepted');
        Assert.AreEqual(1234.56, Value, 'Expected the wire text 1234.56 to parse to exactly that amount');
    end;

    [Test]
    procedure X092_FromWireDecimalParsesNegativeWireText()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Decimal;
    begin
        Assert.IsTrue(WireFormat.FromWireDecimal('-42.75', Value),
            'Expected the wire text -42.75 to be accepted');
        Assert.AreEqual(-42.75, Value, 'Expected the wire text -42.75 to parse to exactly that amount');
    end;

    [Test]
    procedure X092_FromWireDecimalRejectsCommaFormattedText()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Decimal;
        Accepted: Boolean;
    begin
        Accepted := WireFormat.FromWireDecimal('1,5', Value);

        Assert.IsFalse(Accepted,
            StrSubstNo('Expected 1,5 to be rejected as not wire text, but it was accepted and parsed as %1', Value));
    end;

    [Test]
    procedure X092_FromWireDecimalRejectsGarbageWithoutError()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Decimal;
    begin
        Assert.IsFalse(WireFormat.FromWireDecimal('twelve point five', Value),
            'Expected text that is no amount at all to be rejected, not raised as an error');
    end;

    [Test]
    procedure X092_FromWireDateParsesValidWireText()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Date;
    begin
        Assert.IsTrue(WireFormat.FromWireDate('2026-01-23', Value),
            'Expected the wire text 2026-01-23 to be accepted');
        Assert.AreEqual(DMY2Date(23, 1, 2026), Value, 'Expected the wire text 2026-01-23 to parse to 23 January 2026');
    end;

    [Test]
    procedure X092_FromWireDateRejectsLocaleFormattedText()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Date;
        Accepted: Boolean;
    begin
        Accepted := WireFormat.FromWireDate('05-02-2026', Value);

        Assert.IsFalse(Accepted,
            StrSubstNo('Expected 05-02-2026 to be rejected as not wire text, but it was accepted and parsed as %1', Value));
    end;

    [Test]
    procedure X092_FromWireDateRejectsGarbageWithoutError()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Date;
    begin
        Assert.IsFalse(WireFormat.FromWireDate('23rd of January 2026', Value),
            'Expected text that is no wire date at all to be rejected, not raised as an error');
    end;

    [Test]
    procedure X092_DecimalRoundTripSweepSurvivesThroughWireText()
    begin
        X092_AssertDecimalRoundTrips(1000);
        X092_AssertDecimalRoundTrips(12345.67);
        X092_AssertDecimalRoundTrips(-98765.43);
        X092_AssertDecimalRoundTrips(2000000);
        X092_AssertDecimalRoundTrips(-1500.25);
        X092_AssertDecimalRoundTrips(42.5);
    end;

    [Test]
    procedure X092_DateRoundTripSweepSurvivesThroughWireText()
    begin
        X092_AssertDateRoundTrips(DMY2Date(1, 1, 2026));
        X092_AssertDateRoundTrips(DMY2Date(31, 12, 2026));
        X092_AssertDateRoundTrips(DMY2Date(29, 2, 2028));
        X092_AssertDateRoundTrips(DMY2Date(15, 6, 2025));
    end;

    // ==========================================================
    // X128 - donor CG-AL-X128
    // ==========================================================

    local procedure X128_GetOtherCompanyName(): Text[30]
    var
        Company: Record Company;
        HereName: Text[30];
    begin
        HereName := CompanyName();
        Company.SetFilter(Name, '<>%1', HereName);
        if Company.FindFirst() then
            exit(Company.Name);
        Error('Expected at least one other company to exist on this container to verify cross-company isolation');
    end;

    local procedure X128_ClearHomeSetup()
    var
        Setup: Record "CG X128 Collection Setup";
    begin
        Setup.DeleteAll();
    end;

    local procedure X128_ClearOtherCompanySetup(OtherName: Text[30])
    var
        Setup: Record "CG X128 Collection Setup";
    begin
        Setup.ChangeCompany(OtherName);
        Setup.DeleteAll();
    end;

    local procedure X128_ClearHomeGroupRate()
    var
        GroupRate: Record "CG X128 Group Rate";
    begin
        GroupRate.DeleteAll();
    end;

    local procedure X128_ClearOtherCompanyGroupRate(OtherName: Text[30])
    var
        GroupRate: Record "CG X128 Group Rate";
    begin
        GroupRate.ChangeCompany(OtherName);
        GroupRate.DeleteAll();
    end;

    local procedure X128_SeedOtherCompanySetup(OtherName: Text[30]; Grace: Integer; Fee: Decimal)
    var
        Setup: Record "CG X128 Collection Setup";
        Found: Boolean;
    begin
        Setup.ChangeCompany(OtherName);
        Found := Setup.Get('SETUP');
        if not Found then begin
            Setup.Init();
            Setup."Primary Key" := 'SETUP';
        end;
        Setup."Grace Period Days" := Grace;
        Setup."Late Fee Percent" := Fee;
        if Found then
            Setup.Modify()
        else
            Setup.Insert();
    end;

    local procedure X128_ReadOtherCompanySetup(OtherName: Text[30]; var Found: Boolean; var Grace: Integer; var Fee: Decimal)
    var
        Setup: Record "CG X128 Collection Setup";
    begin
        Setup.ChangeCompany(OtherName);
        Found := Setup.Get('SETUP');
        if Found then begin
            Grace := Setup."Grace Period Days";
            Fee := Setup."Late Fee Percent";
        end;
    end;

    local procedure X128_ReadOtherCompanyGroupRate(OtherName: Text[30]; CurrencyCode: Code[10]; var Found: Boolean; var Rate: Decimal)
    var
        GroupRate: Record "CG X128 Group Rate";
    begin
        GroupRate.ChangeCompany(OtherName);
        Found := GroupRate.Get(CurrencyCode);
        if Found then
            Rate := GroupRate."Intercompany Rate";
    end;

    [Test]
    procedure X128_ChangingOneCompanysSettingsDoesNotOverwriteAnotherCompanysOwnSettings()
    var
        Policy: Codeunit "CG X128 Collection Policy";
        OtherName: Text[30];
        HomeGraceAfter: Integer;
        HomeFeeAfter: Decimal;
        OtherFoundAfter: Boolean;
        OtherGraceAfter: Integer;
        OtherFeeAfter: Decimal;
    begin
        OtherName := X128_GetOtherCompanyName();
        X128_ClearHomeSetup();
        X128_ClearOtherCompanySetup(OtherName);
        Commit();

        // The other company already configured its own settings.
        X128_SeedOtherCompanySetup(OtherName, 30, 2.5);

        // The home company independently configures its own settings.
        Policy.SetGracePeriodDays(45);
        Policy.SetLateFeePercent(9.9);

        HomeGraceAfter := Policy.GetGracePeriodDays();
        HomeFeeAfter := Policy.GetLateFeePercent();
        X128_ReadOtherCompanySetup(OtherName, OtherFoundAfter, OtherGraceAfter, OtherFeeAfter);

        // Clean up both companies before asserting anything, and commit that
        // cleanup, so this test never leaves data behind in the other
        // company regardless of whether the assertions below pass or fail.
        X128_ClearHomeSetup();
        X128_ClearOtherCompanySetup(OtherName);
        Commit();

        Assert.AreEqual(45, HomeGraceAfter,
            'Expected the home company grace period to reflect what was just configured for it');
        Assert.AreEqual(9.9, HomeFeeAfter,
            'Expected the home company late fee percentage to reflect what was just configured for it');
        Assert.IsTrue(OtherFoundAfter,
            'Expected the other company to still have its own collection settings');
        Assert.AreEqual(30, OtherGraceAfter,
            'Expected the other company grace period to remain the value it configured for itself, unaffected by the home company change');
        Assert.AreEqual(2.5, OtherFeeAfter,
            'Expected the other company late fee percentage to remain the value it configured for itself, unaffected by the home company change');
    end;

    [Test]
    procedure X128_AnotherCompanyConfiguringItsOwnSettingsDoesNotChangeTheHomeCompanysSettings()
    var
        Policy: Codeunit "CG X128 Collection Policy";
        OtherName: Text[30];
        HomeGraceAfter: Integer;
        HomeFeeAfter: Decimal;
        OtherFoundAfter: Boolean;
        OtherGraceAfter: Integer;
        OtherFeeAfter: Decimal;
    begin
        OtherName := X128_GetOtherCompanyName();
        X128_ClearHomeSetup();
        X128_ClearOtherCompanySetup(OtherName);
        Commit();

        // The home company configures its own settings first.
        Policy.SetGracePeriodDays(21);
        Policy.SetLateFeePercent(3.3);

        // A different company now configures its own, different settings.
        X128_SeedOtherCompanySetup(OtherName, 60, 6.6);

        HomeGraceAfter := Policy.GetGracePeriodDays();
        HomeFeeAfter := Policy.GetLateFeePercent();
        X128_ReadOtherCompanySetup(OtherName, OtherFoundAfter, OtherGraceAfter, OtherFeeAfter);

        X128_ClearHomeSetup();
        X128_ClearOtherCompanySetup(OtherName);
        Commit();

        Assert.AreEqual(21, HomeGraceAfter,
            'Expected the home company grace period to remain the value it configured for itself, unaffected by another company''s change');
        Assert.AreEqual(3.3, HomeFeeAfter,
            'Expected the home company late fee percentage to remain the value it configured for itself, unaffected by another company''s change');
        Assert.IsTrue(OtherFoundAfter,
            'Expected the other company to have its own collection settings');
        Assert.AreEqual(60, OtherGraceAfter,
            'Expected the other company grace period to reflect what it configured for itself');
        Assert.AreEqual(6.6, OtherFeeAfter,
            'Expected the other company late fee percentage to reflect what it configured for itself');
    end;

    [Test]
    procedure X128_TheIntercompanyRateIsVisibleAndIdenticalInEveryCompany()
    var
        Treasury: Codeunit "CG X128 Treasury Rate";
        OtherName: Text[30];
        HomeRateAfter: Decimal;
        OtherFoundAfter: Boolean;
        OtherRateAfter: Decimal;
    begin
        OtherName := X128_GetOtherCompanyName();
        X128_ClearHomeGroupRate();
        X128_ClearOtherCompanyGroupRate(OtherName);
        Commit();

        // The rate is set once, from the home company, and must be the
        // same rate every company sees - it is not each company's own.
        Treasury.SetIntercompanyRate('EUR', 1.0937);

        HomeRateAfter := Treasury.GetIntercompanyRate('EUR');
        X128_ReadOtherCompanyGroupRate(OtherName, 'EUR', OtherFoundAfter, OtherRateAfter);

        X128_ClearHomeGroupRate();
        X128_ClearOtherCompanyGroupRate(OtherName);
        Commit();

        Assert.AreEqual(1.0937, HomeRateAfter,
            'Expected the home company to see the intercompany rate that was just set');
        Assert.IsTrue(OtherFoundAfter,
            'Expected the other company to see the same intercompany rate record');
        Assert.AreEqual(1.0937, OtherRateAfter,
            'Expected the other company to see the exact same intercompany rate, since it is shared across every company by design');
    end;

    [Test]
    procedure X128_SettingTheRateForOneCurrencyDoesNotAffectAnother()
    var
        Treasury: Codeunit "CG X128 Treasury Rate";
    begin
        X128_ClearHomeGroupRate();

        Treasury.SetIntercompanyRate('EUR', 1.0937);
        Treasury.SetIntercompanyRate('USD', 1.0);

        Assert.AreEqual(1.0937, Treasury.GetIntercompanyRate('EUR'),
            'Expected the EUR rate to be unaffected by setting a different currency''s rate');
        Assert.AreEqual(1.0, Treasury.GetIntercompanyRate('USD'),
            'Expected the USD rate to reflect what was just set for it');
        Assert.AreEqual(0.0, Treasury.GetIntercompanyRate('GBP'),
            'Expected no intercompany rate for a currency that was never configured');

        X128_ClearHomeGroupRate();
    end;

    [Test]
    procedure X128_SettingAndReadingBackTheGracePeriodAndLateFeeInOneCompanyWorks()
    var
        Policy: Codeunit "CG X128 Collection Policy";
        Policy2: Codeunit "CG X128 Collection Policy";
        Setup: Record "CG X128 Collection Setup";
    begin
        X128_ClearHomeSetup();

        Policy.SetGracePeriodDays(50);
        Policy.SetLateFeePercent(4.25);

        Assert.AreEqual(50, Policy.GetGracePeriodDays(),
            'Expected the grace period to be exactly what was just configured');
        Assert.AreEqual(4.25, Policy.GetLateFeePercent(),
            'Expected the late fee percentage to be exactly what was just configured');
        Assert.AreEqual(50, Policy2.GetGracePeriodDays(),
            'Expected a separate part of the application to see the same grace period that was just configured, not a value private to whatever configured it');
        Setup.FindFirst();
        Assert.AreEqual(50, Setup."Grace Period Days",
            'Expected the configured grace period to be persisted on the collection settings record itself');
        Assert.AreEqual(4.25, Setup."Late Fee Percent",
            'Expected the configured late fee percentage to be persisted on the collection settings record itself');

        X128_ClearHomeSetup();
    end;

    [Test]
    procedure X128_TheSettingsDefaultWhenNothingHasBeenConfiguredYet()
    var
        Policy: Codeunit "CG X128 Collection Policy";
    begin
        X128_ClearHomeSetup();

        Assert.AreEqual(14, Policy.GetGracePeriodDays(),
            'Expected a default grace period before anything has been configured');
        Assert.AreEqual(1.5, Policy.GetLateFeePercent(),
            'Expected a default late fee percentage before anything has been configured');

        X128_ClearHomeSetup();
    end;

    [Test]
    procedure X128_IsOverdueRespectsTheGracePeriodBoundaryExactly()
    var
        Policy: Codeunit "CG X128 Collection Policy";
    begin
        X128_ClearHomeSetup();
        Policy.SetGracePeriodDays(14);

        Assert.IsFalse(Policy.IsOverdue(14),
            'Expected an invoice exactly at the grace period boundary to not yet be overdue');
        Assert.IsTrue(Policy.IsOverdue(15),
            'Expected an invoice one day past the grace period boundary to be overdue');

        X128_ClearHomeSetup();
    end;

    [Test]
    procedure X128_CalculateLateFeeAppliesThePercentageToTheAmount()
    var
        Policy: Codeunit "CG X128 Collection Policy";
    begin
        X128_ClearHomeSetup();
        Policy.SetLateFeePercent(5);

        Assert.AreEqual(10.0, Policy.CalculateLateFee(200),
            'Expected the late fee to be the configured percentage of the overdue amount');
        Assert.AreEqual(0.0, Policy.CalculateLateFee(0),
            'Expected no late fee on a zero overdue amount');

        Policy.SetLateFeePercent(2.5);
        Assert.AreEqual(5.0, Policy.CalculateLateFee(200),
            'Expected the late fee to scale with a different configured percentage on the same overdue amount');

        X128_ClearHomeSetup();
    end;
}
