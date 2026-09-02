codeunit 89512 "CG-AL-X290 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    // This oracle merges 5 independent modules' test suites into one
    // codeunit. Every test and helper procedure is prefixed with the module
    // it belongs to so identical helper names across the source suites cannot
    // collide. Assembled from already-gated donors; see NOTES.md.

    var
        Assert: Codeunit Assert;
        // The default test isolation persists writes between test methods, so
        // every test clears the table before seeding its own rows.
        ShippingNsLbl: Label 'urn:tryal:freight:shipping:v2', Locked = true;
        TrackingNsLbl: Label 'urn:tryal:freight:tracking:v1', Locked = true;
        ForeignNsLbl: Label 'urn:partner:audit:v1', Locked = true;
        // The default test isolation persists writes between test methods
        // (measured 2026-08-20, SOAP runner), so every test clears the table
        // before seeding or importing anything. An unrelated entry seeded with
        // a nonzero sentinel Package Count proves an import never touches rows
        // for a different shipment.
        // every test clears its own tables before seeding its own rows.

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
    // X106 - donor CG-AL-X106
    // ==========================================================

    local procedure X106_Seed(No: Code[20]; BaseTotal: Integer)
    var
        Doc: Record "CG X106 Document";
    begin
        Doc.Init();
        Doc."No." := No;
        Doc."Base Total" := BaseTotal;
        Doc.Insert();
    end;

    [Test]
    procedure X106_ArchivingAQualifyingDocumentKeepsTheEnrichmentNoteAndTheArchiveTag()
    var
        Doc: Record "CG X106 Document";
        ArchiveMgt: Codeunit "CG X106 Archive Mgt";
    begin
        Doc.DeleteAll();
        X106_Seed('DOC001', 100);

        ArchiveMgt.ArchiveDocument('DOC001');

        Doc.Get('DOC001');
        Assert.AreEqual('NOTE-100', Doc."Enrichment Note", 'The archived document must keep the note describing its total');
        Assert.AreEqual('PRIORITY', Doc."Archive Tag", 'A document at the qualifying total must be tagged as priority');
        Assert.AreEqual(100, Doc."Base Total", 'Archiving must not change the document''s recorded total');
    end;

    [Test]
    procedure X106_ArchivingABelowThresholdDocumentKeepsTheEnrichmentNoteAndTheArchiveTag()
    var
        Doc: Record "CG X106 Document";
        ArchiveMgt: Codeunit "CG X106 Archive Mgt";
    begin
        Doc.DeleteAll();
        X106_Seed('DOC002', 99);

        ArchiveMgt.ArchiveDocument('DOC002');

        Doc.Get('DOC002');
        Assert.AreEqual('NOTE-99', Doc."Enrichment Note", 'The archived document must keep the note describing its total');
        Assert.AreEqual('STANDARD', Doc."Archive Tag", 'A document below the qualifying total must be tagged as standard');
    end;

    [Test]
    procedure X106_ArchivingOneDocumentDoesNotChangeAnother()
    var
        Target: Record "CG X106 Document";
        Other: Record "CG X106 Document";
        ArchiveMgt: Codeunit "CG X106 Archive Mgt";
    begin
        Target.DeleteAll();
        Target.Init();
        Target."No." := 'TARGET';
        Target."Base Total" := 250;
        Target.Insert();

        Other.Init();
        Other."No." := 'OTHER';
        Other."Base Total" := 555;
        Other."Enrichment Note" := 'UNTOUCHED-NOTE';
        Other."Archive Tag" := 'UNTOUCHED-TAG';
        Other.Insert();

        ArchiveMgt.ArchiveDocument('TARGET');

        Other.Get('OTHER');
        Assert.AreEqual(555, Other."Base Total", 'An unrelated document''s total must not change');
        Assert.AreEqual('UNTOUCHED-NOTE', Other."Enrichment Note", 'An unrelated document''s enrichment note must not change');
        Assert.AreEqual('UNTOUCHED-TAG', Other."Archive Tag", 'An unrelated document''s archive tag must not change');
    end;

    [Test]
    procedure X106_RefreshingTheArchiveTagAloneLeavesTheEnrichmentNoteUntouched()
    var
        Doc: Record "CG X106 Document";
        ArchiveMgt: Codeunit "CG X106 Archive Mgt";
    begin
        Doc.DeleteAll();
        Doc.Init();
        Doc."No." := 'DOC003';
        Doc."Base Total" := 400;
        Doc."Enrichment Note" := 'PRESEEDED-NOTE';
        Doc.Insert();

        ArchiveMgt.RefreshArchiveTag('DOC003');

        Doc.Get('DOC003');
        Assert.AreEqual('PRIORITY', Doc."Archive Tag", 'A document at or above the qualifying total must be tagged as priority');
        Assert.AreEqual('PRESEEDED-NOTE', Doc."Enrichment Note", 'Refreshing the archive tag alone must not touch the enrichment note');
    end;

    [Test]
    procedure X106_RefreshingTheArchiveTagAloneHandlesTheStandardCase()
    var
        Doc: Record "CG X106 Document";
        ArchiveMgt: Codeunit "CG X106 Archive Mgt";
    begin
        Doc.DeleteAll();
        Doc.Init();
        Doc."No." := 'DOC004';
        Doc."Base Total" := 20;
        Doc."Enrichment Note" := 'PRESEEDED-NOTE-2';
        Doc.Insert();

        ArchiveMgt.RefreshArchiveTag('DOC004');

        Doc.Get('DOC004');
        Assert.AreEqual('STANDARD', Doc."Archive Tag", 'A document below the qualifying total must be tagged as standard');
        Assert.AreEqual('PRESEEDED-NOTE-2', Doc."Enrichment Note", 'Refreshing the archive tag alone must not touch the enrichment note');
    end;

    // ==========================================================
    // X138 - donor CG-AL-X138
    // ==========================================================

    local procedure X138_ClearFixture()
    var
        DocIndex: Record "CG X138 Doc Index";
        InboundDoc: Record "CG X138 Inbound Doc";
        MatchLog: Record "CG X138 Match Log";
    begin
        DocIndex.DeleteAll();
        InboundDoc.DeleteAll();
        MatchLog.DeleteAll();
    end;

    // The graded pairs. Each row is (raw reference, expected key), with the
    // expected value written out rather than derived, so the sweep grades
    // the spec and not whatever the implementation happens to compute.
    local procedure X138_CaseCount(): Integer
    begin
        exit(12);
    end;

    local procedure X138_CaseRaw(Index: Integer): Text[100]
    begin
        case Index of
            1:
                exit('INV-2024-001');
            2:
                exit('inv 2024 001');
            3:
                exit('INV_2024_001');
            4:
                exit('  Inv 2024 001  ');
            5:
                exit('ORD-ALPHA-1001');
            6:
                exit('ord alpha 1001');
            7:
                exit('ORD-BRAVO-2002');
            8:
                exit('');
            9:
                exit('   ---   ');
            10:
                exit('PO-2024-ALPHA-BRAVO-CHARLIE-DELTA');
            11:
                exit('PO-2024-ZULU-YANKEE-XRAY-WHISKEY');
        end;
        exit('INV-2029/099');
    end;

    local procedure X138_CaseExpected(Index: Integer): Code[20]
    begin
        case Index of
            1:
                exit('INV2024001');
            2:
                exit('INV2024001');
            3:
                exit('INV2024001');
            4:
                exit('INV2024001');
            5:
                exit('ORDALPHA1001');
            6:
                exit('ORDALPHA1001');
            7:
                exit('ORDBRAVO2002');
            8:
                exit('');
            9:
                exit('');
            10:
                exit('PO2024ALPHABRAVOCHAR');
            11:
                exit('PO2024ZULUYANKEEXRAY');
        end;
        exit('INV2029099');
    end;

    [Test]
    procedure X138_PreviewedKeysMatchTheGradedSet()
    var
        Matcher: Codeunit "CG X138 Doc Matcher";
        Index: Integer;
    begin
        // [SCENARIO] Every raw reference in the graded set previews to its expected key
        X138_ClearFixture();

        for Index := 1 to X138_CaseCount() do
            Assert.AreEqual(X138_CaseExpected(Index), Matcher.PreviewMatchKey(X138_CaseRaw(Index)),
                StrSubstNo('Expected the previewed key for graded case %1 to match', Index));
    end;

    [Test]
    procedure X138_ImportingPreservesTheOriginalReference()
    var
        InboundDoc: Record "CG X138 Inbound Doc";
        DocIndex: Record "CG X138 Doc Index";
        Matcher: Codeunit "CG X138 Doc Matcher";
    begin
        // [SCENARIO] An imported document keeps its raw reference on file
        X138_ClearFixture();

        Matcher.ImportInboundDoc('DOC-001', 'inv-2024-777', 555.50);

        Assert.IsTrue(InboundDoc.Get('DOC-001'), 'Expected the imported document to exist');
        Assert.AreEqual('inv-2024-777', InboundDoc."External Ref",
            'Expected the document to keep the reference exactly as it was received');
        Assert.AreEqual(555.50, InboundDoc.Amount, 'Expected the document to keep its amount');
        Assert.IsTrue(DocIndex.Get('INV2024777'), 'Expected the document to be indexed under its normalized key');
        Assert.AreEqual('DOC-001', DocIndex."Doc No.", 'Expected the index entry to point at the imported document');
    end;

    [Test]
    procedure X138_MatchingFindsADifferentlyFormattedReference()
    var
        MatchLog: Record "CG X138 Match Log";
        Matcher: Codeunit "CG X138 Doc Matcher";
        Matched: Boolean;
    begin
        // [SCENARIO] An incoming remittance names the same document with different formatting
        X138_ClearFixture();
        Matcher.ImportInboundDoc('DOC-050', 'INV-2024-050', 100);

        Matched := Matcher.TryMatchIncoming('inv 2024 050');

        Assert.IsTrue(Matched, 'Expected a differently formatted reference to still match');
        Assert.IsTrue(MatchLog.FindLast(), 'Expected the match attempt to be logged');
        Assert.AreEqual('inv 2024 050', MatchLog."Incoming Ref",
            'Expected the log to keep the incoming reference exactly as it was received');
        Assert.AreEqual('INV2024050', MatchLog."Match Key Used", 'Expected the log to record the key used to match');
        Assert.AreEqual('DOC-050', MatchLog."Matched Doc No.", 'Expected the log to record which document was matched');
    end;

    [Test]
    procedure X138_MatchingAnUnindexedReferenceFindsNothing()
    var
        MatchLog: Record "CG X138 Match Log";
        Matcher: Codeunit "CG X138 Doc Matcher";
        Matched: Boolean;
    begin
        // [SCENARIO] The incoming reference was never imported
        X138_ClearFixture();
        Matcher.ImportInboundDoc('DOC-060', 'INV-2024-060', 100);

        Matched := Matcher.TryMatchIncoming('INV-2024-999');

        Assert.IsFalse(Matched, 'Expected an unindexed reference not to match');
        Assert.IsTrue(MatchLog.FindLast(), 'Expected the failed match attempt to be logged too');
        Assert.AreEqual('', MatchLog."Matched Doc No.", 'Expected no document to be recorded for a failed match');
        Assert.AreEqual('INV-2024-999', MatchLog."Incoming Ref",
            'Expected the log to keep the incoming reference exactly as it was received');
    end;

    [Test]
    procedure X138_DistinctReferencesStayDistinctThroughMatching()
    var
        InboundDoc: Record "CG X138 Inbound Doc";
        Matcher: Codeunit "CG X138 Doc Matcher";
        Matched: Boolean;
    begin
        // [SCENARIO] Two unrelated documents are imported and matched independently
        X138_ClearFixture();
        Matcher.ImportInboundDoc('DOC-A', 'ORD-ALPHA-1001', 111);
        Matcher.ImportInboundDoc('DOC-B', 'ORD-BRAVO-2002', 222);

        Matched := Matcher.TryMatchIncoming('ord alpha 1001');
        Assert.IsTrue(Matched, 'Expected the first document''s reference to match');

        InboundDoc.Get('DOC-B');
        Assert.AreEqual('ORD-BRAVO-2002', InboundDoc."External Ref",
            'Expected the untouched document to keep its own reference');
        Assert.AreEqual(222.0, InboundDoc.Amount, 'Expected the untouched document to keep its own amount');

        Matched := Matcher.TryMatchIncoming('ORD-BRAVO-2002');
        Assert.IsTrue(Matched, 'Expected the second document''s own reference to match too');
    end;

    [Test]
    procedure X138_OverlongReferencesTruncateWithoutColliding()
    var
        DocIndexA: Record "CG X138 Doc Index";
        DocIndexB: Record "CG X138 Doc Index";
        Matcher: Codeunit "CG X138 Doc Matcher";
    begin
        // [SCENARIO] Two long references that only diverge after the key's length limit
        X138_ClearFixture();
        Matcher.ImportInboundDoc('DOC-LONG-A', 'PO-2024-ALPHA-BRAVO-CHARLIE-DELTA', 10);
        Matcher.ImportInboundDoc('DOC-LONG-B', 'PO-2024-ZULU-YANKEE-XRAY-WHISKEY', 20);

        Assert.IsTrue(DocIndexA.Get('PO2024ALPHABRAVOCHAR'),
            'Expected the first long reference to be indexed under its truncated key');
        Assert.AreEqual('DOC-LONG-A', DocIndexA."Doc No.", 'Expected the first index entry to point at its own document');
        Assert.IsTrue(DocIndexB.Get('PO2024ZULUYANKEEXRAY'),
            'Expected the second long reference to be indexed under its own truncated key');
        Assert.AreEqual('DOC-LONG-B', DocIndexB."Doc No.", 'Expected the second index entry to point at its own document');
    end;

    [Test]
    procedure X138_BlankReferenceStillImportsCleanly()
    var
        InboundDoc: Record "CG X138 Inbound Doc";
        DocIndex: Record "CG X138 Doc Index";
        Matcher: Codeunit "CG X138 Doc Matcher";
    begin
        // [SCENARIO] A document arrives with no external reference at all
        X138_ClearFixture();

        Matcher.ImportInboundDoc('DOC-BLANK', '', 42);

        Assert.IsTrue(InboundDoc.Get('DOC-BLANK'), 'Expected the document to be imported even with a blank reference');
        Assert.AreEqual('', InboundDoc."External Ref", 'Expected the blank reference to stay blank');
        Assert.IsTrue(DocIndex.Get(''), 'Expected a blank reference to still be indexed under a blank key');
    end;

    [Test]
    procedure X138_MatchingByDocumentNumberNeedsNoReferenceAtAll()
    var
        InboundDoc: Record "CG X138 Inbound Doc";
        Matcher: Codeunit "CG X138 Doc Matcher";
    begin
        // [SCENARIO] Some callers only ever look a document up by its own number
        X138_ClearFixture();
        InboundDoc.Init();
        InboundDoc."No." := 'DOC-DIRECT';
        InboundDoc."External Ref" := 'whatever-arrived';
        InboundDoc.Amount := 999;
        InboundDoc.Insert();

        Assert.IsTrue(Matcher.MatchByDocNo('DOC-DIRECT'), 'Expected a direct lookup by document number to succeed');
        Assert.IsFalse(Matcher.MatchByDocNo('DOC-NOPE'), 'Expected a direct lookup for an unknown document number to fail cleanly');
    end;

    [Test]
    procedure X138_RepeatedMatchAttemptsAreEachLoggedInOrder()
    var
        MatchLog: Record "CG X138 Match Log";
        Matcher: Codeunit "CG X138 Doc Matcher";
    begin
        // [SCENARIO] Several match attempts against the same document are each logged
        X138_ClearFixture();
        Matcher.ImportInboundDoc('DOC-070', 'INV-2024-070', 100);

        Matcher.TryMatchIncoming('inv 2024 070');
        Matcher.TryMatchIncoming('INV-2024-071');
        Matcher.TryMatchIncoming('inv/2024/070');

        Assert.AreEqual(3, MatchLog.Count(), 'Expected one log entry per match attempt');
        MatchLog.FindLast();
        Assert.AreEqual('inv/2024/070', MatchLog."Incoming Ref",
            'Expected the most recent log entry to describe the most recent attempt');
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
