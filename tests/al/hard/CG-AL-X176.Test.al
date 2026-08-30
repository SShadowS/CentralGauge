codeunit 89396 "CG-AL-X176 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods, so
    // every test clears its own tables before seeding its own rows.
    local procedure ClearAllData()
    var
        X066LedgerEntry: Record "CG X066 Ledger Entry";
        X066ShipmentCost: Record "CG X066 Shipment Cost";
        X139AdjLine: Record "CG X139 Adjustment Line";
        X139LedgerEntry: Record "CG X139 Item Ledger Entry";
        X139Balance: Record "CG X139 Item Balance";
        Restatement: Record "CG X176 Restatement";
    begin
        X066LedgerEntry.DeleteAll();
        X066ShipmentCost.DeleteAll();
        X139AdjLine.DeleteAll();
        X139LedgerEntry.DeleteAll();
        X139Balance.DeleteAll();
        Restatement.DeleteAll();
    end;

    // ---------------------------------------------------------------------
    // X066 section - carried over unmodified in body from the source oracle
    // (tests/al/hard/CG-AL-X066.Test.al), prefixed X066_.
    // ---------------------------------------------------------------------

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

    [Test]
    procedure X066_ShipmentDrawnFromTwoReceiptsCostsTheExactCombinedTotal()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        ShipmentNo: Integer;
    begin
        ClearAllData();
        X066_SeedEntry('ROUND1', 2, 0.557);
        X066_SeedEntry('ROUND1', 5, 0.52);
        ShipmentNo := X066_SeedEntry('ROUND1', -3.7, 0);

        Engine.CalculateShipmentCosts('ROUND1');

        Assert.AreEqual(2.00, X066_ShipmentCostOf(ShipmentNo),
          'Expected the recorded cost of a shipment drawn from two receipts to equal the exact combined cost of the units taken, to the cent');
    end;

    [Test]
    procedure X066_ShipmentFromASingleReceiptCostsExactlyQuantityTimesUnitCost()
    var
        Engine: Codeunit "CG X066 Costing Engine";
        ShipmentNo: Integer;
    begin
        ClearAllData();
        X066_SeedEntry('ROUND3', 10, 2.50);
        ShipmentNo := X066_SeedEntry('ROUND3', -4, 0);

        Engine.CalculateShipmentCosts('ROUND3');

        Assert.AreEqual(10.00, X066_ShipmentCostOf(ShipmentNo),
          'Expected a shipment drawn entirely from one receipt to cost exactly the quantity taken times that receipt unit cost');
    end;

    [Test]
    procedure X066_ShippingMoreThanIsOnHandRaisesAnError()
    var
        Engine: Codeunit "CG X066 Costing Engine";
    begin
        ClearAllData();
        X066_SeedEntry('ERR1', 5, 1.00);
        X066_SeedEntry('ERR1', -3, 0);
        X066_SeedEntry('ERR1', -3, 0);

        asserterror Engine.CalculateShipmentCosts('ERR1');

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
        ClearAllData();

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
        Assert.AreEqual(777.77, X066_ShipmentCostOf(OtherItemLedgerEntryNo),
          'Expected a recorded cost for a different item to be unaffected by recomputing this item');
    end;

    // ---------------------------------------------------------------------
    // X139 section - carried over unmodified in body from the source oracle
    // (tests/al/hard/CG-AL-X139.Test.al), prefixed X139_.
    // ---------------------------------------------------------------------

    local procedure X139_SeedLine(DocumentNo: Code[20]; LineNo: Integer; AdjType: Enum "CG X139 Adjustment Type"; ItemNo: Code[20]; LocationCode: Code[10]; NewLocationCode: Code[10]; Quantity: Decimal)
    var
        AdjLine: Record "CG X139 Adjustment Line";
    begin
        AdjLine.Init();
        AdjLine."Document No." := DocumentNo;
        AdjLine."Line No." := LineNo;
        AdjLine."Adjustment Type" := AdjType;
        AdjLine."Item No." := ItemNo;
        AdjLine."Location Code" := LocationCode;
        AdjLine."New Location Code" := NewLocationCode;
        AdjLine.Quantity := Quantity;
        AdjLine.Insert();
    end;

    local procedure X139_SeedBalance(ItemNo: Code[20]; LocationCode: Code[10]; Quantity: Decimal)
    var
        Balance: Record "CG X139 Item Balance";
    begin
        Balance.Init();
        Balance."Item No." := ItemNo;
        Balance."Location Code" := LocationCode;
        Balance.Quantity := Quantity;
        Balance.Insert();
    end;

    local procedure X139_AssertBalance(ItemNo: Code[20]; LocationCode: Code[10]; ExpectedQuantity: Decimal; MessagePrefix: Text)
    var
        Balance: Record "CG X139 Item Balance";
        Poster: Codeunit "CG X139 Adjustment Poster";
    begin
        Assert.IsTrue(Balance.Get(ItemNo, LocationCode), MessagePrefix + ' - balance record exists');
        Assert.AreEqual(ExpectedQuantity, Balance.Quantity, MessagePrefix + ' - balance quantity');
        Assert.AreEqual(ExpectedQuantity, Poster.GetBalance(ItemNo, LocationCode), MessagePrefix + ' - balance via getter');
    end;

    local procedure X139_AssertLedgerEntryCountForLine(DocumentNo: Code[20]; LineNo: Integer; ExpectedCount: Integer; MessagePrefix: Text)
    var
        LedgerEntry: Record "CG X139 Item Ledger Entry";
    begin
        LedgerEntry.SetRange("Document No.", DocumentNo);
        LedgerEntry.SetRange("Line No.", LineNo);
        Assert.AreEqual(ExpectedCount, LedgerEntry.Count(), MessagePrefix + ' - number of ledger entries for the line');
    end;

    [Test]
    procedure X139_IncreaseLineAddsQuantityToExistingBalance()
    var
        Poster: Codeunit "CG X139 Adjustment Poster";
    begin
        ClearAllData();
        X139_SeedBalance('ITM1', 'BLUE', 10);
        X139_SeedBalance('SENTINEL', 'SENTLOC', 999);
        X139_SeedLine('DOC1', 10, "CG X139 Adjustment Type"::Increase, 'ITM1', 'BLUE', '', 5);

        Poster.PostAdjustments('DOC1');

        X139_AssertBalance('ITM1', 'BLUE', 15, 'An increase line adds to the existing balance');
        X139_AssertBalance('SENTINEL', 'SENTLOC', 999, 'An unrelated balance must not be touched by posting a different item');
    end;

    [Test]
    procedure X139_TransferLineMovesQuantityBetweenTwoLocations()
    var
        Poster: Codeunit "CG X139 Adjustment Poster";
    begin
        ClearAllData();
        X139_SeedBalance('ITM5', 'BLUE', 40);
        X139_SeedBalance('ITM5', 'RED', 5);
        X139_SeedLine('DOC1', 10, "CG X139 Adjustment Type"::Transfer, 'ITM5', 'BLUE', 'RED', 15);

        Poster.PostAdjustments('DOC1');

        X139_AssertLedgerEntryCountForLine('DOC1', 10, 2, 'A transfer line logs exactly one entry per location');
        X139_AssertBalance('ITM5', 'BLUE', 25, 'A transfer line reduces the source location''s balance');
        X139_AssertBalance('ITM5', 'RED', 20, 'A transfer line increases the destination location''s balance');
    end;

    [Test]
    procedure X139_MixedDocumentPostsEveryLineTypeCorrectly()
    var
        Poster: Codeunit "CG X139 Adjustment Poster";
    begin
        ClearAllData();
        X139_SeedBalance('ITM9A', 'BLUE', 10);
        X139_SeedBalance('ITM9D', 'BLUE', 40);
        X139_SeedBalance('ITM9D', 'RED', 4);
        X139_SeedLine('DOC1', 10, "CG X139 Adjustment Type"::Increase, 'ITM9A', 'BLUE', '', 5);
        X139_SeedLine('DOC1', 40, "CG X139 Adjustment Type"::Transfer, 'ITM9D', 'BLUE', 'RED', 10);

        Poster.PostAdjustments('DOC1');

        X139_AssertBalance('ITM9A', 'BLUE', 15, 'The increase line on the mixed document still posts correctly');
        X139_AssertBalance('ITM9D', 'BLUE', 30, 'The transfer line''s source location posts correctly on the mixed document');
        X139_AssertBalance('ITM9D', 'RED', 14, 'The transfer line''s destination location posts correctly on the mixed document');
        X139_AssertLedgerEntryCountForLine('DOC1', 40, 2, 'The transfer line on the mixed document still logs one entry per location');
    end;

    // ---------------------------------------------------------------------
    // Composition section - RestateShipment only produces correct figures
    // when BOTH the costing engine's reconciliation and the poster's
    // Transfer dispatch are correct. See NOTES.md for the hand-traced
    // single-fix-only argument behind each test below.
    // ---------------------------------------------------------------------

    local procedure RestatedCostOf(LedgerEntryNo: Integer): Decimal
    var
        Restatement: Record "CG X176 Restatement";
    begin
        Restatement.Get(LedgerEntryNo);
        exit(Restatement."Restated Cost");
    end;

    local procedure CostDeltaOf(LedgerEntryNo: Integer): Decimal
    var
        Restatement: Record "CG X176 Restatement";
    begin
        Restatement.Get(LedgerEntryNo);
        exit(Restatement."Cost Delta");
    end;

    local procedure RestateCounterOf(LedgerEntryNo: Integer): Integer
    var
        Restatement: Record "CG X176 Restatement";
    begin
        Restatement.Get(LedgerEntryNo);
        exit(Restatement."Restate Counter");
    end;

    local procedure LedgerEntryCountForItem(ItemNo: Code[20]): Integer
    var
        LedgerEntry: Record "CG X139 Item Ledger Entry";
    begin
        LedgerEntry.SetRange("Item No.", ItemNo);
        exit(LedgerEntry.Count());
    end;

    [Test]
    procedure RestateShipmentMovesTheExactFifoCostFromWipToCogsOnFirstRestatement()
    var
        Run: Codeunit "CG X176 Restatement Run";
        Poster: Codeunit "CG X139 Adjustment Poster";
        ShipmentNo: Integer;
    begin
        ClearAllData();
        // Two finely priced receipts - the same shape as the costing
        // engine's own two-receipt rounding case, so an exact-sum-then-round
        // cost of 2.00 and a round-per-layer cost of 1.99 disagree.
        X066_SeedEntry('REST1', 2, 0.557);
        X066_SeedEntry('REST1', 5, 0.52);
        ShipmentNo := X066_SeedEntry('REST1', -3.7, 0);

        Run.RestateShipment(ShipmentNo, 'WIP1', 'COGS1');

        Assert.AreEqual(2.00, RestatedCostOf(ShipmentNo),
          'Expected the restatement to record the shipment''s exact reconciled cost');
        Assert.AreEqual(2.00, CostDeltaOf(ShipmentNo),
          'Expected the first restatement''s posted difference to equal the full restated cost');
        Assert.AreEqual(-2.00, Poster.GetBalance('REST1', 'WIP1'),
          'Expected the WIP location to have given up exactly the shipment''s reconciled cost');
        Assert.AreEqual(2.00, Poster.GetBalance('REST1', 'COGS1'),
          'Expected the COGS location to have received exactly the shipment''s reconciled cost');
        Assert.AreEqual(2, LedgerEntryCountForItem('REST1'),
          'Expected the restatement to log one ledger entry at each of the two locations');
    end;

    [Test]
    procedure SecondRestatementAfterACostCorrectionMovesOnlyTheIncrementalDelta()
    var
        Run: Codeunit "CG X176 Restatement Run";
        Poster: Codeunit "CG X139 Adjustment Poster";
        LedgerEntry: Record "CG X066 Ledger Entry";
        ReceiptANo: Integer;
        ReceiptBNo: Integer;
        ShipmentNo: Integer;
    begin
        ClearAllData();
        // Baseline receipts are priced to the cent, so the first restatement
        // reconciles to 3.70 regardless of whether the engine rounds per
        // layer or once at the end - this call alone cannot discriminate.
        ReceiptANo := X066_SeedEntry('REST2', 2, 1.00);
        ReceiptBNo := X066_SeedEntry('REST2', 5, 1.00);
        ShipmentNo := X066_SeedEntry('REST2', -3.7, 0);

        Run.RestateShipment(ShipmentNo, 'WIP2', 'COGS2');
        Assert.AreEqual(3.70, RestatedCostOf(ShipmentNo),
          'Expected the first restatement to reconcile at whole-cent receipt costs');

        // A cost correction on the two receipts the shipment already drew
        // on - the finely priced case reappears, but now on the SECOND
        // restatement's recompute.
        LedgerEntry.Get(ReceiptANo);
        LedgerEntry."Unit Cost" := 0.557;
        LedgerEntry.Modify();
        LedgerEntry.Get(ReceiptBNo);
        LedgerEntry."Unit Cost" := 0.52;
        LedgerEntry.Modify();

        Run.RestateShipment(ShipmentNo, 'WIP2', 'COGS2');

        Assert.AreEqual(2.00, RestatedCostOf(ShipmentNo),
          'Expected the second restatement to reconcile to the corrected receipt costs exactly');
        Assert.AreEqual(2, RestateCounterOf(ShipmentNo),
          'Expected the restatement record to count two restatements of this shipment');
        Assert.AreEqual(-2.00, Poster.GetBalance('REST2', 'WIP2'),
          'Expected the WIP balance to net down to exactly the negative of the corrected cost across both restatements');
        Assert.AreEqual(2.00, Poster.GetBalance('REST2', 'COGS2'),
          'Expected the COGS balance to net to exactly the corrected cost across both restatements');
        Assert.AreEqual(4, LedgerEntryCountForItem('REST2'),
          'Expected two ledger entries per restatement across the two restatements');
    end;

    [Test]
    procedure RestatingOneShipmentLeavesAnotherShipmentsRestatementAndBalanceUntouched()
    var
        Run: Codeunit "CG X176 Restatement Run";
        Restatement: Record "CG X176 Restatement";
        Poster: Codeunit "CG X139 Adjustment Poster";
        ShipmentNo: Integer;
        OtherShipmentEntryNo: Integer;
    begin
        ClearAllData();

        // A sentinel restatement for an unrelated shipment, seeded with
        // nonzero values so an accidental cross-write is distinguishable
        // from an untouched row.
        OtherShipmentEntryNo := 999002;
        Restatement.Init();
        Restatement."Ledger Entry No." := OtherShipmentEntryNo;
        Restatement."Item No." := 'SENTINEL-ITEM';
        Restatement."Prior Cost" := 40.00;
        Restatement."Restated Cost" := 55.55;
        Restatement."Cost Delta" := 15.55;
        Restatement."Restate Counter" := 3;
        Restatement.Insert();
        X139_SeedBalance('SENTINEL-ITEM', 'SENTWIP', 12.34);
        X139_SeedBalance('SENTINEL-ITEM', 'SENTCOGS', 56.78);

        X066_SeedEntry('REST3', 6, 2.00);
        ShipmentNo := X066_SeedEntry('REST3', -6, 0);

        Run.RestateShipment(ShipmentNo, 'WIP3', 'COGS3');

        Assert.AreEqual(55.55, RestatedCostOf(OtherShipmentEntryNo),
          'Expected an unrelated shipment''s restatement record to be untouched');
        Assert.AreEqual(3, RestateCounterOf(OtherShipmentEntryNo),
          'Expected an unrelated shipment''s restate counter to be untouched');
        Assert.AreEqual(12.34, Poster.GetBalance('SENTINEL-ITEM', 'SENTWIP'),
          'Expected an unrelated item''s WIP-location balance to be untouched');
        Assert.AreEqual(56.78, Poster.GetBalance('SENTINEL-ITEM', 'SENTCOGS'),
          'Expected an unrelated item''s COGS-location balance to be untouched');
    end;

    [Test]
    procedure RestatingAnUnchangedShipmentASecondTimeMovesNoFurtherValue()
    var
        Run: Codeunit "CG X176 Restatement Run";
        Poster: Codeunit "CG X139 Adjustment Poster";
        ShipmentNo: Integer;
    begin
        ClearAllData();
        X066_SeedEntry('REST4', 10, 2.00);
        ShipmentNo := X066_SeedEntry('REST4', -4, 0);

        Run.RestateShipment(ShipmentNo, 'WIP4', 'COGS4');
        Run.RestateShipment(ShipmentNo, 'WIP4', 'COGS4');

        Assert.AreEqual(0, CostDeltaOf(ShipmentNo),
          'Expected restating an unchanged shipment a second time to post a zero difference');
        Assert.AreEqual(-8.00, Poster.GetBalance('REST4', 'WIP4'),
          'Expected the WIP balance to be unchanged by a second, zero-difference restatement');
        Assert.AreEqual(8.00, Poster.GetBalance('REST4', 'COGS4'),
          'Expected the COGS balance to be unchanged by a second, zero-difference restatement');
        Assert.AreEqual(4, LedgerEntryCountForItem('REST4'),
          'Expected the second restatement to still log a zero-quantity entry at each location');
    end;
}
