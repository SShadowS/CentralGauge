codeunit 89498 "CG-AL-X276 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    // This oracle merges 8 independent modules' test suites into one
    // codeunit. Every test and helper procedure is prefixed with the module
    // it belongs to so identical helper names across the source suites cannot
    // collide. Assembled from already-gated donors; see NOTES.md.

    var
        Assert: Codeunit Assert;
        // The default test isolation persists writes between test methods
        // (measured 2026-08-20, SOAP runner), so every test clears both tables
        // before seeding its own rows.
        // The default test isolation persists writes between test methods, so
        // every test clears both tables before seeding its own rows.
        // every test clears its own tables before seeding its own rows.
        // A block list kept in memory for the rest of the session does not roll
        // back with the test transaction, so every test clears both the table
        // and that in-memory copy before seeding its own data.
        LedgerMgt: Codeunit "CG X163 Ledger Mgt";
        GroupTotals: Codeunit "CG X163 Group Totals";
        // Companies are enumerated at runtime, never hardcoded, and every test
        // that touches the other company deletes what it seeded there BEFORE
        // asserting anything, then Commit()s that delete - so the cleanup is
        // durable even if a later assertion in the same test fails and raises
        // an error. A defensive clear also runs at the start of every
        // cross-company test in case a still-earlier run was aborted before it
        // could self-heal.

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
    // X075 - donor CG-AL-X075
    // ==========================================================

    local procedure X075_SeedContact(ContactNo: Code[20]; CityName: Text[30]; ContactCreditLimit: Decimal)
    var
        Contact: Record "CG X075 Contact";
    begin
        Contact.Init();
        Contact."No." := ContactNo;
        Contact.City := CityName;
        Contact."Credit Limit" := ContactCreditLimit;
        Contact.Insert();
    end;

    // Walks the view the submission left on the record; called repeatedly per
    // test, which also proves the list survives being iterated more than once.
    local procedure X075_CountVisits(var Contact: Record "CG X075 Contact"; ContactNo: Code[20]): Integer
    var
        Visits: Integer;
    begin
        if Contact.FindSet() then
            repeat
                if Contact."No." = ContactNo then
                    Visits += 1;
            until Contact.Next() = 0;
        exit(Visits);
    end;

    local procedure X075_AssertContactUnchanged(ContactNo: Code[20]; ExpectedCity: Text[30]; ExpectedCreditLimit: Decimal)
    var
        Contact: Record "CG X075 Contact";
    begin
        Assert.IsTrue(Contact.Get(ContactNo),
            StrSubstNo('Expected contact %1 to still exist under its original number after building the call list', ContactNo));
        Assert.AreEqual(ExpectedCity, Contact.City,
            StrSubstNo('Expected contact %1''s city to be unchanged after building the call list', ContactNo));
        Assert.AreEqual(ExpectedCreditLimit, Contact."Credit Limit",
            StrSubstNo('Expected contact %1''s credit limit to be unchanged after building the call list', ContactNo));
    end;

    [Test]
    procedure X075_CityOnlyQualifiersAppearOnTheList()
    var
        Contact: Record "CG X075 Contact";
        CampaignCallList: Codeunit "CG X075 Campaign Call List";
    begin
        Contact.DeleteAll();
        X075_SeedContact('C001', 'RIVERTON', 0);
        X075_SeedContact('C002', 'RIVERTON', 0);
        X075_SeedContact('C003', 'LAKESIDE', 0);

        CampaignCallList.BuildCallList(Contact, 'RIVERTON', 100000);

        Assert.AreEqual(1, X075_CountVisits(Contact, 'C001'),
            'Expected a contact located in the target city to be visited exactly once when iterating the call list');
        Assert.AreEqual(1, X075_CountVisits(Contact, 'C002'),
            'Expected a second contact located in the target city to be visited exactly once when iterating the call list');
        Assert.AreEqual(0, X075_CountVisits(Contact, 'C003'),
            'Expected a contact outside the target city, below the credit limit, to stay off the call list');
    end;

    [Test]
    procedure X075_CreditLimitQualifiersAppearRegardlessOfCity()
    var
        Contact: Record "CG X075 Contact";
        CampaignCallList: Codeunit "CG X075 Campaign Call List";
    begin
        Contact.DeleteAll();
        X075_SeedContact('C010', 'FARAWAY', 3200);
        X075_SeedContact('C011', 'FARAWAY', 1800);

        CampaignCallList.BuildCallList(Contact, 'CAMPAIGNTOWN', 2500);

        Assert.AreEqual(1, X075_CountVisits(Contact, 'C010'),
            'Expected a contact whose credit limit clears the threshold to be on the call list even though they live outside the target city');
        Assert.AreEqual(0, X075_CountVisits(Contact, 'C011'),
            'Expected a contact below the credit-limit threshold and outside the target city to stay off the call list');
    end;

    [Test]
    procedure X075_ContactMatchingBothRulesIsVisitedOnceAlongsideCityOnlyContact()
    var
        Contact: Record "CG X075 Contact";
        CampaignCallList: Codeunit "CG X075 Campaign Call List";
    begin
        Contact.DeleteAll();
        X075_SeedContact('C020', 'HARBORVIEW', 5200);
        X075_SeedContact('C021', 'HARBORVIEW', 0);
        X075_SeedContact('C022', 'MILLBROOK', 5200);

        CampaignCallList.BuildCallList(Contact, 'HARBORVIEW', 4000);

        Assert.AreEqual(1, X075_CountVisits(Contact, 'C020'),
            'Expected a contact matching both rules to be visited exactly once, nobody gets called twice');
        Assert.AreEqual(1, X075_CountVisits(Contact, 'C021'),
            'Expected a contact matching only the target-city rule to be on the same list as a contact matching both rules');
        Assert.AreEqual(1, X075_CountVisits(Contact, 'C022'),
            'Expected a contact matching only the credit-limit rule to be on the same list as a contact matching both rules');
    end;

    [Test]
    procedure X075_CreditLimitThresholdBoundaryQualifiesAtExactValue()
    var
        Contact: Record "CG X075 Contact";
        CampaignCallList: Codeunit "CG X075 Campaign Call List";
    begin
        Contact.DeleteAll();
        X075_SeedContact('C030', 'RIVERSIDE', 4000);
        X075_SeedContact('C031', 'RIVERSIDE', 3999.99);

        CampaignCallList.BuildCallList(Contact, 'CAMPAIGNTOWN', 4000);

        Assert.AreEqual(1, X075_CountVisits(Contact, 'C030'),
            'Expected a credit limit exactly at the threshold to qualify, the rule is at or above the threshold, not strictly above it');
        Assert.AreEqual(0, X075_CountVisits(Contact, 'C031'),
            'Expected a credit limit just below the threshold to stay off the call list');
    end;

    [Test]
    procedure X075_TargetCityMatchesTheWholeValueOnly()
    var
        Contact: Record "CG X075 Contact";
        CampaignCallList: Codeunit "CG X075 Campaign Call List";
    begin
        Contact.DeleteAll();
        X075_SeedContact('C040', 'NORTH', 0);
        X075_SeedContact('C041', 'NORTHPORT', 0);

        CampaignCallList.BuildCallList(Contact, 'NORTH', 100000);

        Assert.AreEqual(1, X075_CountVisits(Contact, 'C040'),
            'Expected a contact whose city exactly matches the target city to be on the call list');
        Assert.AreEqual(0, X075_CountVisits(Contact, 'C041'),
            'Expected a contact whose city merely starts with the target city to stay off the list, the match is on the whole value');
    end;

    [Test]
    procedure X075_BuildingTheListWritesNoContacts()
    var
        Contact: Record "CG X075 Contact";
        CampaignCallList: Codeunit "CG X075 Campaign Call List";
    begin
        Contact.DeleteAll();
        X075_SeedContact('C050', 'CAMPAIGNTOWN', 900);
        X075_SeedContact('C051', 'QUIETSIDE', 900);

        CampaignCallList.BuildCallList(Contact, 'CAMPAIGNTOWN', 5000);

        Assert.AreEqual(0, X075_CountVisits(Contact, 'C051'),
            'Expected a contact matching neither rule to stay off the call list');
        X075_AssertContactUnchanged('C050', 'CAMPAIGNTOWN', 900);
        X075_AssertContactUnchanged('C051', 'QUIETSIDE', 900);
    end;

    [Test]
    procedure X075_CampaignLookupBuildsTheSameCallListThroughTheWrapper()
    var
        Contact: Record "CG X075 Contact";
        Campaign: Record "CG X075 Campaign";
        CampaignCallListMgt: Codeunit "CG X075 Campaign Call List Mgt";
    begin
        Contact.DeleteAll();
        Campaign.DeleteAll();
        X075_SeedContact('C060', 'ELM STREET', 0);
        X075_SeedContact('C061', 'MAPLE STREET', 0);

        Campaign.Init();
        Campaign."Code" := 'SPRING26';
        Campaign."Target City" := 'ELM STREET';
        Campaign."Minimum Credit Limit" := 100000;
        Campaign.Insert();

        CampaignCallListMgt.BuildCallListForCampaign(Contact, 'SPRING26');

        Assert.AreEqual(1, X075_CountVisits(Contact, 'C060'),
            'Expected the campaign lookup to include a contact in the campaign''s target city on the call list');
        Assert.AreEqual(0, X075_CountVisits(Contact, 'C061'),
            'Expected the campaign lookup to leave a contact in a different city off the call list');
    end;

    // ==========================================================
    // X107 - donor CG-AL-X107
    // ==========================================================

    local procedure X107_Reset()
    var
        DealHeader: Record "CG X107 Deal Header";
        PostedDeal: Record "CG X107 Posted Deal";
    begin
        DealHeader.DeleteAll();
        PostedDeal.DeleteAll();
    end;

    local procedure X107_SeedDeal(No: Code[20]; DealReference: Text[30]; Amount: Decimal)
    var
        DealHeader: Record "CG X107 Deal Header";
    begin
        DealHeader.Init();
        DealHeader."No." := No;
        DealHeader."Deal Reference" := DealReference;
        DealHeader.Amount := Amount;
        DealHeader.Insert();
    end;

    [Test]
    procedure X107_PostedDealCarriesTheDealReference()
    var
        PostedDeal: Record "CG X107 Posted Deal";
        Poster: Codeunit "CG X107 Deal Poster";
    begin
        X107_Reset();
        X107_SeedDeal('D001', 'REF-ALPHA-0001-XXXXXXXXXXXXXX', 100);

        Poster.PostDeal('D001');

        PostedDeal.Get('D001');
        Assert.AreEqual('REF-ALPHA-0001-XXXXXXXXXXXXXX', PostedDeal."Deal Reference",
            'Expected the posted deal to carry the deal reference recorded at posting time');
    end;

    [Test]
    procedure X107_PostedDealCarriesADifferentDealReference()
    var
        PostedDeal: Record "CG X107 Posted Deal";
        Poster: Codeunit "CG X107 Deal Poster";
    begin
        X107_Reset();
        X107_SeedDeal('D002', 'REF-BETA-9999-YYYYYYYYYYYYYYY', 250);

        Poster.PostDeal('D002');

        PostedDeal.Get('D002');
        Assert.AreEqual('REF-BETA-9999-YYYYYYYYYYYYYYY', PostedDeal."Deal Reference",
            'Expected the posted deal to carry this deal header''s own reference');
    end;

    [Test]
    procedure X107_PostingKeepsTheAmountThePosterAssigns()
    var
        PostedDeal: Record "CG X107 Posted Deal";
        Poster: Codeunit "CG X107 Deal Poster";
    begin
        X107_Reset();
        X107_SeedDeal('D003', 'REF-GAMMA-1234-ZZZZZZZZZZZZZZ', 777.5);

        Poster.PostDeal('D003');

        PostedDeal.Get('D003');
        Assert.AreEqual(777.5, PostedDeal.Amount,
            'Expected the posted deal to keep the amount recorded when it was posted');
    end;

    [Test]
    procedure X107_PostingOneDealDoesNotChangeAnotherAlreadyPostedDeal()
    var
        OtherPostedDeal: Record "CG X107 Posted Deal";
        NewPostedDeal: Record "CG X107 Posted Deal";
        Poster: Codeunit "CG X107 Deal Poster";
    begin
        X107_Reset();
        OtherPostedDeal.Init();
        OtherPostedDeal."No." := 'EXIST';
        OtherPostedDeal."Deal Reference" := 'REF-EXISTING-SENTINEL-000000';
        OtherPostedDeal.Amount := 555;
        OtherPostedDeal.Insert();

        X107_SeedDeal('D004', 'REF-DELTA-4444-WWWWWWWWWWWWWW', 42);
        Poster.PostDeal('D004');

        OtherPostedDeal.Get('EXIST');
        Assert.AreEqual('REF-EXISTING-SENTINEL-000000', OtherPostedDeal."Deal Reference",
            'Expected an already-posted deal to keep its own deal reference when another deal is posted');
        Assert.AreEqual(555, OtherPostedDeal.Amount,
            'Expected an already-posted deal to keep its own amount when another deal is posted');

        NewPostedDeal.Get('D004');
        Assert.AreEqual('REF-DELTA-4444-WWWWWWWWWWWWWW', NewPostedDeal."Deal Reference",
            'Expected the newly posted deal to carry its own deal reference');
    end;

    // ==========================================================
    // X110 - donor CG-AL-X110
    // ==========================================================

    [Test]
    procedure X110_CleanBatchPostsOneEntryPerOpenLine()
    var
        PostBatch: Codeunit "CG X110 Post Batch";
        Any: Codeunit Any;
        AmountA: Decimal;
        AmountB: Decimal;
    begin
        // [SCENARIO] A balanced three-line batch produces three ledger entries
        AmountA := Any.DecimalInRange(10, 500, 2);
        AmountB := Any.DecimalInRange(10, 500, 2);
        X110_CreateLine('BATCH-01', 10, 'ACC-1', WorkDate(), AmountA);
        X110_CreateLine('BATCH-01', 20, 'ACC-2', WorkDate(), AmountB);
        X110_CreateLine('BATCH-01', 30, 'ACC-3', WorkDate(), -(AmountA + AmountB));

        PostBatch.PostBatch('BATCH-01');

        Assert.AreEqual(3, X110_LedgerEntryCount('BATCH-01'),
            'Expected exactly one ledger entry per open line of the posted batch');
    end;

    [Test]
    procedure X110_PostingCopiesTheLineFieldsToTheLedgerEntry()
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
        PostBatch: Codeunit "CG X110 Post Batch";
        Any: Codeunit Any;
        AccountNo: Code[20];
        PostingDate: Date;
        LineDescription: Text[50];
        LineAmount: Decimal;
    begin
        // [SCENARIO] Account No., Posting Date, Description, Amount and Batch Name travel from the line to the entry
        AccountNo := CopyStr('B2-' + UpperCase(Any.AlphabeticText(8)), 1, 20);
        PostingDate := Any.DateInRange(120);
        LineDescription := CopyStr(Any.AlphabeticText(30), 1, 50);
        LineAmount := Any.DecimalInRange(100, 900, 2);
        X110_CreateLine('BATCH-02', 10, AccountNo, PostingDate, LineDescription, LineAmount);
        X110_CreateLine('BATCH-02', 20, 'ACC-BAL', WorkDate(), -LineAmount);

        PostBatch.PostBatch('BATCH-02');

        LedgerEntry.SetRange("Account No.", AccountNo);
        Assert.IsTrue(LedgerEntry.FindFirst(),
            StrSubstNo('Expected a ledger entry carrying the posted line''s account %1', AccountNo));
        Assert.AreEqual(PostingDate, LedgerEntry."Posting Date",
            'Expected the line''s posting date on its ledger entry');
        Assert.AreEqual(LineDescription, LedgerEntry.Description,
            'Expected the line''s description on its ledger entry');
        Assert.AreEqual(LineAmount, LedgerEntry.Amount,
            'Expected the line''s amount on its ledger entry');
        Assert.AreEqual('BATCH-02', LedgerEntry."Batch Name",
            'Expected the batch name on the ledger entry');
    end;

    [Test]
    procedure X110_EntryNumbersContinueAfterTheLastExistingEntry()
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
        PostBatch: Codeunit "CG X110 Post Batch";
        Any: Codeunit Any;
        SeedEntryNo: Integer;
        AmountA: Decimal;
    begin
        // [SCENARIO] New entry numbers pick up right after the highest entry already in the ledger
        SeedEntryNo := X110_SeedLedgerEntry(Any.IntegerInRange(100, 900));
        AmountA := Any.DecimalInRange(10, 500, 2);
        X110_CreateLine('BATCH-03', 10, 'ACC-1', WorkDate(), AmountA);
        X110_CreateLine('BATCH-03', 20, 'ACC-2', WorkDate(), -AmountA);

        PostBatch.PostBatch('BATCH-03');

        LedgerEntry.SetRange("Batch Name", 'BATCH-03');
        Assert.AreEqual(2, LedgerEntry.Count(),
            'Expected exactly two new ledger entries for the batch');
        LedgerEntry.FindFirst();
        Assert.AreEqual(SeedEntryNo + 1, LedgerEntry."Entry No.",
            'Expected the first new entry number to continue right after the highest existing ledger entry');
        LedgerEntry.FindLast();
        Assert.AreEqual(SeedEntryNo + 2, LedgerEntry."Entry No.",
            'Expected the second new entry number to follow the first with no gap');
    end;

    [Test]
    procedure X110_PostingIntoALedgerWithNoEntriesStartsNumberingAtOne()
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] The very first entry written into an empty ledger is numbered 1
        // Every other test in this suite scopes itself by batch name and pins entry
        // numbers only relative to whatever the ledger already held, so the
        // empty-ledger case is the one place an absolute number is observable.
        LedgerEntry.DeleteAll();
        X110_CreateLine('BATCH-16', 10, 'ACC-1', WorkDate(), 100);
        X110_CreateLine('BATCH-16', 20, 'ACC-2', WorkDate(), -100);

        PostBatch.PostBatch('BATCH-16');

        LedgerEntry.SetRange("Batch Name", 'BATCH-16');
        LedgerEntry.FindFirst();
        Assert.AreEqual(1, LedgerEntry."Entry No.",
            'Expected the first entry written into a ledger that held no entries to be numbered 1');
        LedgerEntry.FindLast();
        Assert.AreEqual(2, LedgerEntry."Entry No.",
            'Expected the second entry to follow the first with no gap');
    end;

    [Test]
    procedure X110_EntriesFollowLineNumberOrder()
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] Entries are numbered in ascending Line No. order, however the lines were inserted
        X110_CreateLine('BATCH-04', 30, 'ACC-3', WorkDate(), 5);
        X110_CreateLine('BATCH-04', 10, 'ACC-1', WorkDate(), 10);
        X110_CreateLine('BATCH-04', 20, 'ACC-2', WorkDate(), -15);

        PostBatch.PostBatch('BATCH-04');

        LedgerEntry.SetRange("Batch Name", 'BATCH-04');
        Assert.AreEqual(3, LedgerEntry.Count(),
            'Expected exactly one ledger entry per open line of the posted batch');
        LedgerEntry.FindSet();
        Assert.AreEqual('ACC-1', LedgerEntry."Account No.",
            'Expected the lowest new entry number to carry line 10 - entries are created in ascending Line No. order');
        LedgerEntry.Next();
        Assert.AreEqual('ACC-2', LedgerEntry."Account No.",
            'Expected the middle entry number to carry line 20');
        LedgerEntry.Next();
        Assert.AreEqual('ACC-3', LedgerEntry."Account No.",
            'Expected the highest entry number to carry line 30');
    end;

    [Test]
    procedure X110_PostingMarksEveryPostedLinePosted()
    var
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] A successful post flips every line to Posted and keeps the lines in the journal
        X110_CreateLine('BATCH-05', 10, 'ACC-1', WorkDate(), 100);
        X110_CreateLine('BATCH-05', 20, 'ACC-2', WorkDate(), -100);

        PostBatch.PostBatch('BATCH-05');

        Assert.AreEqual(2, X110_LineCount('BATCH-05'),
            'Expected both journal lines to remain in the batch after posting - posting updates their status, it must not delete them');
        X110_AssertAllLinesHaveStatus('BATCH-05', "CG X110 Journal Status"::Posted);
    end;

    [Test]
    procedure X110_BlankAccountNoFailsTheWholeBatch()
    var
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] One line without an account fails the batch with the standard field-guard error
        X110_CreateLine('BATCH-06', 10, 'ACC-1', WorkDate(), 100);
        X110_CreateLine('BATCH-06', 20, '', WorkDate(), -100);
        Commit();

        asserterror PostBatch.PostBatch('BATCH-06');

        X110_AssertErrorContains('Account No.');
        X110_AssertErrorContains('must have a value');
        Assert.AreEqual(0, X110_LedgerEntryCount('BATCH-06'),
            'Expected no ledger entries when a line fails the account guard - a failing batch must write nothing');
        X110_AssertAllLinesHaveStatus('BATCH-06', "CG X110 Journal Status"::Open);
    end;

    [Test]
    procedure X110_BlankPostingDateFailsTheWholeBatch()
    var
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] One line without a posting date fails the batch with the standard field-guard error
        X110_CreateLine('BATCH-07', 10, 'ACC-1', WorkDate(), 100);
        X110_CreateLine('BATCH-07', 20, 'ACC-2', 0D, -100);
        Commit();

        asserterror PostBatch.PostBatch('BATCH-07');

        X110_AssertErrorContains('Posting Date');
        X110_AssertErrorContains('must have a value');
        Assert.AreEqual(0, X110_LedgerEntryCount('BATCH-07'),
            'Expected no ledger entries when a line fails the posting date guard - a failing batch must write nothing');
        X110_AssertAllLinesHaveStatus('BATCH-07', "CG X110 Journal Status"::Open);
    end;

    [Test]
    procedure X110_ZeroAmountLineFailsTheWholeBatch()
    var
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] A zero-amount line fails the batch even though the batch balances
        X110_CreateLine('BATCH-08', 10, 'ACC-1', WorkDate(), 100);
        X110_CreateLine('BATCH-08', 20, 'ACC-2', WorkDate(), -100);
        X110_CreateLine('BATCH-08', 30, 'ACC-3', WorkDate(), 0);
        Commit();

        asserterror PostBatch.PostBatch('BATCH-08');

        X110_AssertErrorContains('Amount');
        X110_AssertErrorContains('must have a value');
        Assert.AreEqual(0, X110_LedgerEntryCount('BATCH-08'),
            'Expected no ledger entries when a line fails the amount guard - a failing batch must write nothing');
        X110_AssertAllLinesHaveStatus('BATCH-08', "CG X110 Journal Status"::Open);
    end;

    [Test]
    procedure X110_UnbalancedShortBatchFailsWithOutOfBalanceError()
    var
        Any: Codeunit Any;
    begin
        // [SCENARIO] Open lines whose amounts sum below zero are rejected
        X110_VerifyOutOfBalanceBatchFails('BATCH-09', -Any.IntegerInRange(1, 5000) / 100);
    end;

    [Test]
    procedure X110_OneCentSurplusFailsWithOutOfBalanceError()
    begin
        // [SCENARIO] A surplus of a single cent is already enough to reject the batch
        X110_VerifyOutOfBalanceBatchFails('BATCH-09B', 0.01);
    end;

    [Test]
    procedure X110_EmptyBatchFailsWithNothingToPost()
    var
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] A batch with no lines at all is rejected
        asserterror PostBatch.PostBatch('BATCH-10');

        X110_AssertErrorContains('nothing to post');
    end;

    [Test]
    procedure X110_RepostingAFullyPostedBatchReportsNothingToPost()
    var
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] Posting a batch a second time, with no new lines added, leaves the ledger unchanged
        X110_CreateLine('BATCH-11', 10, 'ACC-1', WorkDate(), 250);
        X110_CreateLine('BATCH-11', 20, 'ACC-2', WorkDate(), -250);
        PostBatch.PostBatch('BATCH-11');
        Commit();

        asserterror PostBatch.PostBatch('BATCH-11');

        X110_AssertErrorContains('nothing to post');
        Assert.AreEqual(2, X110_LedgerEntryCount('BATCH-11'),
            'Expected the second posting attempt to create no duplicate ledger entries');
    end;

    [Test]
    procedure X110_NewlyOpenedLinesPostWithoutDuplicatingAlreadyPostedOnes()
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] Lines added to a batch after it was posted are posted on their own, on the next run
        X110_CreateLine('BATCH-12', 10, 'B12-A', WorkDate(), 60);
        X110_CreateLine('BATCH-12', 20, 'B12-B', WorkDate(), -60);
        PostBatch.PostBatch('BATCH-12');
        X110_CreateLine('BATCH-12', 30, 'B12-C', WorkDate(), 40);
        X110_CreateLine('BATCH-12', 40, 'B12-D', WorkDate(), -40);

        PostBatch.PostBatch('BATCH-12');

        Assert.AreEqual(4, X110_LedgerEntryCount('BATCH-12'),
            'Expected the second run to post only the two newly opened lines - already-posted lines must not produce ledger entries again');
        LedgerEntry.SetRange("Batch Name", 'BATCH-12');
        LedgerEntry.SetRange("Account No.", 'B12-A');
        Assert.AreEqual(1, LedgerEntry.Count(),
            'Expected the line posted in the first run to appear in the ledger exactly once');
        X110_AssertAllLinesHaveStatus('BATCH-12', "CG X110 Journal Status"::Posted);
    end;

    [Test]
    procedure X110_ABatchWithSomeAlreadyPostedLinesOnlyPostsItsOpenOnes()
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] A batch that already carries a posted line from an earlier run posts only its open lines now
        X110_SeedPostedLineWithLedgerEntry('BATCH-14', 10, 'B14-OLD', WorkDate(), 500);
        X110_CreateLine('BATCH-14', 20, 'B14-NEW1', WorkDate(), 200);
        X110_CreateLine('BATCH-14', 30, 'B14-NEW2', WorkDate(), -200);

        PostBatch.PostBatch('BATCH-14');

        Assert.AreEqual(3, X110_LedgerEntryCount('BATCH-14'),
            'Expected only the two open lines to gain a new ledger entry, on top of the one already carried by the previously posted line');
        LedgerEntry.SetRange("Batch Name", 'BATCH-14');
        LedgerEntry.SetRange("Account No.", 'B14-OLD');
        Assert.AreEqual(1, LedgerEntry.Count(),
            'Expected the previously posted line to still carry exactly one ledger entry');
        X110_AssertAllLinesHaveStatus('BATCH-14', "CG X110 Journal Status"::Posted);
    end;

    [Test]
    procedure X110_NewOpenLineForAPreviouslyPostedAccountStillGetsItsOwnEntry()
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] A newly opened line can legitimately reuse the account of a line posted in an earlier run - it must still post its own entry
        X110_SeedPostedLineWithLedgerEntry('BATCH-15', 10, 'B15-OLD', WorkDate(), 500);
        X110_CreateLine('BATCH-15', 20, 'B15-OLD', WorkDate(), 150);
        X110_CreateLine('BATCH-15', 30, 'B15-NEW', WorkDate(), -150);

        PostBatch.PostBatch('BATCH-15');

        Assert.AreEqual(3, X110_LedgerEntryCount('BATCH-15'),
            'Expected the batch to gain exactly one new ledger entry per currently open line, including an open line that shares an account with an already posted one');
        LedgerEntry.SetRange("Batch Name", 'BATCH-15');
        LedgerEntry.SetRange("Account No.", 'B15-OLD');
        Assert.AreEqual(2, LedgerEntry.Count(),
            'Expected the account to carry two ledger entries: the one from the earlier run, plus one new entry for the newly opened line - neither duplicated nor skipped');
        X110_AssertAllLinesHaveStatus('BATCH-15', "CG X110 Journal Status"::Posted);
    end;

    [Test]
    procedure X110_PostingScopesEveryCheckToTheGivenBatch()
    var
        PostBatch: Codeunit "CG X110 Post Batch";
    begin
        // [SCENARIO] Posting one batch ignores a neighbour batch entirely
        // [GIVEN] the neighbour is deliberately unbalanced, so an unscoped balance check would fail loudly
        X110_CreateLine('BATCH-13A', 10, 'ACC-1', WorkDate(), 90);
        X110_CreateLine('BATCH-13A', 20, 'ACC-2', WorkDate(), -90);
        X110_CreateLine('BATCH-13B', 10, 'ACC-3', WorkDate(), 77);

        PostBatch.PostBatch('BATCH-13A');

        Assert.AreEqual(2, X110_LedgerEntryCount('BATCH-13A'),
            'Expected both lines of the posted batch in the ledger');
        Assert.AreEqual(0, X110_LedgerEntryCount('BATCH-13B'),
            'Expected no ledger entries for the other batch - posting one batch must not touch another');
        X110_AssertAllLinesHaveStatus('BATCH-13B', "CG X110 Journal Status"::Open);
    end;

    local procedure X110_CreateLine(BatchName: Code[10]; LineNo: Integer; AccountNo: Code[20]; PostingDate: Date; LineAmount: Decimal)
    begin
        X110_CreateLine(BatchName, LineNo, AccountNo, PostingDate, '', LineAmount);
    end;

    local procedure X110_CreateLine(BatchName: Code[10]; LineNo: Integer; AccountNo: Code[20]; PostingDate: Date; LineDescription: Text[50]; LineAmount: Decimal)
    var
        JournalLine: Record "CG X110 Journal Line";
    begin
        JournalLine.Init();
        JournalLine."Batch Name" := BatchName;
        JournalLine."Line No." := LineNo;
        JournalLine."Account No." := AccountNo;
        JournalLine."Posting Date" := PostingDate;
        JournalLine.Description := LineDescription;
        JournalLine.Amount := LineAmount;
        JournalLine.Status := "CG X110 Journal Status"::Open;
        JournalLine.Insert();
    end;

    local procedure X110_SeedPostedLineWithLedgerEntry(BatchName: Code[10]; LineNo: Integer; AccountNo: Code[20]; PostingDate: Date; LineAmount: Decimal)
    var
        JournalLine: Record "CG X110 Journal Line";
    begin
        JournalLine.Init();
        JournalLine."Batch Name" := BatchName;
        JournalLine."Line No." := LineNo;
        JournalLine."Account No." := AccountNo;
        JournalLine."Posting Date" := PostingDate;
        JournalLine.Amount := LineAmount;
        JournalLine.Status := "CG X110 Journal Status"::Posted;
        JournalLine.Insert();

        X110_SeedLedgerEntryFor(BatchName, AccountNo, PostingDate, LineAmount);
    end;

    local procedure X110_VerifyOutOfBalanceBatchFails(BatchName: Code[10]; Delta: Decimal)
    var
        PostBatch: Codeunit "CG X110 Post Batch";
        Any: Codeunit Any;
        AmountA: Decimal;
    begin
        // A whole-number base amount keeps the imbalance exactly Delta, so a
        // rounded or integer total would see the 0.01 case as balanced and post it.
        AmountA := Any.IntegerInRange(10, 500);
        X110_CreateLine(BatchName, 10, 'ACC-1', WorkDate(), AmountA);
        X110_CreateLine(BatchName, 20, 'ACC-2', WorkDate(), -AmountA + Delta);
        Commit();

        asserterror PostBatch.PostBatch(BatchName);

        X110_AssertErrorContains('out of balance');
        X110_AssertErrorContains(Format(Delta));
        Assert.AreEqual(0, X110_LedgerEntryCount(BatchName),
            'Expected no ledger entries for an out-of-balance batch - a failing batch must write nothing');
        X110_AssertAllLinesHaveStatus(BatchName, "CG X110 Journal Status"::Open);
    end;

    local procedure X110_SeedLedgerEntry(Offset: Integer): Integer
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
        SeedEntryNo: Integer;
    begin
        if LedgerEntry.FindLast() then;
        SeedEntryNo := LedgerEntry."Entry No." + Offset;
        LedgerEntry.Init();
        LedgerEntry."Entry No." := SeedEntryNo;
        LedgerEntry."Account No." := 'SEED';
        LedgerEntry.Amount := 1;
        LedgerEntry.Insert();
        exit(SeedEntryNo);
    end;

    local procedure X110_SeedLedgerEntryFor(BatchName: Code[10]; AccountNo: Code[20]; PostingDate: Date; LineAmount: Decimal): Integer
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
        NewEntryNo: Integer;
    begin
        if LedgerEntry.FindLast() then
            NewEntryNo := LedgerEntry."Entry No." + 1
        else
            NewEntryNo := 1;
        LedgerEntry.Init();
        LedgerEntry."Entry No." := NewEntryNo;
        LedgerEntry."Account No." := AccountNo;
        LedgerEntry."Posting Date" := PostingDate;
        LedgerEntry.Amount := LineAmount;
        LedgerEntry."Batch Name" := BatchName;
        LedgerEntry.Insert();
        exit(NewEntryNo);
    end;

    local procedure X110_LedgerEntryCount(BatchName: Code[10]): Integer
    var
        LedgerEntry: Record "CG X110 Ledger Entry";
    begin
        LedgerEntry.SetRange("Batch Name", BatchName);
        exit(LedgerEntry.Count());
    end;

    local procedure X110_LineCount(BatchName: Code[10]): Integer
    var
        JournalLine: Record "CG X110 Journal Line";
    begin
        JournalLine.SetRange("Batch Name", BatchName);
        exit(JournalLine.Count());
    end;

    local procedure X110_AssertAllLinesHaveStatus(BatchName: Code[10]; ExpectedStatus: Enum "CG X110 Journal Status")
    var
        JournalLine: Record "CG X110 Journal Line";
    begin
        JournalLine.SetRange("Batch Name", BatchName);
        if JournalLine.FindSet() then
            repeat
                Assert.AreEqual(Format(ExpectedStatus), Format(JournalLine.Status),
                    StrSubstNo('Expected line %1 of batch %2 to have status %3', JournalLine."Line No.", BatchName, ExpectedStatus));
            until JournalLine.Next() = 0;
    end;

    local procedure X110_AssertErrorContains(Fragment: Text)
    var
        ActualError: Text;
    begin
        ActualError := GetLastErrorText();
        Assert.IsTrue(LowerCase(ActualError).Contains(LowerCase(Fragment)),
            StrSubstNo('Expected the posting error to contain "%1", got: %2', Fragment, ActualError));
    end;

    // ==========================================================
    // X116 - donor CG-AL-X116
    // ==========================================================

    [Test]
    procedure X116_SingleInvoiceRendersNumberSpaceAmount()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
    begin
        // [SCENARIO] One applied invoice becomes one entry with two forced decimals
        Composer.AddInvoice('INV-1001', 250);

        Assert.AreEqual('INV-1001 250.00', Composer.GetRemittanceText(),
            'Expected the entry to be the invoice number, one space, and the amount with exactly two decimals');
    end;

    [Test]
    procedure X116_EntriesAreJoinedWithCommaAndSpace()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
    begin
        // [SCENARIO] Two applied invoices are joined by ', ' in the order they were added
        Composer.AddInvoice('INV-1001', 250);
        Composer.AddInvoice('INV-1002', 13.5);

        Assert.AreEqual('INV-1001 250.00, INV-1002 13.50', Composer.GetRemittanceText(),
            'Expected the entries joined by a comma and a single space, in the order added');
    end;

    [Test]
    procedure X116_LargeAmountRendersAsPlainDigits()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
    begin
        // [SCENARIO] A large amount stays plain digits with a dot and two decimals
        Composer.AddInvoice('INV-2001', 1234567.8);

        Assert.AreEqual('INV-2001 1234567.80', Composer.GetRemittanceText(),
            'Expected the entry to be the invoice number followed by a space and the amount as plain digits');
    end;

    [Test]
    procedure X116_NoInvoicesYieldEmptyText()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
    begin
        // [SCENARIO] A composer with nothing added produces an empty remittance line
        Assert.AreEqual('', Composer.GetRemittanceText(),
            'Expected an empty text when no invoice was added');
    end;

    [Test]
    procedure X116_ExactlyFullCapacityComesBackUntouched()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
        InvoiceNoA: Text;
        InvoiceNoB: Text;
    begin
        // [SCENARIO] A join of exactly 140 characters fits the limit and gets no suffix
        // [GIVEN] two entries of 69 characters each: 69 + 2 + 69 = 140
        InvoiceNoA := PadStr('TRYAL-EXACT-A-', 63, 'X');
        InvoiceNoB := PadStr('TRYAL-EXACT-B-', 63, 'X');
        Composer.AddInvoice(InvoiceNoA, 10.12);
        Composer.AddInvoice(InvoiceNoB, 10.12);

        Assert.AreEqual(InvoiceNoA + ' 10.12, ' + InvoiceNoB + ' 10.12', Composer.GetRemittanceText(),
            'Expected the full join back unchanged: it is exactly 140 characters, so nothing may be left out and no suffix may appear');
    end;

    [Test]
    procedure X116_SingleEntryOfExactlyFullCapacityIsAccepted()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
        InvoiceNo: Text;
    begin
        // [SCENARIO] A lone entry of exactly 140 characters can still be sent: accepted and returned untouched
        // [GIVEN] an invoice number of 134 characters - the entry is 134 + 1 + 5 = 140
        InvoiceNo := PadStr('TRYAL-FULL-', 134, 'X');
        Composer.AddInvoice(InvoiceNo, 10.12);

        Assert.AreEqual(InvoiceNo + ' 10.12', Composer.GetRemittanceText(),
            'Expected the single 140-character entry back unchanged: 140 is exactly the limit, so it must be accepted and no suffix may appear');
    end;

    [Test]
    procedure X116_OneCharacterOverflowDropsTheLastEntry()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
        InvoiceNoA: Text;
        InvoiceNoB: Text;
    begin
        // [SCENARIO] A join of 141 characters overflows: the last entry is replaced by the suffix
        // [GIVEN] entries of 69 and 70 characters: 69 + 2 + 70 = 141, one over the limit
        InvoiceNoA := PadStr('TRYAL-OVER-A-', 63, 'X');
        InvoiceNoB := PadStr('TRYAL-OVER-B-', 64, 'X');
        Composer.AddInvoice(InvoiceNoA, 10.12);
        Composer.AddInvoice(InvoiceNoB, 10.12);

        Assert.AreEqual(InvoiceNoA + ' 10.12, and 1 more', Composer.GetRemittanceText(),
            'Expected the 141-character join to overflow: keep the first entry whole and end with ", and 1 more"');
    end;

    [Test]
    procedure X116_SuffixSpaceForcesARecountOfTheOmitted()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
        ExpectedText: Text;
        Index: Integer;
    begin
        // [SCENARIO] The suffix claims its own space: appending it pushes one more entry out
        // [GIVEN] 13 entries of 12 characters - 10 fit without a suffix (138), but only 9 fit next to it
        for Index := 1 to 13 do
            Composer.AddInvoice(X116_SixCharInvoiceNo(Index), 10.12);
        for Index := 1 to 9 do begin
            if Index > 1 then
                ExpectedText += ', ';
            ExpectedText += X116_SixCharInvoiceNo(Index) + ' 10.12';
        end;
        ExpectedText += ', and 4 more';

        Assert.AreEqual(ExpectedText, Composer.GetRemittanceText(),
            'Expected the remittance text for 13 added invoices to keep 9 entries and end with the matching omitted-count suffix');
    end;

    [Test]
    procedure X116_SuffixedTextOfExactly140IsKept()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
        ExpectedText: Text;
        Index: Integer;
    begin
        // [SCENARIO] A suffixed text of exactly 140 characters stays within the limit - no extra entry may be left out
        // [GIVEN] 12 entries of 11 characters: the full join is 154, but 10 entries (128) plus ', and 2 more' (12) land on exactly 140
        for Index := 1 to 12 do
            Composer.AddInvoice(X116_FiveCharInvoiceNo(Index), 10.12);
        for Index := 1 to 10 do begin
            if Index > 1 then
                ExpectedText += ', ';
            ExpectedText += X116_FiveCharInvoiceNo(Index) + ' 10.12';
        end;
        ExpectedText += ', and 2 more';

        Assert.AreEqual(ExpectedText, Composer.GetRemittanceText(),
            'Expected 10 kept entries and "and 2 more": the suffixed text lands on exactly 140 characters, which still fits the limit');
    end;

    [Test]
    procedure X116_OnlyTheSuffixRemainsWhenNotEvenTheFirstEntryFits()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
    begin
        // [SCENARIO] When the first entry plus the suffix exceeds 140, the text is the bare suffix
        // [GIVEN] a first entry of 130 characters (130 + ', and 3 more' = 142) and three normal ones
        Composer.AddInvoice(PadStr('TRYAL-SOLO-', 124, 'X'), 10.12);
        Composer.AddInvoice('TRYAL-S2', 10.12);
        Composer.AddInvoice('TRYAL-S3', 10.12);
        Composer.AddInvoice('TRYAL-S4', 10.12);

        Assert.AreEqual('and 4 more', Composer.GetRemittanceText(),
            'Expected just "and 4 more": not even the first entry fits alongside the suffix, so every invoice counts as left out and no leading comma appears');
    end;

    [Test]
    procedure X116_OverlongSingleEntryRaisesAnError()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
    begin
        // [SCENARIO] An entry longer than 140 characters can never be sent and must be refused
        // [GIVEN] an invoice number of 135 characters - the entry is 135 + 1 + 5 = 141, one over the limit
        asserterror Composer.AddInvoice(PadStr('TRYAL-HUGE-', 135, 'X'), 10.12);

        Assert.ExpectedError('140');
    end;

    [Test]
    procedure X116_GeneratedAmountsAreRenderedExactly()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
        Any: Codeunit Any;
        AmountA: Decimal;
        AmountB: Decimal;
    begin
        // [SCENARIO] Random amounts survive composition unchanged - hardcoding the examples cannot pass
        Any.SetSeed(116);
        AmountA := Any.DecimalInRange(1000, 999999, 2);
        AmountB := Any.DecimalInRange(1000, 999999, 2);
        Composer.AddInvoice('TRYAL-G1', AmountA);
        Composer.AddInvoice('TRYAL-G2', AmountB);

        Assert.AreEqual('TRYAL-G1 ' + X116_InvariantAmount(AmountA) + ', TRYAL-G2 ' + X116_InvariantAmount(AmountB),
            Composer.GetRemittanceText(),
            StrSubstNo('Expected the amounts %1 and %2 rendered with a dot and exactly two decimals, joined by ", "', AmountA, AmountB));
    end;

    [Test]
    procedure X116_GeneratedInvoiceCountDrivesTheSuffix()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
        Any: Codeunit Any;
        ExpectedText: Text;
        Total: Integer;
        Index: Integer;
    begin
        // [SCENARIO] However many 12-character entries are added, 9 fit next to the suffix and N is Total - 9
        Any.SetSeed(116);
        Total := Any.IntegerInRange(13, 40);
        for Index := 1 to Total do
            Composer.AddInvoice(X116_SixCharInvoiceNo(Index), 10.12);
        for Index := 1 to 9 do begin
            if Index > 1 then
                ExpectedText += ', ';
            ExpectedText += X116_SixCharInvoiceNo(Index) + ' 10.12';
        end;
        ExpectedText += StrSubstNo(', and %1 more', Total - 9);

        Assert.AreEqual(ExpectedText, Composer.GetRemittanceText(),
            StrSubstNo('Expected the remittance text for %1 added invoices to keep 9 entries and end with the matching omitted-count suffix', Total));
    end;

    [Test]
    procedure X116_LargeInvoiceCountStaysWithinTheLimit()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
        ExpectedText: Text;
        Index: Integer;
    begin
        // [SCENARIO] A much larger batch still ends up within the 140-character limit
        // [GIVEN] 40 entries of 8 characters - 14 fit without a suffix (138), but only 12 fit next to it
        for Index := 1 to 40 do
            Composer.AddInvoice(X116_TwoCharInvoiceNo(Index), 10.12);
        for Index := 1 to 12 do begin
            if Index > 1 then
                ExpectedText += ', ';
            ExpectedText += X116_TwoCharInvoiceNo(Index) + ' 10.12';
        end;
        ExpectedText += ', and 28 more';

        Assert.AreEqual(ExpectedText, Composer.GetRemittanceText(),
            'Expected the remittance text for 40 added invoices to keep 12 entries and end with the matching omitted-count suffix, staying within the 140-character limit');
    end;

    [Test]
    procedure X116_WholeNumberAmountAtFullCapacityIsAccepted()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
        InvoiceNo: Text;
    begin
        // [SCENARIO] An entry built from a whole-number amount can still land exactly on the 140-character limit
        // [GIVEN] an invoice number of 133 characters - the entry is 133 + 1 + 6 = 140
        InvoiceNo := PadStr('TRYAL-WFULL-A-', 133, 'X');
        Composer.AddInvoice(InvoiceNo, 250);

        Assert.AreEqual(InvoiceNo + ' 250.00', Composer.GetRemittanceText(),
            'Expected the entry to be the invoice number followed by a space and 250.00');
    end;

    [Test]
    procedure X116_WholeNumberAmountOneOverCapacityIsRejected()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
    begin
        // [SCENARIO] An entry built from a whole-number amount is refused once it is one character over the limit
        // [GIVEN] an invoice number of 134 characters - the entry is 134 + 1 + 6 = 141
        asserterror Composer.AddInvoice(PadStr('TRYAL-WFULL-B-', 134, 'X'), 250);

        Assert.ExpectedError('140');
    end;

    [Test]
    procedure X116_RejectedInvoiceIsNotRecordedAlongsideEarlierOnes()
    var
        Composer: Codeunit "CG X116 Remittance Composer";
    begin
        // [SCENARIO] An invoice that is refused does not join the invoices already recorded
        Composer.AddInvoice('INV-3001', 250);
        asserterror Composer.AddInvoice(PadStr('TRYAL-REJECT-', 135, 'X'), 10.12);

        Assert.ExpectedError('140');
        Assert.AreEqual('INV-3001 250.00', Composer.GetRemittanceText(),
            'Expected only the earlier invoice in the remittance text');
    end;

    local procedure X116_TwoCharInvoiceNo(Index: Integer): Text
    begin
        if Index < 10 then
            exit('0' + Format(Index));
        exit(Format(Index));
    end;

    local procedure X116_SixCharInvoiceNo(Index: Integer): Text
    begin
        if Index < 10 then
            exit('INV-0' + Format(Index));
        exit('INV-' + Format(Index));
    end;

    local procedure X116_FiveCharInvoiceNo(Index: Integer): Text
    begin
        if Index < 10 then
            exit('INV0' + Format(Index));
        exit('INV' + Format(Index));
    end;

    local procedure X116_InvariantAmount(Value: Decimal): Text
    begin
        exit(Format(Value, 0, '<Precision,2:2><Standard Format,9>'));
    end;

    // ==========================================================
    // X148 - donor CG-AL-X148
    // ==========================================================

    local procedure X148_ClearAll()
    var
        Agreement: Record "CG X148 Volume Agreement";
        AgreementLine: Record "CG X148 Volume Agreement Line";
        RebateRate: Record "CG X148 Rebate Rate";
    begin
        Agreement.DeleteAll();
        AgreementLine.DeleteAll();
        RebateRate.DeleteAll();
    end;

    local procedure X148_SeedAgreement(No: Code[20]; CustomerNo: Code[20]; CurrencyCode: Code[10]; EffectiveDate: Date; Notes: Text[100]; RebateGroup: Code[10])
    var
        Agreement: Record "CG X148 Volume Agreement";
    begin
        Agreement.Init();
        Agreement."No." := No;
        Agreement."Customer No." := CustomerNo;
        Agreement."Currency Code" := CurrencyCode;
        Agreement."Effective Date" := EffectiveDate;
        Agreement.Notes := Notes;
        Agreement."Rebate Group" := RebateGroup;
        Agreement.Insert();
    end;

    local procedure X148_SeedRebateRate(RebateGroup: Code[10]; RebatePct: Decimal)
    var
        RebateRate: Record "CG X148 Rebate Rate";
    begin
        RebateRate.Init();
        RebateRate."Rebate Group" := RebateGroup;
        RebateRate."Rebate %" := RebatePct;
        RebateRate.Insert();
    end;

    local procedure X148_AssertLine(AgreementNo: Code[20]; ZoneCode: Code[10]; ExpectedCustomerNo: Code[20]; ExpectedCurrencyCode: Code[10]; ExpectedEffectiveDate: Date; ExpectedNotes: Text[100]; ExpectedRebateGroup: Code[10]; MessagePrefix: Text)
    var
        AgreementLine: Record "CG X148 Volume Agreement Line";
    begin
        Assert.IsTrue(AgreementLine.Get(AgreementNo, ZoneCode), MessagePrefix + ' - zone line exists');
        Assert.AreEqual(ExpectedCustomerNo, AgreementLine."Customer No.", MessagePrefix + ' - customer no');
        Assert.AreEqual(ExpectedCurrencyCode, AgreementLine."Currency Code", MessagePrefix + ' - currency code');
        Assert.AreEqual(ExpectedEffectiveDate, AgreementLine."Effective Date", MessagePrefix + ' - effective date');
        Assert.AreEqual(ExpectedNotes, AgreementLine.Notes, MessagePrefix + ' - notes');
        Assert.AreEqual(ExpectedRebateGroup, AgreementLine."Rebate Group", MessagePrefix + ' - rebate group');
    end;

    [Test]
    procedure X148_DistributeCopiesEveryAgreementFieldOntoEachZoneLine()
    var
        Distributor: Codeunit "CG X148 Agreement Distributor";
        Zones: List of [Code[10]];
    begin
        X148_ClearAll();
        X148_SeedAgreement('AGR1', 'CUST1', 'DKK', 20260115D, 'Key account, quarterly review', 'GRPA');
        Zones.Add('Z1');
        Zones.Add('Z2');

        Distributor.DistributeToZones('AGR1', Zones);

        X148_AssertLine('AGR1', 'Z1', 'CUST1', 'DKK', 20260115D, 'Key account, quarterly review', 'GRPA', 'The first zone line');
        X148_AssertLine('AGR1', 'Z2', 'CUST1', 'DKK', 20260115D, 'Key account, quarterly review', 'GRPA', 'The second zone line');
    end;

    [Test]
    procedure X148_AgreementWithARebateGroupPricesEveryZoneAtTheGroupsRate()
    var
        Distributor: Codeunit "CG X148 Agreement Distributor";
        Resolver: Codeunit "CG X148 Rebate Resolver";
        RebateRate: Record "CG X148 Rebate Rate";
        AgreementLine: Record "CG X148 Volume Agreement Line";
        Zones: List of [Code[10]];
    begin
        X148_ClearAll();
        X148_SeedRebateRate('GRPB', 12);
        X148_SeedRebateRate('SENTINEL', 77);
        X148_SeedAgreement('AGR2', 'CUST2', 'DKK', 20260201D, 'Spring campaign', 'GRPB');
        Zones.Add('Z1');
        Zones.Add('Z2');

        Distributor.DistributeToZones('AGR2', Zones);

        AgreementLine.Get('AGR2', 'Z1');
        Assert.AreEqual(12, Resolver.GetRebatePct(AgreementLine), 'The first zone of an agreement in a rebate group prices at the group''s own rate');
        AgreementLine.Get('AGR2', 'Z2');
        Assert.AreEqual(12, Resolver.GetRebatePct(AgreementLine), 'The second zone of an agreement in a rebate group prices at the group''s own rate');

        RebateRate.Get('SENTINEL');
        Assert.AreEqual(77, RebateRate."Rebate %", 'An unrelated rebate group''s own rate must not be touched by resolving a different group''s rate');
    end;

    [Test]
    procedure X148_AgreementWithNoRebateGroupPricesEveryZoneAtTheStandardRate()
    var
        Distributor: Codeunit "CG X148 Agreement Distributor";
        Resolver: Codeunit "CG X148 Rebate Resolver";
        AgreementLine: Record "CG X148 Volume Agreement Line";
        Zones: List of [Code[10]];
    begin
        X148_ClearAll();
        X148_SeedAgreement('AGR3', 'CUST3', 'DKK', 20260301D, 'No group, standard pricing', '');
        Zones.Add('Z1');

        Distributor.DistributeToZones('AGR3', Zones);

        AgreementLine.Get('AGR3', 'Z1');
        Assert.AreEqual(2.5, Resolver.GetRebatePct(AgreementLine), 'A zone of an agreement with no rebate group prices at the standard rebate');
    end;

    [Test]
    procedure X148_RebateGroupRateChangesAfterDistributionStillFlowThroughToPricing()
    var
        Distributor: Codeunit "CG X148 Agreement Distributor";
        Resolver: Codeunit "CG X148 Rebate Resolver";
        RebateRate: Record "CG X148 Rebate Rate";
        AgreementLine: Record "CG X148 Volume Agreement Line";
        Zones: List of [Code[10]];
    begin
        X148_ClearAll();
        X148_SeedRebateRate('GRPC', 8);
        X148_SeedAgreement('AGR4', 'CUST4', 'DKK', 20260401D, 'Autumn renewal', 'GRPC');
        Zones.Add('Z1');

        Distributor.DistributeToZones('AGR4', Zones);

        RebateRate.Get('GRPC');
        RebateRate."Rebate %" := 19;
        RebateRate.Modify();

        AgreementLine.Get('AGR4', 'Z1');
        Assert.AreEqual(19, Resolver.GetRebatePct(AgreementLine), 'A zone line prices at its rebate group''s current rate, not the rate in effect when it was distributed');
    end;

    [Test]
    procedure X148_DistributingOneAgreementDoesNotAffectAnotherAgreementsZoneLines()
    var
        Distributor: Codeunit "CG X148 Agreement Distributor";
        Zones: List of [Code[10]];
    begin
        X148_ClearAll();
        X148_SeedAgreement('AGR5', 'CUST5', 'DKK', 20260501D, 'North region', 'GRPD');
        X148_SeedAgreement('AGR6', 'CUST6', 'EUR', 20260601D, 'South region', 'GRPE');
        Zones.Add('ZX');

        Distributor.DistributeToZones('AGR5', Zones);
        Distributor.DistributeToZones('AGR6', Zones);

        X148_AssertLine('AGR5', 'ZX', 'CUST5', 'DKK', 20260501D, 'North region', 'GRPD', 'AGR5''s zone line after a second, unrelated agreement is also distributed');
        X148_AssertLine('AGR6', 'ZX', 'CUST6', 'EUR', 20260601D, 'South region', 'GRPE', 'AGR6''s own zone line');
    end;

    [Test]
    procedure X148_DistributeCreatesExactlyOneZoneLinePerRequestedZoneAndNoOthers()
    var
        Distributor: Codeunit "CG X148 Agreement Distributor";
        AgreementLine: Record "CG X148 Volume Agreement Line";
        Zones: List of [Code[10]];
    begin
        X148_ClearAll();
        X148_SeedAgreement('AGR7', 'CUST7', 'DKK', 20260701D, 'Rollout wave 1', '');
        Zones.Add('A');
        Zones.Add('B');
        Zones.Add('C');

        Distributor.DistributeToZones('AGR7', Zones);

        AgreementLine.SetRange("Agreement No.", 'AGR7');
        Assert.AreEqual(3, AgreementLine.Count(), 'Distributing to three zones creates exactly three zone lines');
        Assert.IsTrue(AgreementLine.Get('AGR7', 'A'), 'The first requested zone has a line');
        Assert.IsTrue(AgreementLine.Get('AGR7', 'B'), 'The second requested zone has a line');
        Assert.IsTrue(AgreementLine.Get('AGR7', 'C'), 'The third requested zone has a line');
        Assert.IsFalse(AgreementLine.Get('AGR7', 'D'), 'A zone that was never requested has no line');
    end;

    // ==========================================================
    // X151 - donor CG-AL-X151
    // ==========================================================

    local procedure X151_Initialize()
    var
        BlockEntry: Record "CG X151 Block Entry";
        BlockList: Codeunit "CG X151 Block List";
    begin
        BlockEntry.DeleteAll();
        BlockList.Invalidate();
    end;

    [Test]
    procedure X151_BlockingACodeTakesEffectImmediately()
    var
        BlockList: Codeunit "CG X151 Block List";
    begin
        X151_Initialize();

        Assert.IsFalse(BlockList.IsBlocked('ALPHA'), 'A code with no history must not be reported as blocked');

        BlockList.SetBlocked('ALPHA');

        Assert.IsTrue(BlockList.IsBlocked('ALPHA'), 'Blocking a code must be reported immediately');
    end;

    [Test]
    procedure X151_ClearingABlockedCodeMustStopReportingItAsBlocked()
    var
        BlockEntry: Record "CG X151 Block Entry";
        BlockList: Codeunit "CG X151 Block List";
    begin
        X151_Initialize();
        BlockList.SetBlocked('ALPHA');
        Assert.IsTrue(BlockList.IsBlocked('ALPHA'), 'Blocking a code must be reported immediately');

        BlockList.ClearBlocked('ALPHA');

        Assert.IsFalse(BlockList.IsBlocked('ALPHA'),
            'Clearing a code must stop it being reported as blocked, the same way blocking one starts it');

        BlockEntry.Get('ALPHA');
        Assert.IsFalse(BlockEntry.Blocked,
            'A cleared code must show as cleared on the block list itself');
    end;

    [Test]
    procedure X151_ClearingOneCodeLeavesAnotherBlockedCodeUntouched()
    var
        BlockList: Codeunit "CG X151 Block List";
    begin
        X151_Initialize();
        BlockList.SetBlocked('ALPHA');
        BlockList.SetBlocked('BETA');
        Assert.IsTrue(BlockList.IsBlocked('ALPHA'), 'ALPHA must be reported as blocked after being blocked');
        Assert.IsTrue(BlockList.IsBlocked('BETA'), 'BETA must be reported as blocked after being blocked');

        BlockList.ClearBlocked('BETA');

        Assert.IsTrue(BlockList.IsBlocked('ALPHA'), 'Clearing BETA must not change ALPHA''s blocked status');
        Assert.IsFalse(BlockList.IsBlocked('BETA'), 'BETA must stop being reported as blocked once it has been cleared');
    end;

    [Test]
    procedure X151_AChangeMadeOutsideEitherActionDoesNotShowUpOnItsOwn()
    var
        BlockEntry: Record "CG X151 Block Entry";
        BlockList: Codeunit "CG X151 Block List";
    begin
        X151_Initialize();
        BlockEntry.Init();
        BlockEntry."Code" := 'GAMMA';
        BlockEntry.Blocked := false;
        BlockEntry.Insert();

        Assert.IsFalse(BlockList.IsBlocked('GAMMA'),
            'GAMMA must not be reported as blocked before either action has ever run against it');

        BlockEntry.Get('GAMMA');
        BlockEntry.Blocked := true;
        BlockEntry.Modify();

        Assert.IsFalse(BlockList.IsBlocked('GAMMA'),
            'A record edited outside of SetBlocked and ClearBlocked is not expected to change what IsBlocked reports until one of those two actions runs');
    end;

    [Test]
    procedure X151_BlockingAgainAfterClearingTakesEffectImmediately()
    var
        BlockList: Codeunit "CG X151 Block List";
    begin
        X151_Initialize();
        BlockList.SetBlocked('DELTA');
        Assert.IsTrue(BlockList.IsBlocked('DELTA'), 'DELTA must be reported as blocked after being blocked');
        BlockList.ClearBlocked('DELTA');

        BlockList.SetBlocked('DELTA');

        Assert.IsTrue(BlockList.IsBlocked('DELTA'),
            'Blocking DELTA again must be reported immediately, even right after clearing it');
    end;

    [Test]
    procedure X151_ClearingACodeThatWasNeverBlockedLeavesItUnblocked()
    var
        BlockList: Codeunit "CG X151 Block List";
    begin
        X151_Initialize();
        Assert.IsFalse(BlockList.IsBlocked('EPSILON'), 'A code with no history must not be reported as blocked');

        BlockList.ClearBlocked('EPSILON');

        Assert.IsFalse(BlockList.IsBlocked('EPSILON'), 'Clearing a code that was never blocked must leave it unblocked');
    end;

    // ==========================================================
    // X163 - donor CG-AL-X163
    // ==========================================================

    local procedure X163_GetOtherCompanyName(): Text[30]
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

    local procedure X163_ClearHomeLedger()
    var
        Ledger: Record "CG X163 Branch Ledger";
    begin
        Ledger.DeleteAll();
    end;

    local procedure X163_ClearOtherLedger(OtherName: Text[30])
    var
        Ledger: Record "CG X163 Branch Ledger";
    begin
        Ledger.ChangeCompany(OtherName);
        Ledger.DeleteAll();
    end;

    local procedure X163_ClearQueryLog()
    var
        QueryLog: Record "CG X163 Query Log";
    begin
        QueryLog.DeleteAll();
    end;

    local procedure X163_ClearBoth(OtherName: Text[30])
    begin
        X163_ClearHomeLedger();
        X163_ClearOtherLedger(OtherName);
        X163_ClearQueryLog();
        Commit();
    end;

    [Test]
    procedure X163_TheGroupTotalCombinesEachBranchsOwnAmountForAnAccount()
    var
        OtherName: Text[30];
        Total: Decimal;
    begin
        OtherName := X163_GetOtherCompanyName();
        X163_ClearBoth(OtherName);

        LedgerMgt.SetAmount(CompanyName(), 'ACCT-A', 40.5);
        LedgerMgt.SetAmount(OtherName, 'ACCT-A', 27.25);

        Total := GroupTotals.GetGroupTotal('ACCT-A');

        X163_ClearBoth(OtherName);

        Assert.AreEqual(67.75, Total,
            'Expected the group total for the account to combine every branch''s own configured amount for it');
    end;

    [Test]
    procedure X163_AnAccountHeldOnlyByTheOtherBranchStillContributesItsFullAmount()
    var
        OtherName: Text[30];
        Total: Decimal;
    begin
        OtherName := X163_GetOtherCompanyName();
        X163_ClearBoth(OtherName);

        LedgerMgt.SetAmount(OtherName, 'ACCT-B', 18.75);

        Total := GroupTotals.GetGroupTotal('ACCT-B');

        X163_ClearBoth(OtherName);

        Assert.AreEqual(18.75, Total,
            'Expected an account configured only on the other branch to still contribute its full amount to the group total');
    end;

    [Test]
    procedure X163_AnAccountHeldOnlyByTheHomeBranchStillContributesItsFullAmount()
    var
        OtherName: Text[30];
        Total: Decimal;
    begin
        OtherName := X163_GetOtherCompanyName();
        X163_ClearBoth(OtherName);

        LedgerMgt.SetAmount(CompanyName(), 'ACCT-C', 30.0);

        Total := GroupTotals.GetGroupTotal('ACCT-C');

        X163_ClearBoth(OtherName);

        Assert.AreEqual(30.0, Total,
            'Expected an account configured only on the home branch to still contribute its full amount to the group total');
    end;

    [Test]
    procedure X163_TheGroupTotalForOneAccountIsNotContaminatedByAnotherAccountInTheSameBranch()
    var
        OtherName: Text[30];
        Total: Decimal;
    begin
        OtherName := X163_GetOtherCompanyName();
        X163_ClearBoth(OtherName);

        LedgerMgt.SetAmount(CompanyName(), 'ACCT-P', 12.0);
        LedgerMgt.SetAmount(CompanyName(), 'ACCT-Q', 999.0);

        Total := GroupTotals.GetGroupTotal('ACCT-P');

        X163_ClearBoth(OtherName);

        Assert.AreEqual(12.0, Total,
            'Expected the group total for one account to be unaffected by a different account configured in the same branch');
    end;

    [Test]
    procedure X163_AnAccountWithNoConfiguredAmountAnywhereTotalsToZero()
    var
        OtherName: Text[30];
        Total: Decimal;
    begin
        OtherName := X163_GetOtherCompanyName();
        X163_ClearBoth(OtherName);

        Total := GroupTotals.GetGroupTotal('ACCT-Z');

        X163_ClearBoth(OtherName);

        Assert.AreEqual(0.0, Total,
            'Expected an account with no configured amount on any branch to total to zero');
    end;

    [Test]
    procedure X163_EachBranchsConfiguredAmountIsStoredOnItsOwnRecordUnaffectedByTheOtherBranch()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        HomeLedger: Record "CG X163 Branch Ledger";
        OtherLedger: Record "CG X163 Branch Ledger";
        HomeDirect: Decimal;
        OtherDirect: Decimal;
    begin
        OtherName := X163_GetOtherCompanyName();
        HomeName := CompanyName();
        X163_ClearBoth(OtherName);

        LedgerMgt.SetAmount(HomeName, 'ACCT-M', 17.0);
        LedgerMgt.SetAmount(OtherName, 'ACCT-M', 9.0);

        HomeDirect := LedgerMgt.GetAmountDirect(HomeName, 'ACCT-M');
        OtherDirect := LedgerMgt.GetAmountDirect(OtherName, 'ACCT-M');

        HomeLedger.Get('ACCT-M');
        OtherLedger.ChangeCompany(OtherName);
        OtherLedger.Get('ACCT-M');

        X163_ClearBoth(OtherName);

        Assert.AreEqual(17.0, HomeDirect,
            'Expected the home branch''s configured amount to be unaffected by the other branch''s configured amount for the same account');
        Assert.AreEqual(9.0, OtherDirect,
            'Expected the other branch''s configured amount to reflect what it configured for itself');
        Assert.AreEqual(17.0, HomeLedger.Amount,
            'Expected the home branch''s amount to be persisted with its own value on its own record');
        Assert.AreEqual(9.0, OtherLedger.Amount,
            'Expected the other branch''s amount to be persisted with its own value on its own record');
    end;

    [Test]
    procedure X163_ABranchWithNoConfiguredAmountForAGivenAccountIsTreatedAsZero()
    var
        OtherName: Text[30];
        Direct: Decimal;
    begin
        OtherName := X163_GetOtherCompanyName();
        X163_ClearBoth(OtherName);

        Direct := LedgerMgt.GetAmountDirect(CompanyName(), 'ACCT-N');

        Assert.AreEqual(0.0, Direct,
            'Expected no configured amount for an account on a branch to read as zero rather than an arbitrary leftover value');
    end;
}
