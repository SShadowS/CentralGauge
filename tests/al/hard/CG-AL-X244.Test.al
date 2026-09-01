codeunit 89466 "CG-AL-X244 Test"
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
        // every test clears every table this scenario touches before seeding
        // its own rows.
        // every test clears both tables before seeding its own rows. Grades are
        // random text rather than fixed literals so a fix cannot special-case a
        // hardcoded value.
        ShippingNsLbl: Label 'urn:tryal:freight:shipping:v2', Locked = true;
        TrackingNsLbl: Label 'urn:tryal:freight:tracking:v1', Locked = true;
        ForeignNsLbl: Label 'urn:partner:audit:v1', Locked = true;
        // The default test isolation persists writes between test methods
        // (measured 2026-08-20, SOAP runner), so every test clears the table
        // before seeding or importing anything. An unrelated entry seeded with
        // a nonzero sentinel Package Count proves an import never touches rows
        // for a different shipment.
        // (measured 2026-08-20, SOAP runner), so every test clears both tables
        // before seeding its own rows.
        // A block list kept in memory for the rest of the session does not roll
        // back with the test transaction, so every test clears both the table
        // and that in-memory copy before seeding its own data.

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
    // X081 - donor CG-AL-X081
    // ==========================================================

    local procedure X081_Reset()
    var
        OrderLine: Record "CG X081 Order Line";
        Item: Record "CG X081 Item";
    begin
        OrderLine.DeleteAll();
        Item.DeleteAll();
    end;

    local procedure X081_CreateItem(var Item: Record "CG X081 Item"; No: Code[20]; Grade: Code[10])
    begin
        Item.Init();
        Item."No." := No;
        Item."Quality Grade" := Grade;
        Item.Insert(true);
    end;

    local procedure X081_RandomGrade(var Any: Codeunit Any): Code[10]
    begin
        exit(CopyStr(Any.AlphabeticText(10), 1, 10));
    end;

    local procedure X081_CreateLine(var OrderLine: Record "CG X081 Order Line"; EntryNo: Integer; ItemNo: Code[20])
    begin
        OrderLine.Init();
        OrderLine."Entry No." := EntryNo;
        OrderLine.Insert(true);
        OrderLine.Validate("Item No.", ItemNo);
        OrderLine.Modify(true);
    end;

    [Test]
    procedure X081_NewLineForAGradedItemGetsTheGrade()
    var
        Item: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        Grade: Code[10];
        Any: Codeunit Any;
    begin
        X081_Reset();
        Grade := X081_RandomGrade(Any);
        X081_CreateItem(Item, 'ITEM-A', Grade);

        X081_CreateLine(OrderLine, 1, Item."No.");

        Assert.AreEqual(Grade, OrderLine."Quality Grade",
            'Expected validating "Item No." with a graded item to copy that item''s grade onto the line');
    end;

    [Test]
    procedure X081_NewLineForAGradelessItemStaysBlank()
    var
        Item: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
    begin
        X081_Reset();
        X081_CreateItem(Item, 'ITEM-B', '');

        X081_CreateLine(OrderLine, 2, Item."No.");

        Assert.AreEqual('', OrderLine."Quality Grade",
            'Expected the line''s grade to stay blank when the item on it has none');
    end;

    [Test]
    procedure X081_RevalidatingToAnotherGradedItemOverwritesTheGrade()
    var
        FirstItem: Record "CG X081 Item";
        SecondItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        SecondGrade: Code[10];
        Any: Codeunit Any;
    begin
        X081_Reset();
        X081_CreateItem(FirstItem, 'ITEM-C', X081_RandomGrade(Any));
        SecondGrade := X081_RandomGrade(Any);
        X081_CreateItem(SecondItem, 'ITEM-D', SecondGrade);
        X081_CreateLine(OrderLine, 3, FirstItem."No.");

        OrderLine.Validate("Item No.", SecondItem."No.");
        OrderLine.Modify(true);

        Assert.AreEqual(SecondGrade, OrderLine."Quality Grade",
            'Expected re-validating "Item No." to another graded item to overwrite the line''s grade with the new item''s grade');
    end;

    [Test]
    procedure X081_RevalidatingToAGradelessItemClearsTheLine()
    var
        GradedItem: Record "CG X081 Item";
        GradelessItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        Any: Codeunit Any;
    begin
        X081_Reset();
        X081_CreateItem(GradedItem, 'ITEM-E', X081_RandomGrade(Any));
        X081_CreateItem(GradelessItem, 'ITEM-F', '');
        X081_CreateLine(OrderLine, 4, GradedItem."No.");

        OrderLine.Validate("Item No.", GradelessItem."No.");
        OrderLine.Modify(true);

        Assert.AreEqual('', OrderLine."Quality Grade",
            'Expected the line''s grade to be cleared when "Item No." is re-validated to an item with no grade - the line must always mirror the item that is on it');
    end;

    [Test]
    procedure X081_ClearingTheItemNoAlsoClearsTheGrade()
    var
        GradedItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        Any: Codeunit Any;
    begin
        X081_Reset();
        X081_CreateItem(GradedItem, 'ITEM-M', X081_RandomGrade(Any));
        X081_CreateLine(OrderLine, 8, GradedItem."No.");

        OrderLine.Validate("Item No.", '');
        OrderLine.Modify(true);

        Assert.AreEqual('', OrderLine."Quality Grade",
            'Expected the line''s grade to be cleared when "Item No." is re-validated to blank - the line must always mirror the item that is on it');
    end;

    [Test]
    procedure X081_RevalidatingBackToAGradedItemAfterClearingSetsTheNewGrade()
    var
        FirstGradedItem: Record "CG X081 Item";
        GradelessItem: Record "CG X081 Item";
        SecondGradedItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        SecondGrade: Code[10];
        Any: Codeunit Any;
    begin
        X081_Reset();
        X081_CreateItem(FirstGradedItem, 'ITEM-G', X081_RandomGrade(Any));
        X081_CreateItem(GradelessItem, 'ITEM-H', '');
        SecondGrade := X081_RandomGrade(Any);
        X081_CreateItem(SecondGradedItem, 'ITEM-I', SecondGrade);
        X081_CreateLine(OrderLine, 5, FirstGradedItem."No.");

        OrderLine.Validate("Item No.", GradelessItem."No.");
        OrderLine.Modify(true);
        OrderLine.Validate("Item No.", SecondGradedItem."No.");
        OrderLine.Modify(true);

        Assert.AreEqual(SecondGrade, OrderLine."Quality Grade",
            'Expected re-validating "Item No." back to a graded item after a gradeless item to set the new item''s grade');
    end;

    [Test]
    procedure X081_AssigningItemValuesDirectlyAlsoClearsAStaleGrade()
    var
        GradelessItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        LineDefaultsMgt: Codeunit "CG X081 Line Defaults Mgt";
    begin
        X081_Reset();
        X081_CreateItem(GradelessItem, 'ITEM-J', '');
        OrderLine.Init();
        OrderLine."Entry No." := 6;
        OrderLine."Item No." := GradelessItem."No.";
        OrderLine."Quality Grade" := 'STALE';
        OrderLine.Insert(true);

        LineDefaultsMgt.AssignItemValues(OrderLine);
        OrderLine.Modify(true);

        Assert.AreEqual('', OrderLine."Quality Grade",
            'Expected assigning item values for a line pointed at a gradeless item to leave the line''s grade blank, matching what that item carries');
    end;

    [Test]
    procedure X081_UnrelatedLinesAreNeverTouched()
    var
        GradedItem: Record "CG X081 Item";
        GradelessItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        OtherLine: Record "CG X081 Order Line";
        Any: Codeunit Any;
    begin
        X081_Reset();
        X081_CreateItem(GradedItem, 'ITEM-K', X081_RandomGrade(Any));
        X081_CreateItem(GradelessItem, 'ITEM-L', '');

        OtherLine.Init();
        OtherLine."Entry No." := 100;
        OtherLine."Quality Grade" := 'SENTINEL9';
        OtherLine.Insert(true);

        X081_CreateLine(OrderLine, 7, GradedItem."No.");
        OrderLine.Validate("Item No.", GradelessItem."No.");
        OrderLine.Modify(true);

        OtherLine.Get(100);
        Assert.AreEqual('SENTINEL9', Format(OtherLine."Quality Grade"),
            'Expected a line never re-validated in this test to keep its original grade untouched');
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
}
