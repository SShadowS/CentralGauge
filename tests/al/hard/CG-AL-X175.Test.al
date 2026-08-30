codeunit 89395 "CG-AL-X175 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    // This oracle merges four independent modules' test suites - costing,
    // loyalty eligibility, HTTP retry, and inventory adjustment posting -
    // into one codeunit. Every test and helper procedure is prefixed with
    // the module it belongs to (X066_, X072_, X082_, X139_) so identical
    // helper names across the four source suites (e.g. two different
    // "ClearAll"-shaped procedures) cannot collide.

    var
        Assert: Codeunit Assert;

    // ============================================================
    // X066 - Costing Engine (FIFO shipment costing / rounding)
    // ============================================================

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every test clears both tables
    // before seeding its own rows.

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

    // ============================================================
    // X072 - Loyalty Gatekeeper (event-subscriber eligibility)
    // ============================================================

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every test clears the table
    // before seeding its own rows.

    // DETERMINISM NOTE (read before re-probing or editing this oracle):
    // The starter's defect (codeunit "CG X072 Loyalty Rule VIP" assigns its
    // shared `var Eligible` parameter unconditionally instead of only
    // strengthening it) only produces an observable failure here if BC
    // dispatches "CG X072 Loyalty Rule Spend"'s subscriber BEFORE
    // "CG X072 Loyalty Rule VIP"'s on the container running this suite.
    // That dispatch order is real platform behavior BC does not guarantee.
    // Algebraically, under the flipped order (VIP fires first) an UNFIXED
    // candidate produces output IDENTICAL to the fix on every input this
    // suite exercises and passes all X072 tests - a false PASS, never a
    // false FAIL: "correct/" is order-independent by construction (both
    // fixed subscribers only ever set Eligible := true, which commutes
    // regardless of firing order), so its pass is never at risk here - only
    // a starter/candidate's fail is. Re-probe trigger fingerprint: an
    // all-green X072 section where failing/non-solving candidates diff as
    // no-ops against the starter's loyalty module signals dispatch order
    // flipped on that container, not that the trap stopped working.
    // Accepted residual, not caught by any test here: a buggy candidate
    // that renames or renumbers the VIP codeunit can incidentally change
    // its own subscriber-dispatch position and self-neutralize the defect
    // it was supposed to reproduce.

    local procedure X072_Seed(No: Code[20]; CustomerName: Text[100]; Spend: Decimal; VipOverride: Boolean)
    var
        Candidate: Record "CG X072 Loyalty Candidate";
    begin
        Candidate.Init();
        Candidate."No." := No;
        Candidate."Customer Name" := CustomerName;
        Candidate."Lifetime Spend" := Spend;
        Candidate."Manual VIP Override" := VipOverride;
        Candidate.Insert();
    end;

    local procedure X072_SeedApproved(No: Code[20]; CustomerName: Text[100]; Spend: Decimal; VipOverride: Boolean)
    var
        Candidate: Record "CG X072 Loyalty Candidate";
    begin
        Candidate.Init();
        Candidate."No." := No;
        Candidate."Customer Name" := CustomerName;
        Candidate."Lifetime Spend" := Spend;
        Candidate."Manual VIP Override" := VipOverride;
        Candidate."Priority Support Approved" := true;
        Candidate.Insert();
    end;

    local procedure X072_ApprovedOf(No: Code[20]): Boolean
    var
        Candidate: Record "CG X072 Loyalty Candidate";
    begin
        Candidate.Get(No);
        exit(Candidate."Priority Support Approved");
    end;

    [Test]
    procedure X072_QualifyingSpendAloneIsApprovedAlongsideANonQualifyingPeer()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
        Gatekeeper: Codeunit "CG X072 Loyalty Gatekeeper";
    begin
        Candidate.DeleteAll();
        X072_Seed('C001', 'Northwind Traders', 6000, false);
        X072_Seed('C002', 'Contoso Ltd', 100, false);

        Gatekeeper.EvaluateAllPending();

        Assert.IsTrue(X072_ApprovedOf('C001'), 'A candidate whose spend crosses the threshold must be approved even without the VIP override');
        Assert.IsFalse(X072_ApprovedOf('C002'), 'A candidate below the threshold and without the VIP override must stay unapproved');

        Candidate.Get('C001');
        Assert.AreEqual('Northwind Traders', Candidate."Customer Name", 'Evaluating a candidate must not change its recorded name');
        Assert.AreEqual(6000, Candidate."Lifetime Spend", 'Evaluating a candidate must not change its recorded spend');
    end;

    [Test]
    procedure X072_VipOverrideAloneIsApprovedBelowTheThreshold()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
        Gatekeeper: Codeunit "CG X072 Loyalty Gatekeeper";
    begin
        Candidate.DeleteAll();
        X072_Seed('C010', 'Fabrikam Inc', 100, true);

        Gatekeeper.EvaluateAllPending();

        Assert.IsTrue(X072_ApprovedOf('C010'), 'A candidate with the VIP override on must be approved even below the spend threshold');
    end;

    [Test]
    procedure X072_NeitherConditionStaysUnapproved()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
        Gatekeeper: Codeunit "CG X072 Loyalty Gatekeeper";
    begin
        Candidate.DeleteAll();
        X072_Seed('C020', 'Relecloud', 100, false);

        Gatekeeper.EvaluateAllPending();

        Assert.IsFalse(X072_ApprovedOf('C020'), 'A candidate meeting neither condition must stay unapproved');
    end;

    [Test]
    procedure X072_BothConditionsTogetherAreApproved()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
        Gatekeeper: Codeunit "CG X072 Loyalty Gatekeeper";
    begin
        Candidate.DeleteAll();
        X072_Seed('C030', 'Adatum Corp', 6000, true);

        Gatekeeper.EvaluateAllPending();

        Assert.IsTrue(X072_ApprovedOf('C030'), 'A candidate meeting both conditions must be approved');
    end;

    [Test]
    procedure X072_SpendThresholdBoundaryIsInclusive()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
        Gatekeeper: Codeunit "CG X072 Loyalty Gatekeeper";
    begin
        Candidate.DeleteAll();
        X072_Seed('C040', 'Tailspin Toys', 5000, false);
        X072_Seed('C041', 'Wingtip Toys', 4999.99, false);

        Gatekeeper.EvaluateAllPending();

        Assert.IsTrue(X072_ApprovedOf('C040'), 'A candidate whose spend exactly reaches the threshold must be approved');
        Assert.IsFalse(X072_ApprovedOf('C041'), 'A candidate one cent short of the threshold must stay unapproved');
    end;

    [Test]
    procedure X072_AlreadyDecidedCandidatesAreLeftAlone()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
        Gatekeeper: Codeunit "CG X072 Loyalty Gatekeeper";
    begin
        Candidate.DeleteAll();
        X072_SeedApproved('C050', 'Trey Research', 100, false);
        X072_Seed('C051', 'Litware Inc', 6000, true);

        Gatekeeper.EvaluateAllPending();

        Assert.IsTrue(X072_ApprovedOf('C050'), 'A candidate already marked approved must stay approved without being reconsidered');
        Assert.IsTrue(X072_ApprovedOf('C051'), 'A pending candidate meeting both conditions must still be approved');
    end;

    [Test]
    procedure X072_SingleCandidateEvaluationMatchesBatchEvaluation()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
        Gatekeeper: Codeunit "CG X072 Loyalty Gatekeeper";
    begin
        Candidate.DeleteAll();
        X072_Seed('C060', 'Proseware Inc', 5500, false);
        Candidate.Get('C060');

        Gatekeeper.EvaluateCandidate(Candidate);

        Assert.IsTrue(Candidate."Priority Support Approved", 'Evaluating a single candidate directly must approve one whose spend crosses the threshold');
        Assert.IsTrue(X072_ApprovedOf('C060'), 'The verdict from evaluating a single candidate must be persisted');
    end;

    // ============================================================
    // X082 - Resilient Http Client (retry / status classification)
    // ============================================================

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every test clears the log
    // table before exercising the objects under test.

    local procedure X082_ClearLog()
    var
        CallLog: Record "CG X082 Call Log";
    begin
        CallLog.DeleteAll();
    end;

    [Test]
    procedure X082_RefreshRateRecoversFromRepeatedServerErrorBursts()
    var
        CallLog: Record "CG X082 Call Log";
        Sync: Codeunit "CG X082 Exchange Rate Sync";
        MockHandler: Codeunit "CG-AL-X175 Mock Http Handler";
        Rate: Decimal;
    begin
        // [SCENARIO] A run of 503s followed by a 200 must still recover within the attempt budget
        X082_ClearLog();
        MockHandler.ScriptResponse(503, '{"rate": 7.25}');
        MockHandler.ScriptResponse(503, '{"rate": 7.25}');
        MockHandler.ScriptResponse(200, '{"rate": 7.25}');

        Assert.IsTrue(Sync.RefreshRate('USDEUR', MockHandler, Rate),
            'Expected RefreshRate to recover after two 503 responses and a final success, the same way it recovers from repeated 500s');
        Assert.AreEqual(7.25, Rate, 'Expected the rate from the final successful response');
        Assert.AreEqual(3, MockHandler.GetRequestCount(), 'Expected exactly three requests: two 503s that were retried and the 200 that finally succeeded');

        CallLog.FindLast();
        Assert.IsTrue(CallLog.Succeeded, 'Expected the call log entry to record success once the retries recovered');
        Assert.AreEqual(300, CallLog."Total Backoff (ms)", 'Expected the call log to record the backoff spent on the two retried attempts (100 + 200)');
    end;

    [Test]
    procedure X082_RefreshRateAlreadyRecoversFromTheFamiliarServerError()
    var
        CallLog: Record "CG X082 Call Log";
        Sync: Codeunit "CG X082 Exchange Rate Sync";
        MockHandler: Codeunit "CG-AL-X175 Mock Http Handler";
        Rate: Decimal;
    begin
        // [SCENARIO] Two 500s followed by a 200 recover correctly - the case that already works today
        X082_ClearLog();
        MockHandler.ScriptResponse(500, '{"rate": 1.0854}');
        MockHandler.ScriptResponse(500, '{"rate": 1.0854}');
        MockHandler.ScriptResponse(200, '{"rate": 1.0854}');

        Assert.IsTrue(Sync.RefreshRate('USDGBP', MockHandler, Rate),
            'Expected RefreshRate to recover after two 500 responses and a final success');
        Assert.AreEqual(1.0854, Rate, 'Expected the rate from the final successful response');
        Assert.AreEqual(3, MockHandler.GetRequestCount(), 'Expected exactly three requests for the two retried 500s and the successful 200');

        CallLog.FindLast();
        Assert.IsTrue(CallLog.Succeeded, 'Expected the call log entry to record success once the retries recovered');
        Assert.AreEqual(300, CallLog."Total Backoff (ms)", 'Expected the call log to record the backoff spent on the two retried attempts (100 + 200)');
    end;

    [Test]
    procedure X082_RefreshRateRecoversFromRateLimiting()
    var
        CallLog: Record "CG X082 Call Log";
        Sync: Codeunit "CG X082 Exchange Rate Sync";
        MockHandler: Codeunit "CG-AL-X175 Mock Http Handler";
        Rate: Decimal;
    begin
        // [SCENARIO] A rate-limited response followed by a 200 must recover the same way a 500 does
        X082_ClearLog();
        MockHandler.ScriptResponse(429, '{"rate": 143.5}');
        MockHandler.ScriptResponse(200, '{"rate": 143.5}');

        Assert.IsTrue(Sync.RefreshRate('USDJPY', MockHandler, Rate),
            'Expected RefreshRate to recover after a rate-limited response and a final success, the same way it recovers from a 500');
        Assert.AreEqual(143.5, Rate, 'Expected the rate from the final successful response');
        Assert.AreEqual(2, MockHandler.GetRequestCount(), 'Expected exactly two requests: the rate-limited one that was retried and the 200 that succeeded');

        CallLog.FindLast();
        Assert.IsTrue(CallLog.Succeeded, 'Expected the call log entry to record success once the retry recovered');
        Assert.AreEqual(100, CallLog."Total Backoff (ms)", 'Expected the call log to record the backoff spent on the single retried attempt');
    end;

    [Test]
    procedure X082_RefreshRateFailsWhenTheProviderNeverRecovers()
    var
        CallLog: Record "CG X082 Call Log";
        Sync: Codeunit "CG X082 Exchange Rate Sync";
        MockHandler: Codeunit "CG-AL-X175 Mock Http Handler";
        Rate: Decimal;
    begin
        // [SCENARIO] A provider that answers a server error for the whole attempt budget must report failure, not a stale or partial rate
        X082_ClearLog();
        MockHandler.ScriptResponse(503, '{"rate": 999}');
        Rate := 42.5;

        Assert.IsFalse(Sync.RefreshRate('USDNOK', MockHandler, Rate),
            'Expected RefreshRate to return false when the provider answers 503 for the whole attempt budget');
        Assert.AreEqual(0, Rate, 'Expected the rate to reset to 0, not the stale value it was preset to, when every attempt failed');

        CallLog.FindLast();
        Assert.IsFalse(CallLog.Succeeded, 'Expected the call log entry to record failure when the provider never recovered');
        Assert.AreEqual(1500, CallLog."Total Backoff (ms)", 'Expected the call log to record the backoff spent on all four retried attempts (100+200+400+800)');
    end;

    [Test]
    procedure X082_GivesUpImmediatelyOnANotFoundResponse()
    var
        Client: Codeunit "CG X082 Resilient Http Client";
        MockHandler: Codeunit "CG-AL-X175 Mock Http Handler";
        ResponseBody: Text;
    begin
        // [SCENARIO] A 404 must never be retried, even though a retry here would reach a 200
        MockHandler.ScriptResponse(404, '{"error":"not found"}');
        MockHandler.ScriptResponse(200, '{"rate": 999}');
        ResponseBody := 'stale value from a previous call';

        Assert.IsFalse(Client.GetWithRetry('https://rates.example.com/v1/latest?base=USDCHF', 3, MockHandler, ResponseBody),
            'Expected GetWithRetry to return false for a 404 - a permanent client error must not be retried, even though a retry here would have reached a 200');
        Assert.AreEqual(1, MockHandler.GetRequestCount(), 'Expected exactly one request for a 404 response - permanent errors are never retried');
        Assert.AreEqual('', ResponseBody, 'Expected the response body to end up empty after a 404, not the failed response body and not the stale value it was preset to');
        Assert.AreEqual(0, Client.GetTotalBackoffMs(), 'Expected no backoff on the tally when the call gives up without retrying');
    end;

    [Test]
    procedure X082_GivesUpImmediatelyOnABadRequestResponse()
    var
        Client: Codeunit "CG X082 Resilient Http Client";
        MockHandler: Codeunit "CG-AL-X175 Mock Http Handler";
        ResponseBody: Text;
    begin
        // [SCENARIO] A 400 must never be retried either
        MockHandler.ScriptResponse(400, '{"error":"bad request"}');
        MockHandler.ScriptResponse(200, '{"rate": 999}');
        ResponseBody := 'stale value from a previous call';

        Assert.IsFalse(Client.GetWithRetry('https://rates.example.com/v1/latest?base=USDCAD', 3, MockHandler, ResponseBody),
            'Expected GetWithRetry to return false for a 400 - a permanent client error must not be retried, even though a retry here would have reached a 200');
        Assert.AreEqual(1, MockHandler.GetRequestCount(), 'Expected exactly one request for a 400 response - permanent errors are never retried');
        Assert.AreEqual('', ResponseBody, 'Expected the response body to end up empty after a 400, not the stale value it was preset to');
        Assert.AreEqual(0, Client.GetTotalBackoffMs(), 'Expected no backoff on the tally when the call gives up without retrying');
    end;

    [Test]
    procedure X082_GivesUpImmediatelyJustBelowTheServerErrorRange()
    var
        Client: Codeunit "CG X082 Resilient Http Client";
        MockHandler: Codeunit "CG-AL-X175 Mock Http Handler";
        ResponseBody: Text;
    begin
        // [SCENARIO] 499 sits one below the server-error range and must never be retried
        MockHandler.ScriptResponse(499, '{"error":"client closed request"}');
        MockHandler.ScriptResponse(200, '{"rate": 999}');
        ResponseBody := 'stale value from a previous call';

        Assert.IsFalse(Client.GetWithRetry('https://rates.example.com/v1/latest?base=USDAUD', 3, MockHandler, ResponseBody),
            'Expected GetWithRetry to return false for a 499 - a permanent client error must not be retried, even though a retry here would have reached a 200');
        Assert.AreEqual(1, MockHandler.GetRequestCount(), 'Expected exactly one request for a 499 response - permanent errors are never retried');
        Assert.AreEqual('', ResponseBody, 'Expected the response body to end up empty after a 499, not the stale value it was preset to');
        Assert.AreEqual(0, Client.GetTotalBackoffMs(), 'Expected no backoff on the tally when the call gives up without retrying');
    end;

    [Test]
    procedure X082_GivesUpImmediatelyOnAMidRangeClientError()
    var
        Client: Codeunit "CG X082 Resilient Http Client";
        MockHandler: Codeunit "CG-AL-X175 Mock Http Handler";
        ResponseBody: Text;
    begin
        // [SCENARIO] 451 is a permanent client error and must never be retried, the same as 400 or 404
        MockHandler.ScriptResponse(451, '{"error":"unavailable for legal reasons"}');
        MockHandler.ScriptResponse(200, '{"rate": 999}');
        ResponseBody := 'stale value from a previous call';

        Assert.IsFalse(Client.GetWithRetry('https://rates.example.com/v1/latest?base=USDNZD', 3, MockHandler, ResponseBody),
            'Expected GetWithRetry to return false for a 451 - a permanent client error must not be retried, even though a retry here would have reached a 200');
        Assert.AreEqual(1, MockHandler.GetRequestCount(), 'Expected exactly one request for a 451 response - permanent errors are never retried');
        Assert.AreEqual('', ResponseBody, 'Expected the response body to end up empty after a 451, not the stale value it was preset to');
        Assert.AreEqual(0, Client.GetTotalBackoffMs(), 'Expected no backoff on the tally when the call gives up without retrying');
    end;

    [Test]
    procedure X082_RecoversFromALessCommonServerErrorCode()
    var
        Client: Codeunit "CG X082 Resilient Http Client";
        MockHandler: Codeunit "CG-AL-X175 Mock Http Handler";
        ResponseBody: Text;
    begin
        // [SCENARIO] 501 is just as much a server error as 500 or 503 and must recover the same way
        MockHandler.ScriptResponse(501, '');
        MockHandler.ScriptResponse(501, '');
        MockHandler.ScriptResponse(200, 'third-time-lucky');

        Assert.IsTrue(Client.GetWithRetry('https://rates.example.com/v1/latest?base=EURNOK', 5, MockHandler, ResponseBody),
            'Expected GetWithRetry to recover after two 501 responses and a final 200 - every server error status is worth retrying');
        Assert.AreEqual('third-time-lucky', ResponseBody, 'Expected the body of the third (successful) response');
        Assert.AreEqual(3, MockHandler.GetRequestCount(), 'Expected exactly three requests for the two retried 501s and the successful 200');
        Assert.AreEqual(300, Client.GetTotalBackoffMs(), 'Expected the backoff tally for two retries to be 100 ms + 200 ms = 300 ms');
    end;

    [Test]
    procedure X082_RecoversFromTheHighestServerErrorCode()
    var
        Client: Codeunit "CG X082 Resilient Http Client";
        MockHandler: Codeunit "CG-AL-X175 Mock Http Handler";
        ResponseBody: Text;
    begin
        // [SCENARIO] 599 sits at the top of the server-error range and must recover exactly like 500 does
        MockHandler.ScriptResponse(599, '');
        MockHandler.ScriptResponse(200, 'recovered-after-599');

        Assert.IsTrue(Client.GetWithRetry('https://rates.example.com/v1/latest?base=EURSEK', 3, MockHandler, ResponseBody),
            'Expected GetWithRetry to recover after a 599 response and a final 200');
        Assert.AreEqual('recovered-after-599', ResponseBody, 'Expected the body of the successful response');
        Assert.AreEqual(2, MockHandler.GetRequestCount(), 'Expected exactly two requests: the retried 599 and the successful 200');
        Assert.AreEqual(100, Client.GetTotalBackoffMs(), 'Expected the backoff tally for one retry to be 100 ms');
    end;

    [Test]
    procedure X082_RecoversFromEveryServerErrorStatusInTheFullRange()
    var
        Client: Codeunit "CG X082 Resilient Http Client";
        MockHandler: Codeunit "CG-AL-X175 Mock Http Handler";
        ResponseBody: Text;
        Status: Integer;
        PriorRequestCount: Integer;
    begin
        // [SCENARIO] Every status in 500-599 is transient and recovers within the attempt budget
        for Status := 500 to 599 do begin
            PriorRequestCount := MockHandler.GetRequestCount();
            MockHandler.ScriptResponse(Status, '');
            MockHandler.ScriptResponse(Status, '');
            MockHandler.ScriptResponse(200, 'recovered');

            Assert.IsTrue(Client.GetWithRetry(StrSubstNo('https://rates.example.com/v1/latest?base=EUR%1', Status), 5, MockHandler, ResponseBody),
                StrSubstNo('Expected GetWithRetry to recover after two %1 responses and a final 200', Status));
            Assert.AreEqual('recovered', ResponseBody,
                StrSubstNo('Expected the body of the successful response after two %1 responses', Status));
            Assert.AreEqual(3, MockHandler.GetRequestCount() - PriorRequestCount,
                StrSubstNo('Expected exactly three requests for two retried %1 responses and the successful 200', Status));
            Assert.AreEqual(300, Client.GetTotalBackoffMs(),
                StrSubstNo('Expected the backoff tally for two retries after a %1 to be 100 ms + 200 ms = 300 ms', Status));
        end;
    end;

    [Test]
    procedure X082_SucceedsImmediatelyOnAnyTwoHundredStatus()
    var
        Client: Codeunit "CG X082 Resilient Http Client";
        MockHandler: Codeunit "CG-AL-X175 Mock Http Handler";
        SuccessStatuses: List of [Integer];
        SuccessStatus: Integer;
        ResponseBody: Text;
        PriorRequestCount: Integer;
    begin
        // [SCENARIO] Any status in the 2xx class succeeds on the first attempt, not only 200
        SuccessStatuses.Add(200);
        SuccessStatuses.Add(204);
        SuccessStatuses.Add(299);

        foreach SuccessStatus in SuccessStatuses do begin
            PriorRequestCount := MockHandler.GetRequestCount();
            MockHandler.ScriptResponse(SuccessStatus, StrSubstNo('payload-%1', SuccessStatus));

            Assert.IsTrue(Client.GetWithRetry(StrSubstNo('https://rates.example.com/v1/latest?base=EUR%1', SuccessStatus), 3, MockHandler, ResponseBody),
                StrSubstNo('Expected GetWithRetry to return true for a %1 response - any status in the 2xx class is a success', SuccessStatus));
            Assert.AreEqual(StrSubstNo('payload-%1', SuccessStatus), ResponseBody,
                StrSubstNo('Expected the response body to carry the body of the successful %1 response unchanged', SuccessStatus));
            Assert.AreEqual(1, MockHandler.GetRequestCount() - PriorRequestCount,
                StrSubstNo('Expected exactly one request when the first attempt already succeeded with a %1', SuccessStatus));
            Assert.AreEqual(0, Client.GetTotalBackoffMs(),
                StrSubstNo('Expected a backoff tally of 0 when the first attempt already succeeded with a %1', SuccessStatus));
        end;
    end;

    [Test]
    procedure X082_ASingleAllowedAttemptMeansNoRetryEvenForAServerError()
    var
        Client: Codeunit "CG X082 Resilient Http Client";
        MockHandler: Codeunit "CG-AL-X175 Mock Http Handler";
        ResponseBody: Text;
    begin
        // [SCENARIO] MaxAttempts = 1 against a server error sends one request - an off-by-one retry would hit the scripted 200
        MockHandler.ScriptResponse(503, '');
        MockHandler.ScriptResponse(200, 'unreachable-success-body');
        ResponseBody := 'stale value from a previous call';

        Assert.IsFalse(Client.GetWithRetry('https://rates.example.com/v1/latest?base=EURHUF', 1, MockHandler, ResponseBody),
            'Expected GetWithRetry to return false when MaxAttempts is 1 and the only attempt gets a server error');
        Assert.AreEqual(1, MockHandler.GetRequestCount(), 'Expected exactly one request when MaxAttempts is 1 - the transient error leaves no budget for a retry');
        Assert.AreEqual('', ResponseBody, 'Expected the response body to end up empty when the single allowed attempt failed');
    end;

    [Test]
    procedure X082_BackoffTallyStartsFreshOnEveryCall()
    var
        Client: Codeunit "CG X082 Resilient Http Client";
        MockHandler: Codeunit "CG-AL-X175 Mock Http Handler";
        ResponseBody: Text;
    begin
        // [SCENARIO] A second call on the same client instance reports its own tally, not a running total from the first call
        MockHandler.ScriptResponse(500, 'warm-up-body');
        MockHandler.ScriptResponse(200, 'warm-up-body');
        Client.GetWithRetry('https://rates.example.com/v1/latest?base=EURCZK', 3, MockHandler, ResponseBody);
        Assert.AreEqual(100, Client.GetTotalBackoffMs(), 'Expected the first call, which retried once, to report a backoff tally of 100 ms');

        MockHandler.ScriptResponse(200, 'second-call-body');
        Client.GetWithRetry('https://rates.example.com/v1/latest?base=EURCZK', 3, MockHandler, ResponseBody);

        Assert.AreEqual(0, Client.GetTotalBackoffMs(), 'Expected the second call, which never retried, to report a backoff tally of 0 - not the 100 ms left over from the first call');
        Assert.AreEqual(3, MockHandler.GetRequestCount(), 'Expected three requests in total: two for the first call (500 then 200) and one for the second (200)');
    end;

    [Test]
    procedure X082_AttemptsThatReportNoStatusAreNeverTreatedAsARepeatOfTheAttemptBeforeThem()
    var
        Client: Codeunit "CG X082 Resilient Http Client";
        Handler: Codeunit "CG-AL-X175 NoStatus Handler";
        ResponseBody: Text;
    begin
        // [SCENARIO] A retried attempt whose handler swallows an internal error and reports no status must be judged on its own, not on whatever status the attempt before it happened to report
        Assert.IsFalse(Client.GetWithRetry('https://rates.example.com/v1/latest?base=USDPLN', 3, Handler, ResponseBody),
            'Expected GetWithRetry to return false once an attempt reports no status at all');
        Assert.AreEqual(2, Handler.GetRequestCount(), 'Expected exactly two requests: the retried 500 and the follow-up attempt that reported no status - a request reporting nothing must not be mistaken for another 500 and retried again');
        Assert.AreEqual(100, Client.GetTotalBackoffMs(), 'Expected the backoff tally for exactly one retry to be 100 ms, not the extra retry a status carried over from the previous attempt would trigger');
        Assert.AreEqual('', ResponseBody, 'Expected the response body to end up empty when no attempt ever succeeded');
    end;

    // ============================================================
    // X139 - Adjustment Poster (stock transfer dispatch)
    // ============================================================

    // The default test isolation persists writes between test methods, so
    // every test clears its own tables before seeding its own rows.

    local procedure X139_ClearAll()
    var
        AdjLine: Record "CG X139 Adjustment Line";
        LedgerEntry: Record "CG X139 Item Ledger Entry";
        Balance: Record "CG X139 Item Balance";
    begin
        AdjLine.DeleteAll();
        LedgerEntry.DeleteAll();
        Balance.DeleteAll();
    end;

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

    local procedure X139_AssertNoBalanceRecord(ItemNo: Code[20]; LocationCode: Code[10]; MessagePrefix: Text)
    var
        Balance: Record "CG X139 Item Balance";
    begin
        Assert.IsFalse(Balance.Get(ItemNo, LocationCode), MessagePrefix + ' - no balance record expected');
    end;

    local procedure X139_AssertLedgerEntry(DocumentNo: Code[20]; LineNo: Integer; LocationCode: Code[10]; ItemNo: Code[20]; ExpectedQuantity: Decimal; MessagePrefix: Text)
    var
        LedgerEntry: Record "CG X139 Item Ledger Entry";
    begin
        LedgerEntry.SetRange("Document No.", DocumentNo);
        LedgerEntry.SetRange("Line No.", LineNo);
        LedgerEntry.SetRange("Location Code", LocationCode);
        LedgerEntry.SetRange(Quantity, ExpectedQuantity);
        Assert.IsTrue(LedgerEntry.FindFirst(), MessagePrefix + ' - ledger entry exists with the expected quantity');
        Assert.AreEqual(ItemNo, LedgerEntry."Item No.", MessagePrefix + ' - ledger entry item no');
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
        X139_ClearAll();
        X139_SeedBalance('ITM1', 'BLUE', 10);
        X139_SeedBalance('SENTINEL', 'SENTLOC', 999);
        X139_SeedLine('DOC1', 10, "CG X139 Adjustment Type"::Increase, 'ITM1', 'BLUE', '', 5);

        Poster.PostAdjustments('DOC1');

        X139_AssertLedgerEntry('DOC1', 10, 'BLUE', 'ITM1', 5, 'An increase line logs a positive entry');
        X139_AssertBalance('ITM1', 'BLUE', 15, 'An increase line adds to the existing balance');
        X139_AssertBalance('SENTINEL', 'SENTLOC', 999, 'An unrelated balance must not be touched by posting a different item');
    end;

    [Test]
    procedure X139_DecreaseLineSubtractsQuantityFromBalance()
    var
        Poster: Codeunit "CG X139 Adjustment Poster";
    begin
        X139_ClearAll();
        X139_SeedBalance('ITM2', 'BLUE', 20);
        X139_SeedLine('DOC1', 10, "CG X139 Adjustment Type"::Decrease, 'ITM2', 'BLUE', '', 8);

        Poster.PostAdjustments('DOC1');

        X139_AssertLedgerEntry('DOC1', 10, 'BLUE', 'ITM2', -8, 'A decrease line logs a negative entry');
        X139_AssertBalance('ITM2', 'BLUE', 12, 'A decrease line subtracts from the existing balance');
    end;

    [Test]
    procedure X139_RevalueLineSetsBalanceToTheCountedQuantity()
    var
        Poster: Codeunit "CG X139 Adjustment Poster";
    begin
        X139_ClearAll();
        X139_SeedBalance('ITM3', 'BLUE', 30);
        X139_SeedLine('DOC1', 10, "CG X139 Adjustment Type"::Revalue, 'ITM3', 'BLUE', '', 50);

        Poster.PostAdjustments('DOC1');

        X139_AssertLedgerEntry('DOC1', 10, 'BLUE', 'ITM3', 20, 'A revalue line logs only the difference from the prior balance');
        X139_AssertBalance('ITM3', 'BLUE', 50, 'A revalue line sets the balance to the counted quantity, not to the difference');
    end;

    [Test]
    procedure X139_RevalueLineWithNoPriorBalanceTreatsCurrentQuantityAsZero()
    var
        Poster: Codeunit "CG X139 Adjustment Poster";
    begin
        X139_ClearAll();
        X139_SeedLine('DOC1', 10, "CG X139 Adjustment Type"::Revalue, 'ITM4', 'BLUE', '', 12);

        Poster.PostAdjustments('DOC1');

        X139_AssertLedgerEntry('DOC1', 10, 'BLUE', 'ITM4', 12, 'A revalue line with no prior balance logs the full counted quantity');
        X139_AssertBalance('ITM4', 'BLUE', 12, 'A revalue line with no prior balance sets it to the counted quantity');
    end;

    [Test]
    procedure X139_TransferLineMovesQuantityBetweenTwoLocations()
    var
        Poster: Codeunit "CG X139 Adjustment Poster";
    begin
        X139_ClearAll();
        X139_SeedBalance('ITM5', 'BLUE', 40);
        X139_SeedBalance('ITM5', 'RED', 5);
        X139_SeedBalance('SENTINEL', 'SENTLOC', 999);
        X139_SeedLine('DOC1', 10, "CG X139 Adjustment Type"::Transfer, 'ITM5', 'BLUE', 'RED', 15);

        Poster.PostAdjustments('DOC1');

        X139_AssertLedgerEntry('DOC1', 10, 'BLUE', 'ITM5', -15, 'A transfer line logs a negative entry at the source location');
        X139_AssertLedgerEntry('DOC1', 10, 'RED', 'ITM5', 15, 'A transfer line logs a positive entry at the destination location');
        X139_AssertLedgerEntryCountForLine('DOC1', 10, 2, 'A transfer line logs exactly one entry per location');
        X139_AssertBalance('ITM5', 'BLUE', 25, 'A transfer line reduces the source location''s balance');
        X139_AssertBalance('ITM5', 'RED', 20, 'A transfer line increases the destination location''s balance');
        X139_AssertBalance('SENTINEL', 'SENTLOC', 999, 'An unrelated balance must not be touched by posting a transfer');
    end;

    [Test]
    procedure X139_TransferLineWithZeroQuantityStillRecordsBothLocations()
    var
        Poster: Codeunit "CG X139 Adjustment Poster";
    begin
        X139_ClearAll();
        X139_SeedBalance('ITM6', 'BLUE', 7);
        X139_SeedLine('DOC1', 10, "CG X139 Adjustment Type"::Transfer, 'ITM6', 'BLUE', 'RED', 0);

        Poster.PostAdjustments('DOC1');

        X139_AssertLedgerEntry('DOC1', 10, 'BLUE', 'ITM6', 0, 'A zero-quantity transfer still logs the source location');
        X139_AssertLedgerEntry('DOC1', 10, 'RED', 'ITM6', 0, 'A zero-quantity transfer still logs the destination location');
        X139_AssertLedgerEntryCountForLine('DOC1', 10, 2, 'A zero-quantity transfer still logs one entry per location');
        X139_AssertBalance('ITM6', 'BLUE', 7, 'A zero-quantity transfer leaves the source balance unchanged');
        X139_AssertBalance('ITM6', 'RED', 0, 'A zero-quantity transfer still records the destination location''s balance');
    end;

    [Test]
    procedure X139_TransferLineBetweenTheSameLocationNetsToNoChange()
    var
        Poster: Codeunit "CG X139 Adjustment Poster";
    begin
        X139_ClearAll();
        X139_SeedBalance('ITM7', 'BLUE', 22);
        X139_SeedLine('DOC1', 10, "CG X139 Adjustment Type"::Transfer, 'ITM7', 'BLUE', 'BLUE', 9);

        Poster.PostAdjustments('DOC1');

        X139_AssertLedgerEntry('DOC1', 10, 'BLUE', 'ITM7', -9, 'A same-location transfer still logs the outgoing move');
        X139_AssertLedgerEntry('DOC1', 10, 'BLUE', 'ITM7', 9, 'A same-location transfer still logs the incoming move');
        X139_AssertLedgerEntryCountForLine('DOC1', 10, 2, 'A same-location transfer still logs one entry per side of the move');
        X139_AssertBalance('ITM7', 'BLUE', 22, 'A same-location transfer leaves the net balance unchanged');
    end;

    [Test]
    procedure X139_PostAdjustmentsOnlyPostsLinesForTheRequestedDocument()
    var
        Poster: Codeunit "CG X139 Adjustment Poster";
    begin
        X139_ClearAll();
        X139_SeedLine('DOC1', 10, "CG X139 Adjustment Type"::Increase, 'ITM8', 'BLUE', '', 6);
        X139_SeedLine('DOC2', 10, "CG X139 Adjustment Type"::Increase, 'ITM8', 'RED', '', 40);

        Poster.PostAdjustments('DOC1');

        X139_AssertBalance('ITM8', 'BLUE', 6, 'The requested document''s line posts');
        X139_AssertNoBalanceRecord('ITM8', 'RED', 'A different document''s line must not be posted');
        X139_AssertLedgerEntryCountForLine('DOC2', 10, 0, 'A different document''s line must not log any entry');
    end;

    [Test]
    procedure X139_MixedDocumentPostsEveryLineTypeCorrectly()
    var
        Poster: Codeunit "CG X139 Adjustment Poster";
    begin
        X139_ClearAll();
        X139_SeedBalance('ITM9A', 'BLUE', 10);
        X139_SeedBalance('ITM9B', 'BLUE', 20);
        X139_SeedBalance('ITM9C', 'BLUE', 30);
        X139_SeedBalance('ITM9D', 'BLUE', 40);
        X139_SeedBalance('ITM9D', 'RED', 4);
        X139_SeedLine('DOC1', 10, "CG X139 Adjustment Type"::Increase, 'ITM9A', 'BLUE', '', 5);
        X139_SeedLine('DOC1', 20, "CG X139 Adjustment Type"::Decrease, 'ITM9B', 'BLUE', '', 5);
        X139_SeedLine('DOC1', 30, "CG X139 Adjustment Type"::Revalue, 'ITM9C', 'BLUE', '', 100);
        X139_SeedLine('DOC1', 40, "CG X139 Adjustment Type"::Transfer, 'ITM9D', 'BLUE', 'RED', 10);

        Poster.PostAdjustments('DOC1');

        X139_AssertBalance('ITM9A', 'BLUE', 15, 'The increase line on the mixed document still posts correctly');
        X139_AssertBalance('ITM9B', 'BLUE', 15, 'The decrease line on the mixed document still posts correctly');
        X139_AssertBalance('ITM9C', 'BLUE', 100, 'The revalue line on the mixed document still posts correctly');
        X139_AssertBalance('ITM9D', 'BLUE', 30, 'The transfer line''s source location posts correctly on the mixed document');
        X139_AssertBalance('ITM9D', 'RED', 14, 'The transfer line''s destination location posts correctly on the mixed document');
        X139_AssertLedgerEntryCountForLine('DOC1', 40, 2, 'The transfer line on the mixed document still logs one entry per location');
    end;

    [Test]
    procedure X139_GetBalanceWithNoRecordedQuantityReturnsZero()
    var
        Poster: Codeunit "CG X139 Adjustment Poster";
    begin
        X139_ClearAll();
        Assert.AreEqual(0, Poster.GetBalance('ITM-NONE', 'NOWHERE'), 'An item and location with no recorded balance reports zero');
    end;

    [Test]
    procedure X139_TwoTransferLinesOnOneDocumentBothPostIndependently()
    var
        Poster: Codeunit "CG X139 Adjustment Poster";
    begin
        X139_ClearAll();
        X139_SeedBalance('ITM10', 'BLUE', 50);
        X139_SeedBalance('ITM10', 'RED', 0);
        X139_SeedLine('DOC1', 10, "CG X139 Adjustment Type"::Transfer, 'ITM10', 'BLUE', 'RED', 12);
        X139_SeedLine('DOC1', 20, "CG X139 Adjustment Type"::Transfer, 'ITM10', 'BLUE', 'RED', 8);

        Poster.PostAdjustments('DOC1');

        X139_AssertLedgerEntry('DOC1', 10, 'BLUE', 'ITM10', -12, 'The first transfer line logs its own source entry');
        X139_AssertLedgerEntry('DOC1', 20, 'BLUE', 'ITM10', -8, 'The second transfer line logs its own source entry, not the first line''s');
        X139_AssertLedgerEntry('DOC1', 10, 'RED', 'ITM10', 12, 'The first transfer line logs its own destination entry');
        X139_AssertLedgerEntry('DOC1', 20, 'RED', 'ITM10', 8, 'The second transfer line logs its own destination entry, not the first line''s');
        X139_AssertBalance('ITM10', 'BLUE', 30, 'Both transfer lines'' outgoing moves accumulate on the source balance');
        X139_AssertBalance('ITM10', 'RED', 20, 'Both transfer lines'' incoming moves accumulate on the destination balance');
    end;
}
