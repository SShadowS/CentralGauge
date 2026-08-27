codeunit 88819 "CG-AL-X066 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every test clears both tables
    // before seeding its own rows.

    local procedure ClearAllData()
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
    local procedure SeedEntry(ItemNo: Code[20]; Qty: Decimal; UnitCost: Decimal): Integer
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

    local procedure ShipmentCostOf(LedgerEntryNo: Integer): Decimal
    var
        ShipmentCost: Record "CG X066 Shipment Cost";
    begin
        ShipmentCost.Get(LedgerEntryNo);
        exit(ShipmentCost."Shipment Cost");
    end;

    local procedure ShipmentCostRowCount(ItemNo: Code[20]): Integer
    var
        ShipmentCost: Record "CG X066 Shipment Cost";
    begin
        ShipmentCost.SetRange("Item No.", ItemNo);
        exit(ShipmentCost.Count());
    end;

    [Test]
    procedure ShipmentDrawnFromTwoReceiptsCostsTheExactCombinedTotal()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        ShipmentNo: Integer;
    begin
        ClearAllData();
        SeedEntry('ROUND1', 2, 0.557);
        SeedEntry('ROUND1', 5, 0.52);
        ShipmentNo := SeedEntry('ROUND1', -3.7, 0);

        Engine.CalculateShipmentCosts('ROUND1');

        Assert.AreEqual(2.00, ShipmentCostOf(ShipmentNo),
          'Expected the recorded cost of a shipment drawn from two receipts to equal the exact combined cost of the units taken, to the cent');
    end;

    [Test]
    procedure ShipmentDrawnFromThreeReceiptsCostsTheExactCombinedTotal()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        ShipmentNo: Integer;
    begin
        ClearAllData();
        SeedEntry('ROUND2', 1, 0.503);
        SeedEntry('ROUND2', 1, 0.503);
        SeedEntry('ROUND2', 1, 0.503);
        ShipmentNo := SeedEntry('ROUND2', -3, 0);

        Engine.CalculateShipmentCosts('ROUND2');

        Assert.AreEqual(1.51, ShipmentCostOf(ShipmentNo),
          'Expected the recorded cost of a shipment drawn from three receipts to equal the exact combined cost of the units taken, to the cent');
    end;

    [Test]
    procedure ShipmentDrawnFromTwoFinelyPricedReceiptsCostsTheExactCombinedTotal()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        ShipmentNo: Integer;
    begin
        ClearAllData();
        SeedEntry('ROUND5', 1, 0.48618);
        SeedEntry('ROUND5', 1, 0.90878);
        ShipmentNo := SeedEntry('ROUND5', -2, 0);

        Engine.CalculateShipmentCosts('ROUND5');

        Assert.AreEqual(1.39, ShipmentCostOf(ShipmentNo),
          'Expected the recorded cost of a shipment drawn from two finely priced receipts to equal the exact combined cost of the units taken, to the cent');
    end;

    [Test]
    procedure ShipmentFromASingleReceiptCostsExactlyQuantityTimesUnitCost()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        ShipmentNo: Integer;
    begin
        ClearAllData();
        SeedEntry('ROUND3', 10, 2.50);
        ShipmentNo := SeedEntry('ROUND3', -4, 0);

        Engine.CalculateShipmentCosts('ROUND3');

        Assert.AreEqual(10.00, ShipmentCostOf(ShipmentNo),
          'Expected a shipment drawn entirely from one receipt to cost exactly the quantity taken times that receipt unit cost');
    end;

    [Test]
    procedure ShipmentCostOnAnExactHalfCentRoundsAwayFromZero()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        ShipmentNo: Integer;
    begin
        ClearAllData();
        SeedEntry('ROUND4', 5, 1.005);
        ShipmentNo := SeedEntry('ROUND4', -5, 0);

        Engine.CalculateShipmentCosts('ROUND4');

        Assert.AreEqual(5.03, ShipmentCostOf(ShipmentNo),
          'Expected an exact cost of 5.025 to be recorded as 5.03, away from zero, not 5.02');
    end;

    [Test]
    procedure PartiallyConsumedReceiptCarriesItsRemainderToTheNextShipment()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        FirstShipmentNo: Integer;
        SecondShipmentNo: Integer;
    begin
        ClearAllData();
        SeedEntry('CARRY1', 10, 3.00);
        SeedEntry('CARRY1', 10, 4.00);
        FirstShipmentNo := SeedEntry('CARRY1', -4, 0);
        SecondShipmentNo := SeedEntry('CARRY1', -9, 0);

        Engine.CalculateShipmentCosts('CARRY1');

        Assert.AreEqual(12.00, ShipmentCostOf(FirstShipmentNo),
          'Expected the first shipment to cost only what it drew from the oldest receipt');
        Assert.AreEqual(30.00, ShipmentCostOf(SecondShipmentNo),
          'Expected the second shipment to draw the remainder of the oldest receipt before drawing from the next receipt');
    end;

    [Test]
    procedure ReceiptPostedAfterAShipmentJoinsTheBackOfTheQueue()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        FirstShipmentNo: Integer;
        SecondShipmentNo: Integer;
    begin
        ClearAllData();
        SeedEntry('QUEUE1', 4, 1.00);
        FirstShipmentNo := SeedEntry('QUEUE1', -3, 0);
        SeedEntry('QUEUE1', 4, 10.00);
        SecondShipmentNo := SeedEntry('QUEUE1', -4, 0);

        Engine.CalculateShipmentCosts('QUEUE1');

        Assert.AreEqual(3.00, ShipmentCostOf(FirstShipmentNo),
          'Expected the first shipment to cost only what it drew from the only receipt on hand at that point');
        Assert.AreEqual(31.00, ShipmentCostOf(SecondShipmentNo),
          'Expected the second shipment to draw the last unit of the original receipt plus units from the receipt posted afterward');
    end;

    [Test]
    procedure ShippingMoreThanIsOnHandRaisesAnError()
    var
        Engine: Codeunit "CG X066 Costing Engine";
    begin
        ClearAllData();
        SeedEntry('ERR1', 5, 1.00);
        SeedEntry('ERR1', -3, 0);
        SeedEntry('ERR1', -3, 0);

        asserterror Engine.CalculateShipmentCosts('ERR1');

        Assert.ExpectedError('Insufficient inventory');
    end;

    [Test]
    procedure ShippingMoreThanHasArrivedSoFarFailsEvenWhenMoreArrivesLaterInTheSameRun()
    var
        Engine: Codeunit "CG X066 Costing Engine";
    begin
        ClearAllData();
        SeedEntry('ERR2', 4, 1.00);
        SeedEntry('ERR2', -6, 0);
        SeedEntry('ERR2', 10, 1.00);

        asserterror Engine.CalculateShipmentCosts('ERR2');

        Assert.ExpectedError('Insufficient inventory');
    end;

    [Test]
    procedure RecomputingOneItemLeavesAnotherItemsRecordedCostUntouched()
    var
        ShipmentCost: Record "CG X066 Shipment Cost";
        Engine: Codeunit "CG X066 Costing Engine";
        ShipmentNo: Integer;
        OtherItemLedgerEntryNo: Integer;
    begin
        ClearAllData();

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

        SeedEntry('ISO-A', 6, 2.00);
        ShipmentNo := SeedEntry('ISO-A', -6, 0);

        Engine.CalculateShipmentCosts('ISO-A');
        Engine.CalculateShipmentCosts('ISO-A');

        Assert.AreEqual(12.00, ShipmentCostOf(ShipmentNo),
          'Expected the recomputed cost to reflect the current receipts');
        Assert.AreEqual(1, ShipmentCostRowCount('ISO-A'),
          'Expected exactly one recorded cost for the one shipment, even after recomputing the item twice');
        Assert.AreEqual(777.77, ShipmentCostOf(OtherItemLedgerEntryNo),
          'Expected a recorded cost for a different item to be unaffected by recomputing this item');
    end;

    [Test]
    procedure RecomputingOneItemNeverProcessesAnotherItemsLedgerEntries()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        ShipmentNo: Integer;
    begin
        ClearAllData();
        SeedEntry('MULTI-A', 5, 1.00);
        ShipmentNo := SeedEntry('MULTI-A', -5, 0);
        SeedEntry('MULTI-B', 3, 2.00);
        SeedEntry('MULTI-B', -3, 0);

        Engine.CalculateShipmentCosts('MULTI-A');

        Assert.AreEqual(5.00, ShipmentCostOf(ShipmentNo),
          'Expected the requested item''s shipment to cost exactly its own drawn quantity times unit cost');
        Assert.AreEqual(0, ShipmentCostRowCount('MULTI-B'),
          'Expected recomputing one item to never write a recorded cost row for a different item''s ledger entries');
    end;

    [Test]
    procedure ZeroQuantityEntryStillRecordsAZeroCostShipmentRow()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        ShipmentNo: Integer;
    begin
        ClearAllData();
        ShipmentNo := SeedEntry('ZERO1', 0, 5.00);

        Engine.CalculateShipmentCosts('ZERO1');

        Assert.AreEqual(0.00, ShipmentCostOf(ShipmentNo),
          'Expected a zero-quantity entry to still be recorded as a shipment with zero cost, not skipped entirely');
    end;

    [Test]
    procedure InsufficientInventoryErrorReportsNeededBeforeOnHand()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        ErrorText: Text;
        NeededPos: Integer;
        OnHandPos: Integer;
    begin
        ClearAllData();
        SeedEntry('ERRSWAP', 2, 1.00);
        SeedEntry('ERRSWAP', -5, 0);

        asserterror Engine.CalculateShipmentCosts('ERRSWAP');
        ErrorText := GetLastErrorText();

        NeededPos := StrPos(ErrorText, '5');
        OnHandPos := StrPos(ErrorText, '2');
        Assert.IsTrue(NeededPos > 0, 'Expected the error to mention the quantity actually needed');
        Assert.IsTrue(OnHandPos > 0, 'Expected the error to mention the quantity actually on hand');
        Assert.IsTrue(NeededPos < OnHandPos, 'Expected the error to report the quantity needed before the quantity on hand');
    end;

    [Test]
    procedure ShipmentNeverDrawsOnAnotherItemsReceipts()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        ShipmentNo: Integer;
    begin
        // [SCENARIO] Another item holds a far more expensive receipt that sorts
        // ahead of this item's own. The shipment must be costed from this
        // item's stock, so the foreign layer must never be drawn on - and the
        // only way to see that is to make the foreign layer the one an
        // unfiltered walk would reach first.
        ClearAllData();
        SeedEntry('DRAW-A', 5, 100.00);
        SeedEntry('DRAW-B', 5, 1.00);
        ShipmentNo := SeedEntry('DRAW-B', -5, 0);

        Engine.CalculateShipmentCosts('DRAW-B');

        Assert.AreEqual(5.00, ShipmentCostOf(ShipmentNo),
          'Expected the shipment to cost what the item''s own receipts cost, never another item''s stock that happened to sort earlier');
        Assert.AreEqual(0, ShipmentCostRowCount('DRAW-A'),
          'Expected recomputing one item to leave the other item with no recorded cost row at all');
    end;
}
