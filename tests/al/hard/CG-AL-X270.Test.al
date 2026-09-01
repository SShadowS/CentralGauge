codeunit 89492 "CG-AL-X270 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    // This oracle merges 8 independent modules' test suites into one
    // codeunit. Every test and helper procedure is prefixed with the module
    // it belongs to so identical helper names across the source suites cannot
    // collide. Assembled from already-gated donors; see NOTES.md.

    var
        Assert: Codeunit Assert;
        // The default test isolation persists writes between test methods, so
        // every test clears every table this scenario touches before seeding
        // its own rows.
        // every test clears the table before seeding its own rows.
        ShippingNsLbl: Label 'urn:tryal:freight:shipping:v2', Locked = true;
        TrackingNsLbl: Label 'urn:tryal:freight:tracking:v1', Locked = true;
        ForeignNsLbl: Label 'urn:partner:audit:v1', Locked = true;
        // The default test isolation persists writes between test methods
        // (measured 2026-08-20, SOAP runner), so every test clears the table
        // before seeding or importing anything. An unrelated entry seeded with
        // a nonzero sentinel Package Count proves an import never touches rows
        // for a different shipment.
        // (measured, SOAP runner), so every test clears both tables before
        // seeding its own rows.
        // (measured 2026-08-20, SOAP runner), so every test clears both tables
        // before seeding its own rows.
        // every test clears its own tables before seeding its own rows.

    // ==========================================================
    // X073 - donor CG-AL-X073
    // ==========================================================

    local procedure X073_ClearAll()
    var
        ProductCategory: Record "CG X073 Product Category";
        Product: Record "CG X073 Product";
        CategoryReportFilter: Record "CG X073 Category Report Filter";
    begin
        ProductCategory.DeleteAll();
        Product.DeleteAll();
        CategoryReportFilter.DeleteAll();
    end;

    local procedure X073_SetFilterEnabled(FilterCode: Code[20]; NewEnabled: Boolean)
    var
        CategoryReportFilter: Record "CG X073 Category Report Filter";
    begin
        CategoryReportFilter.Get(FilterCode);
        CategoryReportFilter.Enabled := NewEnabled;
        CategoryReportFilter.Modify();
    end;

    [Test]
    procedure X073_RenamedCategoryCodeReachesItsOwnReportFilter()
    var
        CategoryReportFilter: Record "CG X073 Category Report Filter";
        RenameMgt: Codeunit "CG X073 Category Rename Mgt.";
    begin
        X073_ClearAll();
        RenameMgt.CreateCategory('OLDCAT', 'Old Category');
        RenameMgt.CreateReportFilter('FILT1', 'Category Summary', 'OLDCAT');

        RenameMgt.RenameCategory('OLDCAT', 'NEWCAT');

        CategoryReportFilter.Get('FILT1');
        Assert.AreEqual('NEWCAT', CategoryReportFilter."Category Code", 'The report filter must point at the category''s current code after a rename');
        Assert.AreEqual('Category Summary', CategoryReportFilter."Filter Description", 'The filter''s own description must not change when its category is renamed');
    end;

    [Test]
    procedure X073_MatchingProductCountReflectsRenamedCategory()
    var
        RenameMgt: Codeunit "CG X073 Category Rename Mgt.";
    begin
        X073_ClearAll();
        RenameMgt.CreateCategory('OLDCAT', 'Old Category');
        RenameMgt.AssignProduct('P001', 'Widget', 'OLDCAT', 12.5);
        RenameMgt.AssignProduct('P002', 'Gadget', 'OLDCAT', 7.25);
        RenameMgt.AssignProduct('P003', 'Gizmo', 'OLDCAT', 3.1);
        RenameMgt.CreateReportFilter('FILT1', 'Category Summary', 'OLDCAT');

        RenameMgt.RenameCategory('OLDCAT', 'NEWCAT');

        Assert.AreEqual(3, RenameMgt.CountMatchingProducts('FILT1'), 'A report filter for the category must still count all its products after the category is renamed');
    end;

    [Test]
    procedure X073_UnrelatedReportFilterKeepsItsOwnCategoryCode()
    var
        CategoryReportFilter: Record "CG X073 Category Report Filter";
        RenameMgt: Codeunit "CG X073 Category Rename Mgt.";
    begin
        X073_ClearAll();
        RenameMgt.CreateCategory('OLDCAT', 'Old Category');
        RenameMgt.CreateCategory('SIDECAT', 'Side Category');
        RenameMgt.CreateReportFilter('FILT1', 'Category Summary', 'OLDCAT');
        RenameMgt.CreateReportFilter('FILTSIDE', 'Side Summary', 'SIDECAT');

        RenameMgt.RenameCategory('OLDCAT', 'NEWCAT');

        CategoryReportFilter.Get('FILTSIDE');
        Assert.AreEqual('SIDECAT', CategoryReportFilter."Category Code", 'A report filter for a different category must not be touched by an unrelated rename');
        Assert.AreEqual('Side Summary', CategoryReportFilter."Filter Description", 'An unrelated filter''s description must stay exactly as it was');
    end;

    [Test]
    procedure X073_EveryReportFilterOnTheRenamedCategoryUpdates()
    var
        CategoryReportFilter: Record "CG X073 Category Report Filter";
        RenameMgt: Codeunit "CG X073 Category Rename Mgt.";
    begin
        X073_ClearAll();
        RenameMgt.CreateCategory('OLDCAT', 'Old Category');
        RenameMgt.CreateReportFilter('FILTA', 'Filter A', 'OLDCAT');
        RenameMgt.CreateReportFilter('FILTB', 'Filter B', 'OLDCAT');
        X073_SetFilterEnabled('FILTB', false);

        RenameMgt.RenameCategory('OLDCAT', 'NEWCAT');

        CategoryReportFilter.Get('FILTA');
        Assert.AreEqual('NEWCAT', CategoryReportFilter."Category Code", 'Filter A must follow the category rename');
        Assert.IsTrue(CategoryReportFilter.Enabled, 'Filter A''s own enabled state must not change from the rename');

        CategoryReportFilter.Get('FILTB');
        Assert.AreEqual('NEWCAT', CategoryReportFilter."Category Code", 'Filter B must follow the category rename');
        Assert.IsFalse(CategoryReportFilter.Enabled, 'Filter B''s own enabled state must not change from the rename');
    end;

    [Test]
    procedure X073_ProductAssignmentsStillFollowARenamedCategory()
    var
        Product: Record "CG X073 Product";
        RenameMgt: Codeunit "CG X073 Category Rename Mgt.";
    begin
        X073_ClearAll();
        RenameMgt.CreateCategory('OLDCAT', 'Old Category');
        RenameMgt.CreateCategory('SIDECAT', 'Side Category');
        RenameMgt.AssignProduct('P001', 'Widget', 'OLDCAT', 12.5);
        RenameMgt.AssignProduct('P002', 'Gadget', 'OLDCAT', 7.25);
        RenameMgt.AssignProduct('P900', 'Untouched Item', 'SIDECAT', 999.99);

        RenameMgt.RenameCategory('OLDCAT', 'NEWCAT');

        Product.Get('P001');
        Assert.AreEqual('NEWCAT', Product."Category Code", 'A product in the renamed category must carry the new code');
        Product.Get('P002');
        Assert.AreEqual('NEWCAT', Product."Category Code", 'Every product in the renamed category must carry the new code');
        Product.Get('P900');
        Assert.AreEqual('SIDECAT', Product."Category Code", 'A product in a different category must keep its own code');
        Assert.AreEqual(999.99, Product."Unit Price", 'A product outside the renamed category must be left completely untouched');
    end;

    [Test]
    procedure X073_RenamingACategoryWithNoReportFiltersDoesNotCreateOne()
    var
        CategoryReportFilter: Record "CG X073 Category Report Filter";
        RenameMgt: Codeunit "CG X073 Category Rename Mgt.";
    begin
        X073_ClearAll();
        RenameMgt.CreateCategory('OLDCAT', 'Old Category');
        RenameMgt.AssignProduct('P001', 'Widget', 'OLDCAT', 12.5);

        RenameMgt.RenameCategory('OLDCAT', 'NEWCAT');

        Assert.IsFalse(CategoryReportFilter.FindFirst(), 'No report filter existed for this category, so a rename must not create one');
    end;

    [Test]
    procedure X073_RenameActuallyRenamesTheCategoryRecordItself()
    var
        ProductCategory: Record "CG X073 Product Category";
        RenameMgt: Codeunit "CG X073 Category Rename Mgt.";
    begin
        X073_ClearAll();
        RenameMgt.CreateCategory('OLDCAT', 'Old Category');

        RenameMgt.RenameCategory('OLDCAT', 'NEWCAT');

        Assert.IsTrue(ProductCategory.Get('NEWCAT'), 'The category record itself must exist under its new code after a rename');
        Assert.AreEqual('Old Category', ProductCategory.Description, 'The category''s own description must survive the rename');
        Assert.IsFalse(ProductCategory.Get('OLDCAT'), 'The category record must no longer exist under its old code after a rename');
    end;

    [Test]
    procedure X073_CountMatchingProductsExcludesProductsInAnUnrelatedCategory()
    var
        RenameMgt: Codeunit "CG X073 Category Rename Mgt.";
    begin
        X073_ClearAll();
        RenameMgt.CreateCategory('OLDCAT', 'Old Category');
        RenameMgt.CreateCategory('OTHERCAT', 'Other Category');
        RenameMgt.AssignProduct('P001', 'Widget', 'OLDCAT', 12.5);
        RenameMgt.AssignProduct('P002', 'Gadget', 'OLDCAT', 7.25);
        RenameMgt.AssignProduct('P900', 'Unrelated Item', 'OTHERCAT', 50);
        RenameMgt.CreateReportFilter('FILT1', 'Category Summary', 'OLDCAT');

        Assert.AreEqual(2, RenameMgt.CountMatchingProducts('FILT1'),
          'A report filter must count only products in its own category, not every product in the company');
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
    // X087 - donor CG-AL-X087
    // ==========================================================

    local procedure X087_Reset()
    var
        Header: Record "CG X087 Document Header";
    begin
        Header.DeleteAll();
    end;

    local procedure X087_SeedSource(No: Code[20]; DescriptionValue: Text[100])
    var
        Header: Record "CG X087 Document Header";
    begin
        Header.Init();
        Header."No." := No;
        Header.Description := DescriptionValue;
        Header.Status := Header.Status::Open;
        Header.Insert();
    end;

    [Test]
    procedure X087_CopyingADocumentEndsUpReleasedAndAudited()
    var
        Header: Record "CG X087 Document Header";
        SourceHeader: Record "CG X087 Document Header";
        CopyMgt: Codeunit "CG X087 Document Copy Mgt";
    begin
        X087_Reset();
        X087_SeedSource('SRC001', 'Original document');

        CopyMgt.CopyDocument('SRC001', 'NEW001');

        Header.Get('NEW001');
        Assert.AreEqual('SRC001', Header."Copied From No.", 'The copy must record which document it came from');
        Assert.AreEqual('Original document', Header.Description, 'The copy must carry over the source description');
        Assert.AreEqual(Header.Status::Released, Header.Status, 'The copy must end up released');
        Assert.AreEqual('REL-NEW001', Header."Release Reference", 'The copy must keep the release reference recorded when it was released');
        Assert.IsTrue(Header."Copy Audited", 'The copy must be marked as audited');

        SourceHeader.Get('SRC001');
        Assert.AreEqual(SourceHeader.Status::Open, SourceHeader.Status, 'The source document must be left untouched');
        Assert.AreEqual('', SourceHeader."Release Reference", 'The source document must not gain a release reference');
        Assert.IsFalse(SourceHeader."Copy Audited", 'The source document must not be marked as audited');
    end;

    [Test]
    procedure X087_AuditingADocumentDirectlyLeavesOtherFieldsUnchanged()
    var
        Header: Record "CG X087 Document Header";
        CopyMgt: Codeunit "CG X087 Document Copy Mgt";
    begin
        X087_Reset();
        Header.Init();
        Header."No." := 'STANDALONE';
        Header.Description := 'Directly entered document';
        Header.Status := Header.Status::Copied;
        Header.Insert();

        CopyMgt.AuditDocument('STANDALONE');

        Header.Get('STANDALONE');
        Assert.IsTrue(Header."Copy Audited", 'A directly audited document must be marked as audited');
        Assert.AreEqual(Header.Status::Copied, Header.Status, 'Auditing a document must not change its status, even one currently showing as copied');
        Assert.AreEqual('', Header."Release Reference", 'Auditing a document directly must not invent a release reference');
    end;

    [Test]
    procedure X087_AuditingOneDocumentDoesNotChangeAnother()
    var
        Target: Record "CG X087 Document Header";
        Other: Record "CG X087 Document Header";
        CopyMgt: Codeunit "CG X087 Document Copy Mgt";
    begin
        X087_Reset();
        Target.Init();
        Target."No." := 'TARGET';
        Target.Description := 'Document to audit';
        Target.Status := Target.Status::Open;
        Target.Insert();

        Other.Init();
        Other."No." := 'OTHER';
        Other.Description := 'Unrelated document';
        Other.Status := Other.Status::Released;
        Other."Copy Audited" := true;
        Other."Release Reference" := 'REL-OTHER';
        Other.Insert();

        CopyMgt.AuditDocument('TARGET');

        Other.Get('OTHER');
        Assert.AreEqual(Other.Status::Released, Other.Status, 'An unrelated document''s status must not change');
        Assert.IsTrue(Other."Copy Audited", 'An unrelated document''s audited flag must not change');
        Assert.AreEqual('Unrelated document', Other.Description, 'An unrelated document''s description must not change');
        Assert.AreEqual('REL-OTHER', Other."Release Reference", 'An unrelated document''s release reference must not change');
    end;

    // ==========================================================
    // X102 - donor CG-AL-X102
    // ==========================================================

    local procedure X102_AddRow(var Buffer: Record "CG X102 Working Row" temporary; EntryNo: Integer; RowDescription: Text[50]; RowAmount: Decimal)
    begin
        Buffer.Init();
        Buffer."Entry No." := EntryNo;
        Buffer.Description := RowDescription;
        Buffer.Amount := RowAmount;
        Buffer.Insert();
    end;

    [Test]
    procedure X102_SnapshotHoldsEveryRowThatExistedWhenTaken()
    var
        Source: Record "CG X102 Working Row" temporary;
        Snapshot: Record "CG X102 Working Row" temporary;
        BufferSvc: Codeunit "CG X102 Buffer Service";
    begin
        X102_AddRow(Source, 1, 'First', 111);
        X102_AddRow(Source, 2, 'Second', 222);

        BufferSvc.TakeSnapshot(Source, Snapshot);

        Snapshot.Reset();
        Assert.AreEqual(2, Snapshot.Count(), 'The snapshot must hold every row that existed at the moment it was taken');
        Assert.IsTrue(Snapshot.Get(1), 'The snapshot must contain the row with entry number 1');
        Assert.AreEqual('First', Snapshot.Description, 'The snapshot row must carry the source row''s description');
        Assert.AreEqual(111, Snapshot.Amount, 'The snapshot row must carry the source row''s amount');
        Assert.IsTrue(Snapshot.Get(2), 'The snapshot must contain the row with entry number 2');
        Assert.AreEqual(222, Snapshot.Amount, 'The snapshot row must carry the source row''s amount');
    end;

    [Test]
    procedure X102_SnapshotIgnoresARowAddedToTheSourceAfterwards()
    var
        Source: Record "CG X102 Working Row" temporary;
        Snapshot: Record "CG X102 Working Row" temporary;
        BufferSvc: Codeunit "CG X102 Buffer Service";
    begin
        X102_AddRow(Source, 1, 'First', 111);
        X102_AddRow(Source, 2, 'Second', 222);
        BufferSvc.TakeSnapshot(Source, Snapshot);

        X102_AddRow(Source, 3, 'Late', 333);

        Snapshot.Reset();
        Assert.AreEqual(2, Snapshot.Count(), 'The snapshot must keep the row count it had at the moment it was taken');
        Assert.IsFalse(Snapshot.Get(3), 'A row added to the source after the snapshot was taken must not appear in the snapshot');
    end;

    [Test]
    procedure X102_SnapshotKeepsTheAmountARowHadWhenTaken()
    var
        Source: Record "CG X102 Working Row" temporary;
        Snapshot: Record "CG X102 Working Row" temporary;
        BufferSvc: Codeunit "CG X102 Buffer Service";
    begin
        X102_AddRow(Source, 10, 'Rate', 500);
        BufferSvc.TakeSnapshot(Source, Snapshot);

        Source.Get(10);
        Source.Amount := 900;
        Source.Modify();

        Assert.IsTrue(Snapshot.Get(10), 'The snapshot must contain the row with entry number 10');
        Assert.AreEqual(500, Snapshot.Amount, 'The snapshot must keep the amount the row had when it was taken, not a later change made to the source');
    end;

    [Test]
    procedure X102_SnapshotKeepsARowThatIsLaterRemovedFromTheSource()
    var
        Source: Record "CG X102 Working Row" temporary;
        Snapshot: Record "CG X102 Working Row" temporary;
        BufferSvc: Codeunit "CG X102 Buffer Service";
    begin
        X102_AddRow(Source, 20, 'Keep', 40);
        X102_AddRow(Source, 21, 'Doomed', 80);
        BufferSvc.TakeSnapshot(Source, Snapshot);

        Source.Get(21);
        Source.Delete();

        Snapshot.Reset();
        Assert.AreEqual(2, Snapshot.Count(), 'The snapshot must keep both rows it was taken with, even after one is later removed from the source');
        Assert.IsTrue(Snapshot.Get(21), 'A row removed from the source after the snapshot was taken must still exist in the snapshot');
        Assert.AreEqual(80, Snapshot.Amount, 'The removed row must keep the amount it had when the snapshot was taken');
    end;

    [Test]
    procedure X102_TakingASnapshotDoesNotDisturbTheSourceRows()
    var
        Source: Record "CG X102 Working Row" temporary;
        Snapshot: Record "CG X102 Working Row" temporary;
        BufferSvc: Codeunit "CG X102 Buffer Service";
    begin
        X102_AddRow(Source, 1, 'First', 10);
        X102_AddRow(Source, 2, 'Middle', 20);
        X102_AddRow(Source, 3, 'Last', 30);

        BufferSvc.TakeSnapshot(Source, Snapshot);

        Source.Reset();
        Assert.AreEqual(3, Source.Count(), 'Every source row must still be there after taking a snapshot');
        Assert.IsTrue(Source.Get(2), 'The source row with entry number 2 must survive taking a snapshot');
        Assert.AreEqual(20, Source.Amount, 'The source row amounts must be untouched by taking a snapshot');
    end;

    [Test]
    procedure X102_SharedViewSeesARowAddedToTheSourceAfterAttaching()
    var
        Source: Record "CG X102 Working Row" temporary;
        SharedView: Record "CG X102 Working Row" temporary;
        BufferSvc: Codeunit "CG X102 Buffer Service";
    begin
        X102_AddRow(Source, 1, 'Seed', 10);
        BufferSvc.AttachSharedView(Source, SharedView);

        X102_AddRow(Source, 2, 'Late', 55);

        SharedView.Reset();
        Assert.AreEqual(2, SharedView.Count(), 'The shared view must see a row added to the source after attaching');
        Assert.IsTrue(SharedView.Get(2), 'The shared view must reach a row added to the source after attaching');
        Assert.AreEqual(55, SharedView.Amount, 'The shared view must read the added row''s amount');
    end;

    [Test]
    procedure X102_SharedViewReflectsAChangeMadeThroughTheSource()
    var
        Source: Record "CG X102 Working Row" temporary;
        SharedView: Record "CG X102 Working Row" temporary;
        BufferSvc: Codeunit "CG X102 Buffer Service";
    begin
        X102_AddRow(Source, 30, 'Status', 15);
        BufferSvc.AttachSharedView(Source, SharedView);

        Source.Get(30);
        Source.Amount := 77;
        Source.Modify();

        Assert.IsTrue(SharedView.Get(30), 'The shared view must reach the row the source holds');
        Assert.AreEqual(77, SharedView.Amount, 'The shared view must read the amount the source row was changed to after attaching');
    end;

    [Test]
    procedure X102_AWriteMadeThroughTheSharedViewReachesTheSource()
    var
        Source: Record "CG X102 Working Row" temporary;
        SharedView: Record "CG X102 Working Row" temporary;
        BufferSvc: Codeunit "CG X102 Buffer Service";
    begin
        X102_AddRow(Source, 40, 'Target', 5);
        BufferSvc.AttachSharedView(Source, SharedView);

        Assert.IsTrue(SharedView.Get(40), 'The shared view must reach the row the source holds');
        SharedView.Amount := 99;
        SharedView.Modify();

        Source.Get(40);
        Assert.AreEqual(99, Source.Amount, 'A change written through the shared view must be visible in the source');
    end;

    // ==========================================================
    // X137 - donor CG-AL-X137
    // ==========================================================

    local procedure X137_SeedImportLine(EntryNo: Integer; BatchNo: Code[20]; Amount: Integer)
    var
        ImportLine: Record "CG X137 Import Line";
    begin
        ImportLine.Init();
        ImportLine."Entry No." := EntryNo;
        ImportLine."Batch No." := BatchNo;
        ImportLine.Amount := Amount;
        ImportLine.Insert();
    end;

    local procedure X137_SeedPostedEntry(EntryNo: Integer; BatchNo: Code[20]; Amount: Integer)
    var
        PostedEntry: Record "CG X137 Posted Entry";
    begin
        PostedEntry.Init();
        PostedEntry."Entry No." := EntryNo;
        PostedEntry."Batch No." := BatchNo;
        PostedEntry.Amount := Amount;
        PostedEntry.Insert();
    end;

    local procedure X137_PostedExists(EntryNo: Integer): Boolean
    var
        PostedEntry: Record "CG X137 Posted Entry";
    begin
        exit(PostedEntry.Get(EntryNo));
    end;

    local procedure X137_PostedAmount(EntryNo: Integer): Integer
    var
        PostedEntry: Record "CG X137 Posted Entry";
    begin
        PostedEntry.Get(EntryNo);
        exit(PostedEntry.Amount);
    end;

    local procedure X137_CountPostedInBatch(BatchNo: Code[20]): Integer
    var
        PostedEntry: Record "CG X137 Posted Entry";
    begin
        PostedEntry.SetRange("Batch No.", BatchNo);
        exit(PostedEntry.Count());
    end;

    [Test]
    procedure X137_HappyPathPostsEveryGoodLine()
    var
        ImportLine: Record "CG X137 Import Line";
        PostedEntry: Record "CG X137 Posted Entry";
        Poster: Codeunit "CG X137 Batch Poster";
    begin
        ImportLine.DeleteAll();
        PostedEntry.DeleteAll();

        X137_SeedImportLine(1, 'B1', 50);
        X137_SeedImportLine(2, 'B1', 30);
        X137_SeedImportLine(3, 'B1', 20);

        Poster.PostBatch('B1');

        Assert.AreEqual(3, Poster.PostedCountLastRun(), 'All three lines in a clean batch should post.');
        Assert.AreEqual(0, Poster.SkippedCountLastRun(), 'Nothing should be skipped on a clean first run.');
        Assert.AreEqual(50, X137_PostedAmount(1), 'Line 1 amount must reach the ledger unchanged.');
        Assert.AreEqual(30, X137_PostedAmount(2), 'Line 2 amount must reach the ledger unchanged.');
        Assert.AreEqual(20, X137_PostedAmount(3), 'Line 3 amount must reach the ledger unchanged.');
    end;

    [Test]
    procedure X137_RetryAfterFixPostsEveryGoodLine()
    var
        ImportLine: Record "CG X137 Import Line";
        PostedEntry: Record "CG X137 Posted Entry";
        Poster: Codeunit "CG X137 Batch Poster";
    begin
        ImportLine.DeleteAll();
        PostedEntry.DeleteAll();

        X137_SeedImportLine(101, 'B1', 40);
        X137_SeedImportLine(102, 'B1', 25);
        X137_SeedImportLine(103, 'B1', 0); // invalid: a non-positive amount is rejected
        Commit();

        asserterror Poster.PostBatch('B1');

        ImportLine.Get(103);
        ImportLine.Amount := 15;
        ImportLine.Modify();
        Commit();

        Poster.PostBatch('B1');

        Assert.AreEqual(3, Poster.PostedCountLastRun(), 'The retry must post every line of the batch that is not yet in the ledger.');
        Assert.AreEqual(0, Poster.SkippedCountLastRun(), 'Nothing in this batch reached the ledger before the retry.');
        Assert.IsTrue(X137_PostedExists(101), 'Line 101 must reach the ledger once the batch is fixed and re-run.');
        Assert.IsTrue(X137_PostedExists(102), 'Line 102 must reach the ledger once the batch is fixed and re-run.');
        Assert.AreEqual(40, X137_PostedAmount(101), 'Line 101 must post with its original amount.');
        Assert.AreEqual(25, X137_PostedAmount(102), 'Line 102 must post with its original amount.');
        Assert.AreEqual(15, X137_PostedAmount(103), 'Line 103 must post with its corrected amount.');
        Assert.AreEqual(3, X137_CountPostedInBatch('B1'), 'The ledger must hold every line of the batch after the retry, no more and no fewer.');
    end;

    [Test]
    procedure X137_RepeatingACleanRunDoesNotDuplicate()
    var
        ImportLine: Record "CG X137 Import Line";
        PostedEntry: Record "CG X137 Posted Entry";
        Poster: Codeunit "CG X137 Batch Poster";
    begin
        ImportLine.DeleteAll();
        PostedEntry.DeleteAll();

        X137_SeedImportLine(201, 'B2', 60);
        X137_SeedImportLine(202, 'B2', 45);

        Poster.PostBatch('B2');
        Assert.AreEqual(2, Poster.PostedCountLastRun(), 'The first run should post both lines.');
        Assert.AreEqual(0, Poster.SkippedCountLastRun(), 'Nothing is posted yet before the first run.');

        Poster.PostBatch('B2');
        Assert.AreEqual(0, Poster.PostedCountLastRun(), 'Re-running an unchanged batch must not post its lines again.');
        Assert.AreEqual(2, Poster.SkippedCountLastRun(), 'Re-running an unchanged batch must report both lines as already handled.');

        Assert.AreEqual(2, X137_CountPostedInBatch('B2'), 'The ledger must still hold exactly one row per line, not duplicates.');
        Assert.AreEqual(60, X137_PostedAmount(201), 'Line 201 amount must be unaffected by the repeated run.');
        Assert.AreEqual(45, X137_PostedAmount(202), 'Line 202 amount must be unaffected by the repeated run.');
    end;

    [Test]
    procedure X137_PostingOneBatchLeavesAnotherBatchUntouched()
    var
        ImportLine: Record "CG X137 Import Line";
        PostedEntry: Record "CG X137 Posted Entry";
        Poster: Codeunit "CG X137 Batch Poster";
    begin
        ImportLine.DeleteAll();
        PostedEntry.DeleteAll();

        X137_SeedImportLine(301, 'B3', 12);
        X137_SeedImportLine(302, 'B3', 8);
        X137_SeedImportLine(401, 'B4', 99);
        X137_SeedPostedEntry(999, 'B4', 777);

        Poster.PostBatch('B3');

        Assert.AreEqual(2, Poster.PostedCountLastRun(), 'Posting one batch must post only that batch''s lines.');
        Assert.AreEqual(0, Poster.SkippedCountLastRun(), 'Nothing in this batch reached the ledger before this run.');
        Assert.AreEqual(12, X137_PostedAmount(301), 'Line 301 must post with its own amount.');
        Assert.AreEqual(8, X137_PostedAmount(302), 'Line 302 must post with its own amount.');
        Assert.IsFalse(X137_PostedExists(401), 'A line belonging to a different batch must not be posted by this run.');
        Assert.AreEqual(777, X137_PostedAmount(999), 'A previously posted line from another batch must be left untouched.');
        Assert.AreEqual(1, X137_CountPostedInBatch('B4'), 'The other batch''s ledger rows must be unaffected by posting this batch.');
    end;

    // ==========================================================
    // X140 - donor CG-AL-X140
    // ==========================================================

    local procedure X140_ClearAllData()
    var
        RebateHeader: Record "CG X140 Rebate Header";
        RebateLine: Record "CG X140 Rebate Line";
    begin
        RebateLine.DeleteAll();
        RebateHeader.DeleteAll();
    end;

    local procedure X140_SeedHeader(DocumentNo: Code[20]; TotalAmount: Decimal)
    var
        RebateHeader: Record "CG X140 Rebate Header";
    begin
        RebateHeader.Init();
        RebateHeader."No." := DocumentNo;
        RebateHeader."Rebate Description" := 'Test rebate';
        RebateHeader."Total Rebate Amount" := TotalAmount;
        RebateHeader.Insert();
    end;

    local procedure X140_SeedLine(DocumentNo: Code[20]; LineNo: Integer; ItemDescription: Text[100]; LineWeight: Decimal)
    var
        RebateLine: Record "CG X140 Rebate Line";
    begin
        RebateLine.Init();
        RebateLine."Document No." := DocumentNo;
        RebateLine."Line No." := LineNo;
        RebateLine."Item Description" := ItemDescription;
        RebateLine."Allocation Weight" := LineWeight;
        RebateLine.Insert();
    end;

    local procedure X140_SeedLineWithSentinel(DocumentNo: Code[20]; LineNo: Integer; LineWeight: Decimal; SentinelAmount: Decimal)
    var
        RebateLine: Record "CG X140 Rebate Line";
    begin
        RebateLine.Init();
        RebateLine."Document No." := DocumentNo;
        RebateLine."Line No." := LineNo;
        RebateLine."Allocation Weight" := LineWeight;
        RebateLine."Rebate Amount" := SentinelAmount;
        RebateLine.Insert();
    end;

    local procedure X140_GetLineAmount(DocumentNo: Code[20]; LineNo: Integer): Decimal
    var
        RebateLine: Record "CG X140 Rebate Line";
    begin
        RebateLine.Get(DocumentNo, LineNo);
        exit(RebateLine."Rebate Amount");
    end;

    // Independently reconstructs the allocation every correct implementation
    // must produce: floor everyone's exact proportional share to the cent,
    // then hand out whatever the floors left on the table one cent at a time
    // to the lines closest to rounding up, tie-broken by the lower line
    // number. A zero-weight line's remainder is always exactly zero, so it
    // never competes for a leftover cent. This mirrors the allocator's own
    // fix - it is the definition of "correct" this oracle grades against,
    // not a re-implementation that happens to agree with one particular
    // solution.
    local procedure X140_ComputeExpectedShares(Weight: array[10] of Decimal; LineNo: array[10] of Integer; LineCount: Integer; TotalAmount: Decimal; var ExpectedShare: array[10] of Decimal)
    var
        Remainder: array[10] of Decimal;
        Awarded: array[10] of Boolean;
        WeightSum: Decimal;
        FloorSum: Decimal;
        RemainingResidual: Decimal;
        ExactShare: Decimal;
        WinnerIndex: Integer;
        i: Integer;
    begin
        WeightSum := 0;
        for i := 1 to LineCount do
            WeightSum += Weight[i];

        FloorSum := 0;
        for i := 1 to LineCount do begin
            Awarded[i] := false;
            if (WeightSum = 0) or (Weight[i] = 0) then begin
                ExpectedShare[i] := 0;
                Remainder[i] := 0;
            end else begin
                ExactShare := TotalAmount * Weight[i] / WeightSum;
                ExpectedShare[i] := Round(ExactShare, 0.01, '<');
                Remainder[i] := ExactShare - ExpectedShare[i];
                FloorSum += ExpectedShare[i];
            end;
        end;

        if WeightSum = 0 then
            exit;

        RemainingResidual := TotalAmount - FloorSum;
        while RemainingResidual >= 0.005 do begin
            WinnerIndex := 0;
            for i := 1 to LineCount do
                if (Weight[i] <> 0) and (not Awarded[i]) then
                    // AL's "or" does not short-circuit, so evaluating
                    // Remainder[WinnerIndex] in the same condition as
                    // "WinnerIndex = 0" indexes Remainder[0] on the first
                    // candidate - guard it with a nested if instead.
                    if WinnerIndex = 0 then
                        WinnerIndex := i
                    else
                        if (Remainder[i] > Remainder[WinnerIndex]) or
                           ((Remainder[i] = Remainder[WinnerIndex]) and (LineNo[i] < LineNo[WinnerIndex]))
                        then
                            WinnerIndex := i;
            ExpectedShare[WinnerIndex] += 0.01;
            Awarded[WinnerIndex] := true;
            RemainingResidual -= 0.01;
        end;
    end;

    [Test]
    procedure X140_SingleNonzeroWeightLineGetsTheEntireTotal()
    var
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        X140_ClearAllData();
        X140_SeedHeader('SL01', 123.45);
        X140_SeedLine('SL01', 1, 'Widget', 7.5);

        Allocator.AllocateRebate('SL01');

        Assert.AreEqual(123.45, X140_GetLineAmount('SL01', 1), 'Expected a document with a single line to allocate its entire total to that line');
    end;

    [Test]
    procedure X140_TwoEvenlyWeightedLinesSplitCleanlyAndLeaveAnotherDocumentUntouched()
    var
        RebateHeader: Record "CG X140 Rebate Header";
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        X140_ClearAllData();
        X140_SeedHeader('EV01', 10.00);
        X140_SeedLine('EV01', 1, 'Widget A', 1);
        X140_SeedLine('EV01', 2, 'Widget B', 1);

        // A second, unrelated document is seeded with its own nonzero
        // sentinel amounts and left alone - allocating EV01 must not
        // touch it.
        X140_SeedHeader('EV02', 250.00);
        X140_SeedLineWithSentinel('EV02', 1, 1, 111.11);
        X140_SeedLineWithSentinel('EV02', 2, 1, 222.22);

        Allocator.AllocateRebate('EV01');

        Assert.AreEqual(5.00, X140_GetLineAmount('EV01', 1), 'Expected an even two-line split to allocate exactly half the total to each line');
        Assert.AreEqual(5.00, X140_GetLineAmount('EV01', 2), 'Expected an even two-line split to allocate exactly half the total to each line');
        Assert.AreEqual(10.00, Allocator.GetAllocatedTotal('EV01'), 'Expected the reconciliation total to equal the header total after allocating');

        RebateHeader.Get('EV02');
        Assert.IsFalse(RebateHeader.Allocated, 'Expected an untouched document to stay unallocated');
        Assert.AreEqual(111.11, X140_GetLineAmount('EV02', 1), 'Expected another document''s line amount to be left untouched by allocating a different document');
        Assert.AreEqual(222.22, X140_GetLineAmount('EV02', 2), 'Expected another document''s line amount to be left untouched by allocating a different document');
        // EV02's own lines (333.33) do not reconcile with its own header
        // total (250.00) by design - it was never allocated. Pinning the
        // reconciliation total against the lines' own sum here, not the
        // header total, catches a GetAllocatedTotal that just echoes the
        // header field instead of actually reading the lines.
        Assert.AreEqual(333.33, Allocator.GetAllocatedTotal('EV02'), 'Expected the reconciliation total to reflect the document''s own recorded line amounts');
    end;

    [Test]
    procedure X140_AZeroWeightLineAlwaysReceivesExactlyZero()
    var
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        // Weights chosen so every nonzero-weight line's exact share has a
        // distinct rounding remainder (no ties), so this fixture pins an
        // outcome that does not depend on any particular tie-break policy.
        X140_ClearAllData();
        X140_SeedHeader('ZL01', 77.77);
        X140_SeedLine('ZL01', 1, 'Item P', 2.3);
        X140_SeedLine('ZL01', 2, 'Item Q', 5.7);
        X140_SeedLine('ZL01', 3, 'Item R', 3.1);
        X140_SeedLine('ZL01', 4, 'Item S', 1.9);
        X140_SeedLine('ZL01', 5, 'Sample T (FOC)', 0);

        Allocator.AllocateRebate('ZL01');

        Assert.AreEqual(13.76, X140_GetLineAmount('ZL01', 1), 'Expected a weighted line''s allocated amount to depend only on the document''s weights and total');
        Assert.AreEqual(34.10, X140_GetLineAmount('ZL01', 2), 'Expected a weighted line''s allocated amount to depend only on the document''s weights and total');
        Assert.AreEqual(18.54, X140_GetLineAmount('ZL01', 3), 'Expected a weighted line''s allocated amount to depend only on the document''s weights and total');
        Assert.AreEqual(11.37, X140_GetLineAmount('ZL01', 4), 'Expected a weighted line''s allocated amount to depend only on the document''s weights and total');
        Assert.AreEqual(0.00, X140_GetLineAmount('ZL01', 5), 'Expected a line with no allocation weight to receive exactly zero');
        Assert.AreEqual(77.77, Allocator.GetAllocatedTotal('ZL01'), 'Expected the recorded amounts to sum to exactly the document total');
    end;

    [Test]
    procedure X140_ReorderingTheSameLinesNeverChangesTheirRebateAmount()
    var
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        X140_ClearAllData();

        // Document PM01: lines entered P, Q, R, S.
        X140_SeedHeader('PM01', 77.77);
        X140_SeedLine('PM01', 1, 'Item P', 2.3);
        X140_SeedLine('PM01', 2, 'Item Q', 5.7);
        X140_SeedLine('PM01', 3, 'Item R', 3.1);
        X140_SeedLine('PM01', 4, 'Item S', 1.9);

        // Document PM02: the exact same four items, same weights, same
        // total - only Item R and Item S swap which line number they
        // were entered on.
        X140_SeedHeader('PM02', 77.77);
        X140_SeedLine('PM02', 1, 'Item P', 2.3);
        X140_SeedLine('PM02', 2, 'Item Q', 5.7);
        X140_SeedLine('PM02', 3, 'Item S', 1.9);
        X140_SeedLine('PM02', 4, 'Item R', 3.1);

        Allocator.AllocateRebate('PM01');
        Allocator.AllocateRebate('PM02');

        // Item P and Item Q are entered in the same position on both
        // documents, so their assertions alone already pin an unambiguous
        // per-item split for this set of weights and total.
        Assert.AreEqual(13.76, X140_GetLineAmount('PM01', 1), 'Expected Item P''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(34.10, X140_GetLineAmount('PM01', 2), 'Expected Item Q''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(18.54, X140_GetLineAmount('PM01', 3), 'Expected Item R''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(11.37, X140_GetLineAmount('PM01', 4), 'Expected Item S''s allocated amount to depend only on the document''s weights and total, never on line order');

        Assert.AreEqual(13.76, X140_GetLineAmount('PM02', 1), 'Expected Item P''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(34.10, X140_GetLineAmount('PM02', 2), 'Expected Item Q''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(11.37, X140_GetLineAmount('PM02', 3), 'Expected Item S''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(18.54, X140_GetLineAmount('PM02', 4), 'Expected Item R''s allocated amount to depend only on the document''s weights and total, never on line order');

        // Item R and Item S get the same amount no matter which line
        // number they were entered on - the split must not depend on the
        // order the lines were imported in.
        Assert.AreEqual(X140_GetLineAmount('PM01', 3), X140_GetLineAmount('PM02', 4), 'Expected Item R to receive the same rebate amount whichever line number it was entered on');
        Assert.AreEqual(X140_GetLineAmount('PM01', 4), X140_GetLineAmount('PM02', 3), 'Expected Item S to receive the same rebate amount whichever line number it was entered on');

        Assert.AreEqual(77.77, Allocator.GetAllocatedTotal('PM01'), 'Expected the recorded amounts to sum to exactly the document total');
        Assert.AreEqual(77.77, Allocator.GetAllocatedTotal('PM02'), 'Expected the recorded amounts to sum to exactly the document total');
    end;

    [Test]
    procedure X140_ALineWithNoWeightAtAllOnTheWholeDocumentIsLeftUnallocated()
    var
        RebateHeader: Record "CG X140 Rebate Header";
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        X140_ClearAllData();
        X140_SeedHeader('NW01', 50.00);
        X140_SeedLineWithSentinel('NW01', 1, 0, 555.55);
        X140_SeedLineWithSentinel('NW01', 2, 0, 444.44);

        Allocator.AllocateRebate('NW01');

        RebateHeader.Get('NW01');
        Assert.IsFalse(RebateHeader.Allocated, 'Expected a document with no weight on any line to be left unallocated');
        Assert.AreEqual(555.55, X140_GetLineAmount('NW01', 1), 'Expected a line''s existing amount to be left untouched when the document has no weight to allocate');
        Assert.AreEqual(444.44, X140_GetLineAmount('NW01', 2), 'Expected a line''s existing amount to be left untouched when the document has no weight to allocate');
    end;

    [Test]
    procedure X140_SuccessfulAllocationMarksTheDocumentAllocated()
    var
        RebateHeader: Record "CG X140 Rebate Header";
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        X140_ClearAllData();
        X140_SeedHeader('MK01', 40.00);
        X140_SeedLine('MK01', 1, 'Widget A', 1);
        X140_SeedLine('MK01', 2, 'Widget B', 1);

        Allocator.AllocateRebate('MK01');

        RebateHeader.Get('MK01');
        Assert.IsTrue(RebateHeader.Allocated, 'Expected a document with at least one weighted line to be marked allocated');
    end;

    [Test]
    procedure X140_DeterministicSweepMatchesTheReferenceAllocationAcrossManyPartitions()
    var
        Allocator: Codeunit "CG X140 Rebate Allocator";
        Any: Codeunit Any;
        LineNo: array[10] of Integer;
        Weight: array[10] of Decimal;
        ExpectedShare: array[10] of Decimal;
        DocumentNo: Code[20];
        TotalAmount: Decimal;
        SumOfAmounts: Decimal;
        LineCount: Integer;
        Partition: Integer;
        i: Integer;
    begin
        Any.SetSeed(140);

        for Partition := 1 to 8 do begin
            X140_ClearAllData();
            DocumentNo := 'SW' + Format(Partition);
            LineCount := Any.IntegerInRange(3, 9);
            TotalAmount := Any.IntegerInRange(100, 99999) / 100;
            X140_SeedHeader(DocumentNo, TotalAmount);

            for i := 1 to LineCount do begin
                LineNo[i] := i;
                // Roughly every fourth line on a sweep partition is a
                // free-of-charge sample carrying no allocation weight.
                if i mod 4 = 0 then
                    Weight[i] := 0
                else
                    Weight[i] := Any.DecimalInRange(1, 500, 3);
                X140_SeedLine(DocumentNo, i, StrSubstNo('Sweep line %1', i), Weight[i]);
            end;

            Allocator.AllocateRebate(DocumentNo);
            X140_ComputeExpectedShares(Weight, LineNo, LineCount, TotalAmount, ExpectedShare);

            SumOfAmounts := 0;
            for i := 1 to LineCount do begin
                Assert.AreEqual(
                  ExpectedShare[i], X140_GetLineAmount(DocumentNo, LineNo[i]),
                  StrSubstNo('Expected line %1 of sweep partition %2 to depend only on that document''s own weights and total', LineNo[i], Partition));
                SumOfAmounts += X140_GetLineAmount(DocumentNo, LineNo[i]);
            end;
            Assert.AreEqual(
              TotalAmount, SumOfAmounts,
              StrSubstNo('Expected the recorded amounts on sweep partition %1 to sum to exactly its total', Partition));
        end;
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
