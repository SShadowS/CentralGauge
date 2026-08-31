codeunit 89476 "CG-AL-X254 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    // This oracle merges 6 independent modules' test suites into one
    // codeunit. Every test and helper procedure is prefixed with the module
    // it belongs to so identical helper names across the source suites cannot
    // collide. Assembled from already-gated donors; see NOTES.md.

    var
        Assert: Codeunit Assert;
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
        // suite exercises and passes all 7 tests - a false PASS, never a false
        // FAIL: "correct/" is order-independent by construction (both fixed
        // subscribers only ever set Eligible := true, which commutes regardless
        // of firing order), so its pass is never at risk here - only a
        // starter/candidate's fail is. Re-probe trigger fingerprint: an
        // all-green CG-AL-X072 column where failing/non-solving candidates diff
        // as no-ops against tasks/starter/CG-AL-X072/ signals dispatch order
        // flipped on that container, not that the trap stopped working.
        // Accepted residual, not caught by any test here: a buggy candidate
        // that renames or renumbers the VIP codeunit can incidentally change
        // its own subscriber-dispatch position and self-neutralize the defect
        // it was supposed to reproduce.
        // The default test isolation persists writes between test methods, so
        // every test clears the table before seeding its own rows.
        ShippingNsLbl: Label 'urn:tryal:freight:shipping:v2', Locked = true;
        TrackingNsLbl: Label 'urn:tryal:freight:tracking:v1', Locked = true;
        ForeignNsLbl: Label 'urn:partner:audit:v1', Locked = true;
        // before seeding or importing anything. An unrelated entry seeded with
        // a nonzero sentinel Package Count proves an import never touches rows
        // for a different shipment.
        // (measured 2026-08-20, SOAP runner), so every test clears all three
        // tables before seeding its own rows.
        // every test clears the real table before seeding its own rows - even
        // tests that only exercise a working copy, which never touches the
        // database at all.

    // ==========================================================
    // X072 - donor CG-AL-X072
    // ==========================================================

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
    // X083 - donor CG-AL-X083
    // ==========================================================

    [Test]
    procedure X083_ImportCountsEveryPackageAndKeepsOtherFieldsAccurate()
    var
        ImportEntry: Record "CG X083 Shipment Import Entry";
        Mgt: Codeunit "CG X083 Shipment Import Mgt.";
        Any: Codeunit Any;
        ShipmentNo: Code[20];
        FirstTrackingNo: Text;
        SecondTrackingNo: Text;
        Payload: Text;
    begin
        ImportEntry.DeleteAll();

        ShipmentNo := CopyStr('SHP-' + UpperCase(Any.AlphanumericText(8)), 1, MaxStrLen(ShipmentNo));
        FirstTrackingNo := '1Z-' + UpperCase(Any.AlphanumericText(7));
        SecondTrackingNo := '1Z-' + UpperCase(Any.AlphanumericText(7));

        Payload := X083_ShippingMessage(
            '<Header><ShipmentNo>' + ShipmentNo + '</ShipmentNo></Header>' +
            '<Packages>' +
            '<Package>' + X083_TrackingElement(FirstTrackingNo) + '<Weight unit="KG">12.5</Weight></Package>' +
            '<Package>' + X083_TrackingElement(SecondTrackingNo) + '<Weight unit="KG">3.25</Weight></Package>' +
            '<Package/>' +
            '</Packages>');

        Mgt.ImportShipmentStatus(Payload);

        ImportEntry.SetRange("Shipment No.", ShipmentNo);
        ImportEntry.FindLast();

        Assert.AreEqual(ShipmentNo, ImportEntry."Shipment No.", 'Expected the entry to record the shipment the message was for');
        Assert.AreEqual(3, ImportEntry."Package Count", 'Expected one count per package the shipment actually contains');
        Assert.AreEqual(2, ImportEntry."Tracking No. Count", 'Expected only the two packages that carry a tracking number to be counted as tracked');
        Assert.AreEqual('KG', ImportEntry."Weight Unit", 'Expected the unit of the first package that carries one');
        Assert.AreEqual(ImportEntry.Status::Received, ImportEntry.Status, 'Expected a shipment with packages to be marked as received, not empty');
    end;

    [Test]
    procedure X083_ImportCountsEveryPackageWhenTheSenderFormatsTheMessageDifferently()
    var
        ImportEntry: Record "CG X083 Shipment Import Entry";
        Mgt: Codeunit "CG X083 Shipment Import Mgt.";
        Any: Codeunit Any;
        ShipmentNo: Code[20];
        Payload: Text;
    begin
        ImportEntry.DeleteAll();

        ShipmentNo := CopyStr('SHP-' + UpperCase(Any.AlphanumericText(8)), 1, MaxStrLen(ShipmentNo));

        Payload := '<?xml version="1.0" encoding="UTF-8"?>' +
            '<f:ShipmentStatus xmlns:f="' + ShippingNsLbl + '">' +
            '<f:Header><f:ShipmentNo>' + ShipmentNo + '</f:ShipmentNo></f:Header>' +
            '<f:Packages>' +
            '<f:Package>' + X083_TrackingElement('1Z-' + UpperCase(Any.AlphanumericText(7))) + '<f:Weight unit="LB">10</f:Weight></f:Package>' +
            '<f:Package>' + X083_TrackingElement('1Z-' + UpperCase(Any.AlphanumericText(7))) + '<f:Weight unit="LB">20</f:Weight></f:Package>' +
            '</f:Packages>' +
            '</f:ShipmentStatus>';

        Mgt.ImportShipmentStatus(Payload);

        ImportEntry.SetRange("Shipment No.", ShipmentNo);
        ImportEntry.FindLast();

        Assert.AreEqual(2, ImportEntry."Package Count", 'Expected one count per package however the sender chose to format this particular message - the two carriers'' messages describe the same shipment shape');
        Assert.AreEqual(ImportEntry.Status::Received, ImportEntry.Status, 'Expected a shipment with packages to be marked as received, not empty');
    end;

    [Test]
    procedure X083_ForeignPackagesFromOtherPartnersNeverInflateTheCount()
    var
        ImportEntry: Record "CG X083 Shipment Import Entry";
        Mgt: Codeunit "CG X083 Shipment Import Mgt.";
        Any: Codeunit Any;
        ShipmentNo: Code[20];
        Payload: Text;
    begin
        ImportEntry.DeleteAll();

        ShipmentNo := CopyStr('SHP-' + UpperCase(Any.AlphanumericText(8)), 1, MaxStrLen(ShipmentNo));

        Payload := X083_ShippingMessage(
            '<Header><ShipmentNo>' + ShipmentNo + '</ShipmentNo></Header>' +
            '<Packages>' +
            '<Package><Weight unit="KG">1.5</Weight></Package>' +
            '<aud:Package xmlns:aud="' + ForeignNsLbl + '"/>' +
            '<Package><Weight unit="KG">2.0</Weight></Package>' +
            '</Packages>' +
            '<aud:Package xmlns:aud="' + ForeignNsLbl + '"/>');

        Mgt.ImportShipmentStatus(Payload);

        ImportEntry.SetRange("Shipment No.", ShipmentNo);
        ImportEntry.FindLast();

        Assert.AreEqual(2, ImportEntry."Package Count", 'Expected only the shipment''s own packages to count, not another partner''s decoy packages that happen to share the same element name');
        Assert.AreEqual(ImportEntry.Status::Received, ImportEntry.Status, 'Expected a shipment with real packages to be marked as received, not empty');
    end;

    [Test]
    procedure X083_APackageThatCarriesNoShipmentIdentityIsNeverCounted()
    var
        ImportEntry: Record "CG X083 Shipment Import Entry";
        Mgt: Codeunit "CG X083 Shipment Import Mgt.";
        Any: Codeunit Any;
        ShipmentNo: Code[20];
        Payload: Text;
    begin
        ImportEntry.DeleteAll();

        ShipmentNo := CopyStr('SHP-' + UpperCase(Any.AlphanumericText(8)), 1, MaxStrLen(ShipmentNo));

        Payload := X083_ShippingMessage(
            '<Header><ShipmentNo>' + ShipmentNo + '</ShipmentNo></Header>' +
            '<Packages>' +
            '<Package><Weight unit="KG">1.5</Weight></Package>' +
            '<Package xmlns=""/>' +
            '<Package><Weight unit="KG">2.0</Weight></Package>' +
            '</Packages>');

        Mgt.ImportShipmentStatus(Payload);

        ImportEntry.SetRange("Shipment No.", ShipmentNo);
        ImportEntry.FindLast();

        Assert.AreEqual(2, ImportEntry."Package Count", 'Expected only the shipment''s own identified packages to count, not a decoy package that carries no shipment identity at all');
        Assert.AreEqual(ImportEntry.Status::Received, ImportEntry.Status, 'Expected a shipment with real packages to be marked as received, not empty');
    end;

    [Test]
    procedure X083_EmptyShipmentReportsZeroPackagesWithoutError()
    var
        ImportEntry: Record "CG X083 Shipment Import Entry";
        Mgt: Codeunit "CG X083 Shipment Import Mgt.";
        Any: Codeunit Any;
        ShipmentNo: Code[20];
        Payload: Text;
    begin
        ImportEntry.DeleteAll();

        ShipmentNo := CopyStr('SHP-' + UpperCase(Any.AlphanumericText(8)), 1, MaxStrLen(ShipmentNo));

        Payload := X083_ShippingMessage('<Header><ShipmentNo>' + ShipmentNo + '</ShipmentNo></Header><Packages/>');

        Mgt.ImportShipmentStatus(Payload);

        ImportEntry.SetRange("Shipment No.", ShipmentNo);
        ImportEntry.FindLast();

        Assert.AreEqual(0, ImportEntry."Package Count", 'Expected zero for a shipment that genuinely carries no packages - not an error');
        Assert.AreEqual(0, ImportEntry."Tracking No. Count", 'Expected zero tracking numbers when there are no packages to carry one');
        Assert.AreEqual('', ImportEntry."Weight Unit", 'Expected an empty weight unit when there are no packages to weigh');
        Assert.AreEqual(ImportEntry.Status::"Empty Shipment", ImportEntry.Status, 'Expected a shipment with no packages to be marked empty');
    end;

    [Test]
    procedure X083_TheOldMessageFormatStillImportsAnEmptyShipmentCleanly()
    var
        ImportEntry: Record "CG X083 Shipment Import Entry";
        Mgt: Codeunit "CG X083 Shipment Import Mgt.";
        Payload: Text;
    begin
        ImportEntry.DeleteAll();

        // The format the gateway used before it went live with real carrier
        // traffic - no shipment number, no packages, nothing to find.
        Payload := '<?xml version="1.0" encoding="UTF-8"?><ShipmentStatus><Header/><Packages/></ShipmentStatus>';

        Mgt.ImportShipmentStatus(Payload);

        ImportEntry.FindLast();

        Assert.AreEqual('', ImportEntry."Shipment No.", 'Expected an empty shipment number when the message carries none');
        Assert.AreEqual(0, ImportEntry."Package Count", 'Expected zero packages for a message that carries none, the same as it always did for this message shape');
        Assert.AreEqual(0, ImportEntry."Tracking No. Count", 'Expected zero tracking numbers for a message that carries none');
        Assert.AreEqual('', ImportEntry."Weight Unit", 'Expected an empty weight unit for a message that carries no packages');
        Assert.AreEqual(ImportEntry.Status::"Empty Shipment", ImportEntry.Status, 'Expected a shipment with no packages to be marked empty, exactly as this message shape always reported');
    end;

    [Test]
    procedure X083_GetLastImportedPackageCountMatchesTheMostRecentImportForThatShipment()
    var
        ImportEntry: Record "CG X083 Shipment Import Entry";
        Mgt: Codeunit "CG X083 Shipment Import Mgt.";
        Any: Codeunit Any;
        ShipmentNo: Code[20];
        OtherShipmentNo: Code[20];
        FirstPayload: Text;
        SecondPayload: Text;
    begin
        ImportEntry.DeleteAll();

        ShipmentNo := CopyStr('SHP-' + UpperCase(Any.AlphanumericText(8)), 1, MaxStrLen(ShipmentNo));
        OtherShipmentNo := CopyStr('SHP-' + UpperCase(Any.AlphanumericText(8)), 1, MaxStrLen(OtherShipmentNo));

        ImportEntry.Init();
        ImportEntry."Shipment No." := OtherShipmentNo;
        ImportEntry."Package Count" := 777;
        ImportEntry.Status := ImportEntry.Status::Received;
        ImportEntry."Imported At" := CurrentDateTime();
        ImportEntry.Insert(true);

        FirstPayload := X083_ShippingMessage(
            '<Header><ShipmentNo>' + ShipmentNo + '</ShipmentNo></Header>' +
            '<Packages><Package><Weight unit="KG">1.0</Weight></Package></Packages>');
        Mgt.ImportShipmentStatus(FirstPayload);

        SecondPayload := X083_ShippingMessage(
            '<Header><ShipmentNo>' + ShipmentNo + '</ShipmentNo></Header>' +
            '<Packages>' +
            '<Package><Weight unit="KG">1.0</Weight></Package>' +
            '<Package><Weight unit="KG">1.0</Weight></Package>' +
            '<Package><Weight unit="KG">1.0</Weight></Package>' +
            '<Package><Weight unit="KG">1.0</Weight></Package>' +
            '</Packages>');
        Mgt.ImportShipmentStatus(SecondPayload);

        Assert.AreEqual(4, Mgt.GetLastImportedPackageCount(ShipmentNo), 'Expected the most recently imported package count for a re-scanned shipment, not the first scan''s count');

        ImportEntry.SetRange("Shipment No.", OtherShipmentNo);
        ImportEntry.FindLast();
        Assert.AreEqual(777, ImportEntry."Package Count", 'Expected an unrelated shipment''s entry to be untouched by importing a different shipment');
    end;

    [Test]
    procedure X083_GetLastImportedPackageCountReflectsOnlyItsOwnShipmentAfterALaterImportOfAnother()
    var
        ImportEntry: Record "CG X083 Shipment Import Entry";
        Mgt: Codeunit "CG X083 Shipment Import Mgt.";
        Any: Codeunit Any;
        ShipmentA: Code[20];
        ShipmentB: Code[20];
        PayloadA: Text;
        PayloadB: Text;
    begin
        ImportEntry.DeleteAll();

        ShipmentA := CopyStr('SHP-' + UpperCase(Any.AlphanumericText(8)), 1, MaxStrLen(ShipmentA));
        ShipmentB := CopyStr('SHP-' + UpperCase(Any.AlphanumericText(8)), 1, MaxStrLen(ShipmentB));

        PayloadA := X083_ShippingMessage(
            '<Header><ShipmentNo>' + ShipmentA + '</ShipmentNo></Header>' +
            '<Packages><Package><Weight unit="KG">1.0</Weight></Package><Package><Weight unit="KG">1.0</Weight></Package></Packages>');
        Mgt.ImportShipmentStatus(PayloadA);

        // Shipment B is imported afterward, so its entry carries a higher
        // Entry No. than shipment A's - the exact shape that exposes an
        // unfiltered lookup.
        PayloadB := X083_ShippingMessage(
            '<Header><ShipmentNo>' + ShipmentB + '</ShipmentNo></Header>' +
            '<Packages>' +
            '<Package><Weight unit="KG">1.0</Weight></Package>' +
            '<Package><Weight unit="KG">1.0</Weight></Package>' +
            '<Package><Weight unit="KG">1.0</Weight></Package>' +
            '<Package><Weight unit="KG">1.0</Weight></Package>' +
            '<Package><Weight unit="KG">1.0</Weight></Package>' +
            '</Packages>');
        Mgt.ImportShipmentStatus(PayloadB);

        Assert.AreEqual(2, Mgt.GetLastImportedPackageCount(ShipmentA),
            'Expected shipment A''s own most recently imported package count, not a different shipment''s count just because that other shipment was imported afterward');
    end;

    [Test]
    procedure X083_GetLastImportedPackageCountIsZeroForAShipmentNeverImported()
    var
        ImportEntry: Record "CG X083 Shipment Import Entry";
        Mgt: Codeunit "CG X083 Shipment Import Mgt.";
    begin
        ImportEntry.DeleteAll();

        Assert.AreEqual(0, Mgt.GetLastImportedPackageCount('SHP-NEVER-SEEN'), 'Expected zero for a shipment number that was never imported');
    end;

    local procedure X083_ShippingMessage(InnerXml: Text): Text
    begin
        exit('<?xml version="1.0" encoding="UTF-8"?>' +
            '<ShipmentStatus xmlns="' + ShippingNsLbl + '">' + InnerXml + '</ShipmentStatus>');
    end;

    local procedure X083_TrackingElement(Value: Text): Text
    begin
        exit('<trk:TrackingNo xmlns:trk="' + TrackingNsLbl + '">' + Value + '</trk:TrackingNo>');
    end;

    // ==========================================================
    // X118 - donor CG-AL-X118
    // ==========================================================

    local procedure X118_ClearAllData()
    var
        JournalLine: Record "CG X118 Journal Line";
        Account: Record "CG X118 Account";
        Currency: Record "CG X118 Currency";
    begin
        JournalLine.DeleteAll();
        Account.DeleteAll();
        Currency.DeleteAll();
    end;

    local procedure X118_SeedCurrency(CurrencyCode: Code[10]; RoundingPrecision: Decimal)
    var
        Currency: Record "CG X118 Currency";
    begin
        Currency.Init();
        Currency."Code" := CurrencyCode;
        Currency."Rounding Precision" := RoundingPrecision;
        Currency.Insert();
    end;

    local procedure X118_SeedAccount(AccountNo: Code[20]; CurrencyCode: Code[10])
    var
        Account: Record "CG X118 Account";
    begin
        Account.Init();
        Account."No." := AccountNo;
        Account."Currency Code" := CurrencyCode;
        Account.Insert();
    end;

    local procedure X118_CreateLine(var JournalLine: Record "CG X118 Journal Line"; EntryNo: Integer; AccountNo: Code[20])
    begin
        JournalLine.Init();
        JournalLine."Entry No." := EntryNo;
        JournalLine.Insert(true);
        JournalLine.Validate("Account No.", AccountNo);
        JournalLine.Modify(true);
    end;

    local procedure X118_SetAmountThenCounterAccount(var JournalLine: Record "CG X118 Journal Line"; AmountValue: Decimal; CounterAccountNo: Code[20])
    begin
        JournalLine.Validate(Amount, AmountValue);
        JournalLine.Validate("Counter Account No.", CounterAccountNo);
        JournalLine.Modify(true);
    end;

    // Re-reads the entry from the table and checks all three facts a
    // balanced entry must satisfy: the recorded amount is exactly what was
    // entered (never itself adjusted), the balancing amount is its exact
    // opposite, and the two therefore net to exactly zero - so a rewrite
    // that "balances" by adjusting Amount instead of Balancing Amount, or
    // by zeroing both, cannot pass alongside a genuine fix.
    local procedure X118_AssertBalances(EntryNo: Integer; ExpectedAmount: Decimal)
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        JournalLine.Get(EntryNo);
        Assert.AreEqual(
          ExpectedAmount, JournalLine.Amount,
          StrSubstNo('Expected journal entry %1 to keep its recorded amount unchanged', EntryNo));
        Assert.AreEqual(
          -ExpectedAmount, JournalLine."Balancing Amount",
          StrSubstNo('Expected journal entry %1''s balancing amount to be the exact opposite of its amount', EntryNo));
        Assert.AreEqual(
          0.0, JournalLine.Amount + JournalLine."Balancing Amount",
          StrSubstNo('Expected journal entry %1''s amount and balancing amount to net to exactly zero', EntryNo));
    end;

    [Test]
    procedure X118_SameCurrencyOnBothAccountsBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-EUR', 'EUR');
        X118_CreateLine(JournalLine, 1, 'MAIN-EUR');

        X118_SetAmountThenCounterAccount(JournalLine, 250.75, 'CTR-EUR');

        X118_AssertBalances(1, 250.75);
        JournalLine.Get(1);
        Assert.AreEqual('EUR', JournalLine."Currency Code",
          'Expected the journal entry to keep the currency of its own account');
    end;

    [Test]
    procedure X118_DifferentCurrenciesWithMatchingPrecisionBalanceExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('USD', 0.01);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-USD', 'USD');
        X118_CreateLine(JournalLine, 2, 'MAIN-EUR');

        X118_SetAmountThenCounterAccount(JournalLine, 312.40, 'CTR-USD');

        X118_AssertBalances(2, 312.40);
    end;

    [Test]
    procedure X118_AWholeUnitCounterCurrencyStillBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-JPY', 'JPY');
        X118_CreateLine(JournalLine, 3, 'MAIN-EUR');

        X118_SetAmountThenCounterAccount(JournalLine, 100.50, 'CTR-JPY');

        X118_AssertBalances(3, 100.50);
        JournalLine.Get(3);
        Assert.AreEqual('EUR', JournalLine."Currency Code",
          'Expected the journal entry to keep the currency of its own account');
    end;

    [Test]
    procedure X118_ASmallRemainderAgainstAWholeUnitCounterCurrencyStillBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-JPY', 'JPY');
        X118_CreateLine(JournalLine, 4, 'MAIN-EUR');

        X118_SetAmountThenCounterAccount(JournalLine, 100.01, 'CTR-JPY');

        X118_AssertBalances(4, 100.01);
    end;

    [Test]
    procedure X118_AFractionalCentRemainderAgainstAWholeUnitCounterCurrencyStillBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        // 100.005 is not itself a whole number of EUR cents, but it is what
        // this account's own line already carries - the fix must preserve
        // it exactly, not round it to the nearest cent along the way.
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-JPY', 'JPY');
        X118_CreateLine(JournalLine, 15, 'MAIN-EUR');

        X118_SetAmountThenCounterAccount(JournalLine, 100.005, 'CTR-JPY');

        X118_AssertBalances(15, 100.005);
    end;

    [Test]
    procedure X118_AWholeAmountAgainstAWholeUnitCounterCurrencyBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-JPY', 'JPY');
        X118_CreateLine(JournalLine, 5, 'MAIN-EUR');

        X118_SetAmountThenCounterAccount(JournalLine, 100.00, 'CTR-JPY');

        X118_AssertBalances(5, 100.00);
    end;

    [Test]
    procedure X118_AFinerCounterCurrencyStillBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('KWD', 0.001);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-KWD', 'KWD');
        X118_CreateLine(JournalLine, 6, 'MAIN-EUR');

        X118_SetAmountThenCounterAccount(JournalLine, 100.50, 'CTR-KWD');

        X118_AssertBalances(6, 100.50);
    end;

    [Test]
    procedure X118_AZeroPrecisionCounterCurrencyStillBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('ZPR', 0);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-ZPR', 'ZPR');
        X118_CreateLine(JournalLine, 14, 'MAIN-EUR');

        X118_SetAmountThenCounterAccount(JournalLine, 88.37, 'CTR-ZPR');

        X118_AssertBalances(14, 88.37);
    end;

    [Test]
    procedure X118_AFinelyDenominatedMainCurrencyStillBalancesExactlyAgainstAWholeUnitCounter()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('KWD', 0.001);
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-KWD', 'KWD');
        X118_SeedAccount('CTR-JPY', 'JPY');
        X118_CreateLine(JournalLine, 7, 'MAIN-KWD');

        X118_SetAmountThenCounterAccount(JournalLine, 45.678, 'CTR-JPY');

        X118_AssertBalances(7, 45.678);
    end;

    [Test]
    procedure X118_NoMainCurrencyStillBalancesExactlyAgainstAWholeUnitCounter()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-LOCAL', '');
        X118_SeedAccount('CTR-JPY', 'JPY');
        X118_CreateLine(JournalLine, 8, 'MAIN-LOCAL');

        X118_SetAmountThenCounterAccount(JournalLine, 75.60, 'CTR-JPY');

        X118_AssertBalances(8, 75.60);
    end;

    [Test]
    procedure X118_ClearingTheCounterAccountLeavesNothingToBalance()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-JPY', 'JPY');
        X118_CreateLine(JournalLine, 9, 'MAIN-EUR');

        X118_SetAmountThenCounterAccount(JournalLine, 100.50, 'CTR-JPY');

        JournalLine.Validate("Counter Account No.", '');
        JournalLine.Modify(true);

        JournalLine.Get(9);
        Assert.AreEqual(100.50, JournalLine.Amount,
          'Expected clearing the counter account on a journal entry to leave its recorded amount untouched');
        Assert.AreEqual(0.0, JournalLine."Balancing Amount",
          'Expected clearing the counter account on a journal entry to leave it with nothing to balance');
    end;

    [Test]
    procedure X118_ClearingTheAccountNoAlsoClearsTheCurrencyCode()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-EUR', 'EUR');
        X118_CreateLine(JournalLine, 16, 'MAIN-EUR');

        JournalLine.Validate("Account No.", '');
        JournalLine.Modify(true);

        JournalLine.Get(16);
        Assert.AreEqual('', JournalLine."Currency Code",
          'Expected clearing the account on a journal entry to also clear its currency');

        X118_SetAmountThenCounterAccount(JournalLine, 60.30, 'CTR-EUR');

        X118_AssertBalances(16, 60.30);
    end;

    [Test]
    procedure X118_AmountChangesAfterTheCounterAccountIsSetStillBalanceExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-JPY', 'JPY');
        X118_CreateLine(JournalLine, 10, 'MAIN-EUR');

        JournalLine.Validate("Counter Account No.", 'CTR-JPY');
        JournalLine.Validate(Amount, 100.50);
        JournalLine.Modify(true);

        X118_AssertBalances(10, 100.50);

        JournalLine.Validate(Amount, 60.25);
        JournalLine.Modify(true);

        X118_AssertBalances(10, 60.25);
    end;

    [Test]
    procedure X118_SettingAnUnknownCounterAccountFailsWithAnError()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_CreateLine(JournalLine, 11, 'MAIN-EUR');
        JournalLine.Validate(Amount, 100.00);
        JournalLine.Modify(true);

        asserterror JournalLine.Validate("Counter Account No.", 'NO-SUCH-ACCOUNT');
        Assert.ExpectedError('NO-SUCH-ACCOUNT');
    end;

    [Test]
    procedure X118_SettingAnUnknownAccountFailsWithAnError()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        JournalLine.Init();
        JournalLine."Entry No." := 12;
        JournalLine.Insert(true);

        asserterror JournalLine.Validate("Account No.", 'NO-SUCH-ACCOUNT');
        Assert.ExpectedError('NO-SUCH-ACCOUNT');
    end;

    [Test]
    procedure X118_UnrelatedEntriesAreNeverTouched()
    var
        JournalLine: Record "CG X118 Journal Line";
        OtherLine: Record "CG X118 Journal Line";
    begin
        X118_ClearAllData();
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-JPY', 'JPY');

        OtherLine.Init();
        OtherLine."Entry No." := 999;
        OtherLine.Amount := 321.00;
        OtherLine."Balancing Amount" := 777.77;
        OtherLine.Insert();

        X118_CreateLine(JournalLine, 13, 'MAIN-EUR');
        X118_SetAmountThenCounterAccount(JournalLine, 100.50, 'CTR-JPY');
        X118_AssertBalances(13, 100.50);

        OtherLine.Get(999);
        Assert.AreEqual(777.77, OtherLine."Balancing Amount",
          'Expected a journal entry that was never revalidated in this test to keep its recorded balancing amount untouched');
        Assert.AreEqual(321.00, OtherLine.Amount,
          'Expected a journal entry that was never revalidated in this test to keep its recorded amount untouched');
    end;

    [Test]
    procedure X118_RandomCoarseCurrencyAmountsAlwaysBalanceExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
        Any: Codeunit Any;
        EntryNo: Integer;
        AmountValue: Decimal;
        i: Integer;
    begin
        // Amounts are drawn to three decimal places - one more than EUR's
        // own 0.01 precision - so a fix that rounds to the line's own
        // currency instead of the counter's fails on essentially every
        // draw here, not just the single hand-picked case above.
        X118_ClearAllData();
        Any.SetSeed(118);
        X118_SeedCurrency('EUR', 0.01);
        X118_SeedCurrency('JPY', 1);
        X118_SeedAccount('MAIN-EUR', 'EUR');
        X118_SeedAccount('CTR-JPY', 'JPY');

        for i := 1 to 8 do begin
            EntryNo := 100 + i;
            AmountValue := Any.IntegerInRange(1000, 999999) / 1000;
            X118_CreateLine(JournalLine, EntryNo, 'MAIN-EUR');
            X118_SetAmountThenCounterAccount(JournalLine, AmountValue, 'CTR-JPY');
            X118_AssertBalances(EntryNo, AmountValue);
        end;
    end;

    // ==========================================================
    // X132 - donor CG-AL-X132
    // ==========================================================

    local procedure X132_SeedReal(EntryNo: Integer; AccountNo: Code[20]; InitialAmount: Decimal)
    var
        BalanceLine: Record "CG X132 Balance Line";
    begin
        BalanceLine.Init();
        BalanceLine."Entry No." := EntryNo;
        BalanceLine."Account No." := AccountNo;
        BalanceLine.Amount := InitialAmount;
        BalanceLine.Reviewed := false;
        BalanceLine.Insert();
    end;

    local procedure X132_SeedWorkingCopy(var TempBalanceLine: Record "CG X132 Balance Line" temporary; EntryNo: Integer; AccountNo: Code[20]; InitialAmount: Decimal)
    begin
        TempBalanceLine.Init();
        TempBalanceLine."Entry No." := EntryNo;
        TempBalanceLine."Account No." := AccountNo;
        TempBalanceLine.Amount := InitialAmount;
        TempBalanceLine.Reviewed := false;
        TempBalanceLine.Insert();
    end;

    local procedure X132_RealAmount(EntryNo: Integer): Decimal
    var
        BalanceLine: Record "CG X132 Balance Line";
    begin
        BalanceLine.Get(EntryNo);
        exit(BalanceLine.Amount);
    end;

    local procedure X132_RealReviewed(EntryNo: Integer): Boolean
    var
        BalanceLine: Record "CG X132 Balance Line";
    begin
        BalanceLine.Get(EntryNo);
        exit(BalanceLine.Reviewed);
    end;

    [Test]
    procedure X132_ProcessBufferMarksWorkingCopyLinesAndReturnsTheTotal()
    var
        BalanceLine: Record "CG X132 Balance Line";
        TempBalanceLine: Record "CG X132 Balance Line" temporary;
        Buffer: Codeunit "CG X132 Balance Buffer";
        Total: Decimal;
    begin
        BalanceLine.DeleteAll();
        X132_SeedWorkingCopy(TempBalanceLine, 1, 'ACC-A', 10);
        X132_SeedWorkingCopy(TempBalanceLine, 2, 'ACC-A', 25);
        X132_SeedWorkingCopy(TempBalanceLine, 3, 'ACC-B', 7);

        Total := Buffer.ProcessBuffer(TempBalanceLine);

        Assert.AreEqual(42.0, Total, 'Expected the total across every working-copy line');
        TempBalanceLine.Reset();
        TempBalanceLine.FindSet();
        repeat
            Assert.IsTrue(TempBalanceLine.Reviewed, 'Expected every working-copy line to be marked reviewed');
        until TempBalanceLine.Next() = 0;
    end;

    [Test]
    procedure X132_ProcessBufferReturnsZeroForAnEmptyWorkingCopy()
    var
        BalanceLine: Record "CG X132 Balance Line";
        TempBalanceLine: Record "CG X132 Balance Line" temporary;
        Buffer: Codeunit "CG X132 Balance Buffer";
    begin
        BalanceLine.DeleteAll();

        Assert.AreEqual(0.0, Buffer.ProcessBuffer(TempBalanceLine), 'Expected an empty working copy to total zero, not raise an error');
    end;

    [Test]
    procedure X132_ProcessBufferRefusesTheRealTable()
    var
        BalanceLine: Record "CG X132 Balance Line";
        Buffer: Codeunit "CG X132 Balance Buffer";
    begin
        BalanceLine.DeleteAll();
        X132_SeedReal(100, 'ACC-A', 55);
        X132_SeedReal(200, 'ACC-B', 91);
        Commit();

        BalanceLine.SetRange("Account No.", 'ACC-A');
        asserterror Buffer.ProcessBuffer(BalanceLine);
        Assert.ExpectedError('working copy of balance lines');

        Assert.AreEqual(55.0, X132_RealAmount(100), 'Expected the real ACC-A row to be untouched after the refusal');
        Assert.IsFalse(X132_RealReviewed(100), 'Expected the real ACC-A row to stay unreviewed after the refusal');
        Assert.AreEqual(91.0, X132_RealAmount(200), 'Expected the unrelated real ACC-B row to be untouched after the refusal');
        Assert.IsFalse(X132_RealReviewed(200), 'Expected the unrelated real ACC-B row to stay unreviewed after the refusal');
    end;

    [Test]
    procedure X132_ProcessBufferRefusesTheEmptyRealTable()
    var
        BalanceLine: Record "CG X132 Balance Line";
        Buffer: Codeunit "CG X132 Balance Buffer";
    begin
        BalanceLine.DeleteAll();

        asserterror Buffer.ProcessBuffer(BalanceLine);
        Assert.ExpectedError('working copy of balance lines');
    end;

    [Test]
    procedure X132_ArchiveBufferClearsWorkingCopyLinesAndMarksThemReviewed()
    var
        BalanceLine: Record "CG X132 Balance Line";
        TempBalanceLine: Record "CG X132 Balance Line" temporary;
        Buffer: Codeunit "CG X132 Balance Buffer";
    begin
        BalanceLine.DeleteAll();
        X132_SeedWorkingCopy(TempBalanceLine, 1, 'ACC-A', 10);
        X132_SeedWorkingCopy(TempBalanceLine, 2, 'ACC-A', 25);

        Buffer.ArchiveBuffer(TempBalanceLine);

        TempBalanceLine.Reset();
        TempBalanceLine.FindSet();
        repeat
            Assert.AreEqual(0.0, TempBalanceLine.Amount, 'Expected every working-copy line to be cleared to zero');
            Assert.IsTrue(TempBalanceLine.Reviewed, 'Expected every working-copy line to be marked reviewed');
        until TempBalanceLine.Next() = 0;
    end;

    [Test]
    procedure X132_ArchiveBufferOnAnEmptyWorkingCopyCompletesWithoutError()
    var
        BalanceLine: Record "CG X132 Balance Line";
        TempBalanceLine: Record "CG X132 Balance Line" temporary;
        Buffer: Codeunit "CG X132 Balance Buffer";
    begin
        BalanceLine.DeleteAll();

        Buffer.ArchiveBuffer(TempBalanceLine);

        Assert.AreEqual(0, TempBalanceLine.Count(), 'Expected an empty working copy to stay empty after archiving');
    end;

    [Test]
    procedure X132_ArchiveBufferOnAWorkingCopyLimitedToOneAccountOnlyTouchesThatAccount()
    var
        BalanceLine: Record "CG X132 Balance Line";
        TempBalanceLine: Record "CG X132 Balance Line" temporary;
        Buffer: Codeunit "CG X132 Balance Buffer";
    begin
        BalanceLine.DeleteAll();
        X132_SeedWorkingCopy(TempBalanceLine, 1, 'ACC-A', 10);
        X132_SeedWorkingCopy(TempBalanceLine, 2, 'ACC-B', 40);
        TempBalanceLine.Reset();
        TempBalanceLine.SetRange("Account No.", 'ACC-A');

        Buffer.ArchiveBuffer(TempBalanceLine);

        TempBalanceLine.Reset();
        TempBalanceLine.Get(1);
        Assert.AreEqual(0.0, TempBalanceLine.Amount, 'Expected the selected ACC-A working-copy line to be cleared');
        Assert.IsTrue(TempBalanceLine.Reviewed, 'Expected the selected ACC-A working-copy line to be marked reviewed');
        TempBalanceLine.Get(2);
        Assert.AreEqual(40.0, TempBalanceLine.Amount, 'Expected the ACC-B working-copy line outside the selection to be untouched');
        Assert.IsFalse(TempBalanceLine.Reviewed, 'Expected the ACC-B working-copy line outside the selection to stay unreviewed');
    end;

    [Test]
    procedure X132_ArchiveBufferRefusesTheRealTableWhenLimitedToOneAccount()
    var
        BalanceLine: Record "CG X132 Balance Line";
        Buffer: Codeunit "CG X132 Balance Buffer";
    begin
        BalanceLine.DeleteAll();
        X132_SeedReal(100, 'ACC-A', 55);
        X132_SeedReal(101, 'ACC-A', 12);
        X132_SeedReal(200, 'ACC-B', 91);
        Commit();

        BalanceLine.SetRange("Account No.", 'ACC-A');
        asserterror Buffer.ArchiveBuffer(BalanceLine);
        Assert.ExpectedError('working copy of balance lines');

        Assert.AreEqual(55.0, X132_RealAmount(100), 'Expected the real ACC-A row to be untouched after the refusal');
        Assert.IsFalse(X132_RealReviewed(100), 'Expected the real ACC-A row to stay unreviewed after the refusal');
        Assert.AreEqual(12.0, X132_RealAmount(101), 'Expected the second real ACC-A row to be untouched after the refusal');
        Assert.AreEqual(91.0, X132_RealAmount(200), 'Expected the unrelated real ACC-B row to be untouched after the refusal');
        Assert.IsFalse(X132_RealReviewed(200), 'Expected the unrelated real ACC-B row to stay unreviewed after the refusal');
    end;

    [Test]
    procedure X132_ArchiveBufferRefusesTheWholeRealTable()
    var
        BalanceLine: Record "CG X132 Balance Line";
        Buffer: Codeunit "CG X132 Balance Buffer";
    begin
        BalanceLine.DeleteAll();
        X132_SeedReal(100, 'ACC-A', 55);
        X132_SeedReal(200, 'ACC-B', 91);
        Commit();

        BalanceLine.Reset();
        asserterror Buffer.ArchiveBuffer(BalanceLine);
        Assert.ExpectedError('working copy of balance lines');

        Assert.AreEqual(55.0, X132_RealAmount(100), 'Expected the real ACC-A row to be untouched after the refusal');
        Assert.IsFalse(X132_RealReviewed(100), 'Expected the real ACC-A row to stay unreviewed after the refusal');
        Assert.AreEqual(91.0, X132_RealAmount(200), 'Expected the real ACC-B row to be untouched after the refusal');
        Assert.IsFalse(X132_RealReviewed(200), 'Expected the real ACC-B row to stay unreviewed after the refusal');
    end;

    [Test]
    procedure X132_ArchiveBufferRefusesTheEmptyRealTable()
    var
        BalanceLine: Record "CG X132 Balance Line";
        Buffer: Codeunit "CG X132 Balance Buffer";
    begin
        BalanceLine.DeleteAll();

        asserterror Buffer.ArchiveBuffer(BalanceLine);
        Assert.ExpectedError('working copy of balance lines');
    end;

    // ==========================================================
    // X160 - donor CG-AL-X160
    // ==========================================================

    local procedure X160_ClearFixture()
    var
        Wallet: Record "CG X160 Wallet";
        WalletEntry: Record "CG X160 Wallet Entry";
    begin
        Wallet.DeleteAll();
        WalletEntry.DeleteAll();
    end;

    local procedure X160_SeedWallet(No: Code[20]; Balance: Decimal)
    var
        Wallet: Record "CG X160 Wallet";
    begin
        Wallet.Init();
        Wallet."No." := No;
        Wallet.Balance := Balance;
        // Nonzero-checkable sentinel: an untouched wallet must keep this exactly.
        Wallet."Total Charged" := 0;
        Wallet.Insert();
    end;

    local procedure X160_EntryCountFor(WalletNo: Code[20]): Integer
    var
        WalletEntry: Record "CG X160 Wallet Entry";
    begin
        WalletEntry.SetRange("Wallet No.", WalletNo);
        exit(WalletEntry.Count());
    end;

    local procedure X160_GetLastEntry(WalletNo: Code[20]; var WalletEntry: Record "CG X160 Wallet Entry")
    begin
        WalletEntry.SetRange("Wallet No.", WalletNo);
        Assert.IsTrue(WalletEntry.FindLast(), StrSubstNo('Expected at least one ledger entry for wallet %1', WalletNo));
    end;

    [Test]
    procedure X160_ChargingTakesMoneyOutAndUpdatesTheRunningTotal()
    var
        Wallet: Record "CG X160 Wallet";
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
        Entry: Record "CG X160 Wallet Entry";
    begin
        // [SCENARIO] A charge against a funded wallet succeeds
        X160_ClearFixture();
        X160_SeedWallet('W-01', 500);

        WalletMgt.PostCharge('W-01', 120);

        Wallet.Get('W-01');
        Assert.AreEqual(380.0, Wallet.Balance, 'Expected the charge to reduce the wallet''s balance');
        Assert.AreEqual(120.0, Wallet."Total Charged", 'Expected the charge to add to the wallet''s running total');
        X160_GetLastEntry('W-01', Entry);
        Assert.AreEqual(120.0, Entry.Amount, 'Expected the ledger entry to record the charged amount');
    end;

    [Test]
    procedure X160_ARefundOnOneWalletDoesNotShrinkAnotherWalletsRefundRoom()
    var
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
        Wallet: Record "CG X160 Wallet";
    begin
        // [SCENARIO] Refund room is per wallet, not shared across wallets
        X160_ClearFixture();
        X160_SeedWallet('W-RA', 500);
        X160_SeedWallet('W-RB', 500);
        WalletMgt.PostCharge('W-RA', 100);
        WalletMgt.PostCharge('W-RB', 100);

        WalletMgt.PostRefund('W-RA', 40);
        WalletMgt.PostRefund('W-RB', 100);

        Wallet.Get('W-RB');
        Assert.AreEqual(500.0, Wallet.Balance, 'A wallet''s refund room must not be reduced by another wallet''s refunds');
    end;

    [Test]
    procedure X160_ChargingMoreThanTheBalanceIsRefused()
    var
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] A charge larger than what is available is refused
        X160_ClearFixture();
        X160_SeedWallet('W-02', 100);

        asserterror WalletMgt.PostCharge('W-02', 100.01);

        Assert.ExpectedError('W-02');
    end;

    [Test]
    procedure X160_ChargingExactlyTheBalanceSucceeds()
    var
        Wallet: Record "CG X160 Wallet";
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] A charge for exactly what is available is allowed
        X160_ClearFixture();
        X160_SeedWallet('W-03', 75);

        WalletMgt.PostCharge('W-03', 75);

        Wallet.Get('W-03');
        Assert.AreEqual(0.0, Wallet.Balance, 'Expected the wallet to be drawn down to zero exactly');
    end;

    [Test]
    procedure X160_ChargingANonPositiveAmountIsRefused()
    var
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] Zero and negative charge amounts are both rejected
        X160_ClearFixture();
        X160_SeedWallet('W-04', 500);
        Commit();

        asserterror WalletMgt.PostCharge('W-04', 0);
        Commit();
        asserterror WalletMgt.PostCharge('W-04', -10);
    end;

    [Test]
    procedure X160_ChargingAnUnknownWalletFails()
    var
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] There is no such wallet to charge
        X160_ClearFixture();

        asserterror WalletMgt.PostCharge('NOPE', 10);

        Assert.ExpectedError('NOPE');
    end;

    [Test]
    procedure X160_RefundingPutsMoneyBackWithoutTouchingTheRunningTotal()
    var
        Wallet: Record "CG X160 Wallet";
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
        Entry: Record "CG X160 Wallet Entry";
    begin
        // [SCENARIO] A refund against a charge that was made puts the money back
        X160_ClearFixture();
        X160_SeedWallet('W-05', 500);
        WalletMgt.PostCharge('W-05', 200);

        WalletMgt.PostRefund('W-05', 80);

        Wallet.Get('W-05');
        Assert.AreEqual(380.0, Wallet.Balance, 'Expected the refund to put the money back on the wallet''s balance');
        Assert.AreEqual(200.0, Wallet."Total Charged",
            'Expected the wallet''s running total to still reflect only what was charged');
        X160_GetLastEntry('W-05', Entry);
        Assert.AreEqual("CG X160 Entry Type"::Refund, Entry."Entry Type",
            'Expected the newest ledger entry to record a refund');
        Assert.AreEqual(80.0, Entry.Amount, 'Expected the ledger entry to record the refunded amount');
    end;

    [Test]
    procedure X160_RefundingWithNothingEverChargedIsRefused()
    var
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] A generously funded wallet that has never actually been charged
        X160_ClearFixture();
        X160_SeedWallet('W-06', 5000);

        asserterror WalletMgt.PostRefund('W-06', 50);

        Assert.ExpectedError('W-06');
    end;

    [Test]
    procedure X160_RefundsCannotExceedWhatWasActuallyCharged()
    var
        Wallet: Record "CG X160 Wallet";
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] Two partial refunds are given back, then a third goes too far
        X160_ClearFixture();
        X160_SeedWallet('W-07', 1000);
        WalletMgt.PostCharge('W-07', 100);

        WalletMgt.PostRefund('W-07', 40);
        WalletMgt.PostRefund('W-07', 40);
        Commit();
        asserterror WalletMgt.PostRefund('W-07', 30);

        Wallet.Get('W-07');
        Assert.AreEqual(980.0, Wallet.Balance,
            'Expected only the two successful refunds to have reached the wallet''s balance');
        Assert.AreEqual(3, X160_EntryCountFor('W-07'), 'Expected the refused refund not to have added a ledger entry');
    end;

    [Test]
    procedure X160_ARefundForExactlyWhatRemainsSucceedsButNoMoreThanThatDoes()
    var
        Wallet: Record "CG X160 Wallet";
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] A refund for precisely what remains is allowed; one cent more is not
        X160_ClearFixture();
        X160_SeedWallet('W-08', 1000);
        WalletMgt.PostCharge('W-08', 60);
        WalletMgt.PostRefund('W-08', 20);

        WalletMgt.PostRefund('W-08', 40);

        Wallet.Get('W-08');
        Assert.AreEqual(1000.0, Wallet.Balance, 'Expected the wallet to be made fully whole again');

        Commit();
        asserterror WalletMgt.PostRefund('W-08', 0.01);
    end;

    [Test]
    procedure X160_ANonPositiveRefundAmountIsRefused()
    var
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] Zero and negative refund amounts are both rejected
        X160_ClearFixture();
        X160_SeedWallet('W-10', 500);
        WalletMgt.PostCharge('W-10', 200);
        Commit();

        asserterror WalletMgt.PostRefund('W-10', 0);
        Commit();
        asserterror WalletMgt.PostRefund('W-10', -5);
    end;

    [Test]
    procedure X160_RefundingAnUnknownWalletFails()
    var
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] There is no such wallet to refund
        X160_ClearFixture();

        asserterror WalletMgt.PostRefund('NOPE', 10);

        Assert.ExpectedError('NOPE');
    end;

    [Test]
    procedure X160_RefundingOneWalletLeavesAnotherWalletsFiguresAlone()
    var
        WalletA: Record "CG X160 Wallet";
        WalletB: Record "CG X160 Wallet";
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        // [SCENARIO] Two wallets are charged and only one of them is refunded
        X160_ClearFixture();
        X160_SeedWallet('W-11A', 500);
        X160_SeedWallet('W-11B', 500);
        WalletMgt.PostCharge('W-11A', 100);
        WalletMgt.PostCharge('W-11B', 100);

        WalletMgt.PostRefund('W-11A', 40);

        WalletA.Get('W-11A');
        Assert.AreEqual(440.0, WalletA.Balance, 'Expected the refunded wallet to carry its own new balance');
        WalletB.Get('W-11B');
        Assert.AreEqual(400.0, WalletB.Balance, 'Expected the other wallet''s balance to be left exactly as it was');
        Assert.AreEqual(100.0, WalletB."Total Charged",
            'Expected the other wallet''s running total to be left exactly as it was');
        Assert.AreEqual(1, X160_EntryCountFor('W-11B'), 'Expected the other wallet''s ledger to carry only its own entry');
    end;
}
