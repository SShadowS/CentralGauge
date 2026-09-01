codeunit 89494 "CG-AL-X272 Test"
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
        // every test clears the table before seeding its own rows.
        // every test clears both tables before seeding its own rows.
        // A block list kept in memory for the rest of the session does not roll
        // back with the test transaction, so every test clears both the table
        // and that in-memory copy before seeding its own data.
        // (measured, SOAP runner), so every test clears the table before
        // seeding its own rows.
        // every test clears its own tables before seeding its own rows.

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
    // X105 - donor CG-AL-X105
    // ==========================================================

    local procedure X105_Seed(EntryNo: Integer; ApproverID: Code[20]; EntryStatus: Enum "CG X105 Approval Status"; AmountLimit: Integer)
    var
        Entry: Record "CG X105 Approval Entry";
    begin
        Entry.Init();
        Entry."Entry No." := EntryNo;
        Entry."Approver ID" := ApproverID;
        Entry.Status := EntryStatus;
        Entry."Amount Limit" := AmountLimit;
        Entry.Insert();
    end;

    [Test]
    procedure X105_ApprovedEntrySurvivesAnOlderRejectedEntry()
    var
        Entry: Record "CG X105 Approval Entry";
        ApprovalLookup: Codeunit "CG X105 Approval Lookup";
    begin
        Entry.DeleteAll();
        X105_Seed(1, 'APP1', Entry.Status::Rejected, 100);
        X105_Seed(2, 'APP1', Entry.Status::Approved, 5000);

        Assert.IsTrue(ApprovalLookup.GetApprovalLimit('APP1', Entry), 'An approver with an approved entry must be found');
        Assert.AreEqual(Entry.Status::Approved, Entry.Status, 'The returned entry must be the approved one, not the rejected one');
        Assert.AreEqual(5000, Entry."Amount Limit", 'The returned entry must carry the approved limit, not the rejected one');

        Entry.Reset();
        Assert.AreEqual(2, Entry.Count(), 'Looking up an approver must not change the recorded approval history');
    end;

    [Test]
    procedure X105_GuardAuthorizesUpToTheApprovedLimit()
    var
        Entry: Record "CG X105 Approval Entry";
        Guard: Codeunit "CG X105 Spend Guard";
    begin
        Entry.DeleteAll();
        X105_Seed(10, 'APP1', Entry.Status::Rejected, 100);
        X105_Seed(11, 'APP1', Entry.Status::Approved, 5000);

        Assert.IsTrue(Guard.IsWithinLimit('APP1', 5000), 'A request at the approved limit must be authorized');
        Assert.IsFalse(Guard.IsWithinLimit('APP1', 5001), 'A request over the approved limit must be denied');
    end;

    [Test]
    procedure X105_SingleApprovedEntryIsFoundDirectly()
    var
        Entry: Record "CG X105 Approval Entry";
        ApprovalLookup: Codeunit "CG X105 Approval Lookup";
    begin
        Entry.DeleteAll();
        X105_Seed(20, 'APP2', Entry.Status::Approved, 3000);

        Assert.IsTrue(ApprovalLookup.GetApprovalLimit('APP2', Entry), 'An approver with only an approved entry must be found');
        Assert.AreEqual(3000, Entry."Amount Limit", 'The only entry on file must be returned as-is');
    end;

    [Test]
    procedure X105_PendingOnlyApproverHasNoApprovedLimit()
    var
        Entry: Record "CG X105 Approval Entry";
        ApprovalLookup: Codeunit "CG X105 Approval Lookup";
        Guard: Codeunit "CG X105 Spend Guard";
    begin
        Entry.DeleteAll();
        X105_Seed(30, 'APP5', Entry.Status::Pending, 9999);

        Assert.IsFalse(ApprovalLookup.GetApprovalLimit('APP5', Entry), 'An approver with only a pending entry has no approved limit');
        Assert.IsFalse(Guard.IsWithinLimit('APP5', 1), 'A pending-only approver must not authorize any request');
    end;

    [Test]
    procedure X105_UnrelatedApproversAreNotMixedUp()
    var
        Entry: Record "CG X105 Approval Entry";
        ApprovalLookup: Codeunit "CG X105 Approval Lookup";
    begin
        Entry.DeleteAll();
        X105_Seed(40, 'APP1', Entry.Status::Rejected, 100);
        X105_Seed(41, 'APP1', Entry.Status::Approved, 5000);
        X105_Seed(42, 'APP3', Entry.Status::Rejected, 777);
        X105_Seed(43, 'APP6', Entry.Status::Approved, 4200);

        Assert.IsFalse(ApprovalLookup.GetApprovalLimit('APP3', Entry), 'APP3 has no approved entry of its own and must not pick up another approver''s');
        Assert.IsTrue(ApprovalLookup.GetApprovalLimit('APP6', Entry), 'APP6 has its own approved entry and must be found');
        Assert.AreEqual(4200, Entry."Amount Limit", 'APP6''s own limit must be returned, not another approver''s');
    end;

    [Test]
    procedure X105_ApprovedEntryIsFoundWhateverTheCallerWasViewing()
    var
        Entry: Record "CG X105 Approval Entry";
        ApprovalLookup: Codeunit "CG X105 Approval Lookup";
    begin
        Entry.DeleteAll();
        X105_Seed(50, 'APP7', Entry.Status::Rejected, 111);
        X105_Seed(51, 'APP7', Entry.Status::Approved, 7700);

        // The caller arrives holding a narrowed view of its own record that
        // excludes the approved entry. A lookup answers a question about the
        // approver, so what the caller happened to be looking at beforehand
        // must not change the answer.
        Entry.SetRange("Entry No.", 50, 50);

        Assert.IsTrue(ApprovalLookup.GetApprovalLimit('APP7', Entry), 'APP7 has its own approved entry and must be found however the caller''s record was set up beforehand');
        Assert.AreEqual(7700, Entry."Amount Limit", 'The approved limit must be returned even though the caller''s own filter excluded that row');
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
    // X152 - donor CG-AL-X152
    // ==========================================================

    [Test]
    procedure X152_ImportingUniqueSettingsSavesEveryEntry()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P1', 'retries=3;timeout=30;endpoint=https://api.example.com');

        Assert.AreEqual('3', ConfigImporter.GetSetting('P1', 'retries'), 'A plain config with no repeated setting must save every entry.');
        Assert.AreEqual('30', ConfigImporter.GetSetting('P1', 'timeout'), 'A plain config with no repeated setting must save every entry.');
        Assert.AreEqual('https://api.example.com', ConfigImporter.GetSetting('P1', 'endpoint'), 'A plain config with no repeated setting must save every entry.');
    end;

    [Test]
    procedure X152_BlankSegmentsAreSkippedAndAnEmptyValueIsKept()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P2', ';present=set;;flag=;   ;another=data;');

        Setting.SetRange("Profile Code", 'P2');
        Assert.AreEqual(3, Setting.Count(), 'Blank and all-space segments must not produce extra saved settings.');
        Assert.AreEqual('set', ConfigImporter.GetSetting('P2', 'present'), 'A normal entry around blank segments must still save correctly.');
        Assert.IsTrue(ConfigImporter.SettingExists('P2', 'flag'), 'An entry with no value after the equals sign is still a valid setting.');
        Assert.AreEqual('', ConfigImporter.GetSetting('P2', 'flag'), 'An entry with no value after the equals sign must save as an empty value, not be dropped.');
        Assert.AreEqual('data', ConfigImporter.GetSetting('P2', 'another'), 'An entry following blank segments must still save correctly.');
    end;

    [Test]
    procedure X152_ARepeatedSettingAtTheEndOfTheStringKeepsTheLastValue()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P3', 'code=1;code=2;code=3');

        Assert.AreEqual('3', ConfigImporter.GetSetting('P3', 'code'), 'When a setting is listed three times, the last-listed value must be the one that is saved.');
    end;

    [Test]
    procedure X152_ARepeatedSettingKeepsItsOwnLastValueEvenWhenOtherSettingsFollowIt()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P4', 'code=1;code=2;other=9');

        Assert.AreEqual('2', ConfigImporter.GetSetting('P4', 'code'), 'The last-listed value for a repeated setting wins, regardless of where in the string its final occurrence sits relative to other settings.');
        Assert.AreEqual('9', ConfigImporter.GetSetting('P4', 'other'), 'A setting listed after a repeated one must still be saved with its own value.');
    end;

    [Test]
    procedure X152_AnInvalidEntryLeavesThePreviouslySavedSettingsAndSkipsTheRestOfTheFile()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P5', 'keep=100;stable=200');
        Commit();

        asserterror ConfigImporter.ImportConfig('P5', 'keep=999;fresh=555;badline');

        Assert.AreEqual('100', ConfigImporter.GetSetting('P5', 'keep'), 'A file that fails partway through must leave settings from an earlier successful import untouched.');
        Assert.AreEqual('200', ConfigImporter.GetSetting('P5', 'stable'), 'A file that fails partway through must leave settings from an earlier successful import untouched.');
        Assert.IsFalse(ConfigImporter.SettingExists('P5', 'fresh'), 'None of a failed file''s settings may be saved, including ones listed before the point of failure.');
    end;

    [Test]
    procedure X152_ImportingIntoOneProfileLeavesAnotherProfileUntouched()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P6A', 'shared=1');
        ConfigImporter.ImportConfig('P6B', 'shared=99;private=42');

        ConfigImporter.ImportConfig('P6A', 'shared=2;fresh=7');

        Assert.AreEqual('2', ConfigImporter.GetSetting('P6A', 'shared'), 'Re-importing into one profile must update that profile''s own settings.');
        Assert.AreEqual('7', ConfigImporter.GetSetting('P6A', 'fresh'), 'Re-importing into one profile must save new settings for that profile.');
        Assert.AreEqual('99', ConfigImporter.GetSetting('P6B', 'shared'), 'Importing into one profile must not change a same-named setting saved for a different profile.');
        Assert.AreEqual('42', ConfigImporter.GetSetting('P6B', 'private'), 'Importing into one profile must not touch a different profile''s other settings.');
    end;

    [Test]
    procedure X152_GetSettingOnAMissingKeyFails()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P7', 'present=1');

        asserterror ConfigImporter.GetSetting('P7', 'absent');
    end;

    [Test]
    procedure X152_SettingExistsReportsWhetherASettingWasSaved()
    var
        Setting: Record "CG X152 Setting";
        ConfigImporter: Codeunit "CG X152 Config Importer";
    begin
        Setting.DeleteAll();

        ConfigImporter.ImportConfig('P8', 'present=1');

        Assert.IsTrue(ConfigImporter.SettingExists('P8', 'present'), 'A setting that was saved must be reported as existing.');
        Assert.IsFalse(ConfigImporter.SettingExists('P8', 'absent'), 'A setting that was never saved must be reported as not existing.');
        Assert.IsFalse(ConfigImporter.SettingExists('P8Other', 'present'), 'A setting saved for one profile must not be reported as existing under a different profile.');
    end;

    // ==========================================================
    // X157 - donor CG-AL-X157
    // ==========================================================

    local procedure X157_ClearAll()
    var
        CostCenter: Record "CG X157 Cost Center";
        CostEntry: Record "CG X157 Cost Entry";
        StatementLine: Record "CG X157 Statement Line";
    begin
        CostCenter.DeleteAll();
        CostEntry.DeleteAll();
        StatementLine.DeleteAll();
    end;

    local procedure X157_SeedCostCenter(CostCenterCode: Code[20])
    var
        CostCenter: Record "CG X157 Cost Center";
    begin
        CostCenter.Init();
        CostCenter."Code" := CostCenterCode;
        CostCenter.Insert();
    end;

    local procedure X157_SeedEntry(CostCenterCode: Code[20]; PostingDate: Date; Amount: Decimal)
    var
        CostEntry: Record "CG X157 Cost Entry";
    begin
        CostEntry.Init();
        CostEntry."Cost Center Code" := CostCenterCode;
        CostEntry."Posting Date" := PostingDate;
        CostEntry.Amount := Amount;
        CostEntry.Insert();
    end;

    local procedure X157_AssertStatementLine(CostCenterCode: Code[20]; PeriodStart: Date; ExpectedAmount: Decimal; MessagePrefix: Text)
    var
        StatementLine: Record "CG X157 Statement Line";
    begin
        Assert.IsTrue(StatementLine.Get(CostCenterCode, PeriodStart), MessagePrefix + ' - statement row exists');
        Assert.AreEqual(ExpectedAmount, StatementLine.Amount, MessagePrefix + ' - statement row amount');
    end;

    [Test]
    procedure X157_SinglePeriodWindowMatchingAllActivityReportsTheFullTotal()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260120D, 50);

        Result := Statement.GetPeriodAmount('CC1', 20260101D, 20260131D);

        Assert.AreEqual(150, Result, 'A window that covers a cost center''s only activity reports that activity''s full total');
    end;

    [Test]
    procedure X157_BuildStatementForOneCostCenterLeavesAnothersRowsAlone()
    var
        Statement: Codeunit "CG X157 Period Statement";
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedCostCenter('CC2');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC2', 20260115D, 70);

        Statement.BuildStatement('CC1', 20260101D, 20260131D);
        Statement.BuildStatement('CC2', 20260101D, 20260131D);

        X157_AssertStatementLine('CC1', 20260101D, 100, 'Another cost center''s statement rows must survive building this one''s');
        X157_AssertStatementLine('CC2', 20260101D, 70, 'The freshly built cost center''s own row must carry its own amount');
    end;

    [Test]
    procedure X157_StatementSpanningYearEndCarriesEachMonthsOwnFigure()
    var
        Statement: Codeunit "CG X157 Period Statement";
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20261210D, 90);
        X157_SeedEntry('CC1', 20270115D, 35);

        Statement.BuildStatement('CC1', 20261201D, 20270131D);

        X157_AssertStatementLine('CC1', 20261201D, 90, 'The December period of a statement spanning year end carries December''s own figure');
        X157_AssertStatementLine('CC1', 20270101D, 35, 'The January period of a statement spanning year end carries January''s own figure');
    end;

    [Test]
    procedure X157_MidYearWindowReportsOnlyThatMonthsActivity()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260120D, 50);
        X157_SeedEntry('CC1', 20260205D, 30);
        X157_SeedEntry('CC1', 20260225D, 70);
        X157_SeedEntry('CC1', 20260315D, 40);

        Result := Statement.GetPeriodAmount('CC1', 20260201D, 20260228D);

        Assert.AreEqual(100, Result, 'A mid-year window must report only that window''s own activity, not the cost center''s entire history');
    end;

    [Test]
    procedure X157_NonAlignedWindowReportsOnlyActivityWithinItsExactDates()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260120D, 50);
        X157_SeedEntry('CC1', 20260205D, 30);
        X157_SeedEntry('CC1', 20260225D, 70);
        X157_SeedEntry('CC1', 20260315D, 40);

        Result := Statement.GetPeriodAmount('CC1', 20260115D, 20260215D);

        Assert.AreEqual(80, Result, 'A window that does not line up with calendar month boundaries must still report only the activity that actually falls within it');
    end;

    [Test]
    procedure X157_StatementRowsCarryEachPeriodsOwnFigure()
    var
        Statement: Codeunit "CG X157 Period Statement";
        StatementLine: Record "CG X157 Statement Line";
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260120D, 50);
        X157_SeedEntry('CC1', 20260205D, 30);
        X157_SeedEntry('CC1', 20260225D, 70);
        X157_SeedEntry('CC1', 20260315D, 40);

        Statement.BuildStatement('CC1', 20260101D, 20260331D);

        StatementLine.SetRange("Cost Center Code", 'CC1');
        Assert.AreEqual(3, StatementLine.Count(), 'A statement spanning three calendar months produces exactly three rows');
        X157_AssertStatementLine('CC1', 20260101D, 150, 'The first month''s row');
        X157_AssertStatementLine('CC1', 20260201D, 100, 'The second month''s row');
        X157_AssertStatementLine('CC1', 20260301D, 40, 'The third month''s row');
    end;

    [Test]
    procedure X157_WindowWithNoActivityReportsZero()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260205D, 30);
        X157_SeedEntry('CC1', 20260315D, 40);

        Result := Statement.GetPeriodAmount('CC1', 20260401D, 20260430D);

        Assert.AreEqual(0, Result, 'A window with no activity in it must report zero, even though the cost center has activity elsewhere');
    end;

    [Test]
    procedure X157_AnotherCostCentersActivityDoesNotAffectThisOnesFigure()
    var
        Statement: Codeunit "CG X157 Period Statement";
        ResultCC1: Decimal;
        ResultCC2: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedCostCenter('CC2');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC2', 20260110D, 9999);

        ResultCC1 := Statement.GetPeriodAmount('CC1', 20260101D, 20260131D);
        ResultCC2 := Statement.GetPeriodAmount('CC2', 20260101D, 20260131D);

        Assert.AreEqual(100, ResultCC1, 'A cost center''s own figure must not include another cost center''s activity');
        Assert.AreEqual(9999, ResultCC2, 'The other cost center''s own figure must be unaffected by resolving the first one''s figure');
    end;

    [Test]
    procedure X157_ActivityOnTheWindowsFirstAndLastDayIsIncluded()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20251231D, 20);
        X157_SeedEntry('CC1', 20260101D, 100);
        X157_SeedEntry('CC1', 20260131D, 50);
        X157_SeedEntry('CC1', 20260201D, 30);

        Result := Statement.GetPeriodAmount('CC1', 20260101D, 20260131D);

        Assert.AreEqual(150, Result, 'Activity dated exactly on either edge of the window must be included, and activity just outside either edge must be excluded');
    end;

    [Test]
    procedure X157_RebuildingAStatementReplacesThePreviousRows()
    var
        Statement: Codeunit "CG X157 Period Statement";
        StatementLine: Record "CG X157 Statement Line";
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260120D, 50);
        X157_SeedEntry('CC1', 20260205D, 30);
        X157_SeedEntry('CC1', 20260225D, 70);
        X157_SeedEntry('CC1', 20260315D, 40);

        Statement.BuildStatement('CC1', 20260101D, 20260331D);
        Statement.BuildStatement('CC1', 20260201D, 20260228D);

        StatementLine.SetRange("Cost Center Code", 'CC1');
        Assert.AreEqual(1, StatementLine.Count(), 'Rebuilding a statement for a narrower window must replace the previous rows, not add to them');
        Assert.IsFalse(StatementLine.Get('CC1', 20260101D), 'A row from the earlier, wider statement must not survive a rebuild');
        Assert.IsFalse(StatementLine.Get('CC1', 20260301D), 'A row from the earlier, wider statement must not survive a rebuild');
        X157_AssertStatementLine('CC1', 20260201D, 100, 'The rebuilt statement''s only row');
    end;
}
