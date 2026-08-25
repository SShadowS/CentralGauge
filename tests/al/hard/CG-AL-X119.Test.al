codeunit 89313 "CG-AL-X119 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods, so
    // every test clears its own tables before seeding its own rows.

    local procedure ClearAll()
    var
        DocLine: Record "CG X119 Doc Line";
        Item: Record "CG X119 Item";
        GLAccount: Record "CG X119 GL Account";
        Resource: Record "CG X119 Resource";
        Charge: Record "CG X119 Charge";
        ExportLine: Record "CG X119 Export Line";
    begin
        DocLine.DeleteAll();
        Item.DeleteAll();
        GLAccount.DeleteAll();
        Resource.DeleteAll();
        Charge.DeleteAll();
        ExportLine.DeleteAll();
    end;

    local procedure SeedDocLine(DocumentNo: Code[20]; LineNo: Integer; LineType: Enum "CG X119 Line Type"; MasterNo: Code[20])
    var
        Line: Record "CG X119 Doc Line";
    begin
        Line.Init();
        Line."Document No." := DocumentNo;
        Line."Line No." := LineNo;
        Line."Line Type" := LineType;
        Line."No." := MasterNo;
        Line.Insert();
    end;

    local procedure SeedItem(MasterNo: Code[20]; Description: Text[50]; Description2: Text[50]; UOM: Code[10])
    var
        Item: Record "CG X119 Item";
    begin
        Item.Init();
        Item."No." := MasterNo;
        Item.Description := Description;
        Item."Description 2" := Description2;
        Item."Base Unit of Measure" := UOM;
        Item.Insert();
    end;

    local procedure SeedGLAccount(MasterNo: Code[20]; AccountName: Text[50])
    var
        GLAccount: Record "CG X119 GL Account";
    begin
        GLAccount.Init();
        GLAccount."No." := MasterNo;
        GLAccount.Name := AccountName;
        GLAccount.Insert();
    end;

    local procedure SeedResource(MasterNo: Code[20]; ResourceName: Text[50]; UOM: Code[10])
    var
        Resource: Record "CG X119 Resource";
    begin
        Resource.Init();
        Resource."No." := MasterNo;
        Resource.Name := ResourceName;
        Resource."Base Unit of Measure" := UOM;
        Resource.Insert();
    end;

    local procedure SeedCharge(MasterNo: Code[20]; Description: Text[50]; Description2: Text[50]; UOM: Code[10])
    var
        Charge: Record "CG X119 Charge";
    begin
        Charge.Init();
        Charge."No." := MasterNo;
        Charge.Description := Description;
        Charge."Description 2" := Description2;
        Charge."Unit of Measure Code" := UOM;
        Charge.Insert();
    end;

    local procedure SeedStaleExportLine(DocumentNo: Code[20]; LineNo: Integer; LineType: Enum "CG X119 Line Type"; ExportName: Text[50]; SellerID: Code[20]; UOM: Code[10])
    var
        ExportLine: Record "CG X119 Export Line";
    begin
        ExportLine.Init();
        ExportLine."Document No." := DocumentNo;
        ExportLine."Line No." := LineNo;
        ExportLine."Line Type" := LineType;
        ExportLine.Name := ExportName;
        ExportLine."Seller ID" := SellerID;
        ExportLine."Unit of Measure Code" := UOM;
        ExportLine.Insert();
    end;

    // Seller ID is asserted below as the plain Format() of the line number,
    // with no digit grouping. If a future change ever needs a formatted or
    // padded seller ID, update every expected value here deliberately -
    // don't assume Format's default behavior still matches.
    local procedure AssertExportLine(DocumentNo: Code[20]; LineNo: Integer; ExpectedLineType: Enum "CG X119 Line Type"; ExpectedName: Text[50]; ExpectedSellerID: Code[20]; ExpectedUOM: Code[10]; MessagePrefix: Text)
    var
        ExportLine: Record "CG X119 Export Line";
    begin
        Assert.IsTrue(ExportLine.Get(DocumentNo, LineNo), MessagePrefix + ' - export line exists');
        Assert.AreEqual(ExpectedLineType, ExportLine."Line Type", MessagePrefix + ' - line type');
        Assert.AreEqual(ExpectedName, ExportLine.Name, MessagePrefix + ' - name');
        Assert.AreEqual(ExpectedSellerID, ExportLine."Seller ID", MessagePrefix + ' - seller ID');
        Assert.AreEqual(ExpectedUOM, ExportLine."Unit of Measure Code", MessagePrefix + ' - unit of measure');
    end;

    [Test]
    procedure ItemLineExportsDescriptionAsName()
    var
        Exporter: Codeunit "CG X119 Exporter";
    begin
        ClearAll();
        SeedItem('ITM1', 'Blue Widget', '', 'BOX');
        SeedDocLine('DOC1', 10, "CG X119 Line Type"::Item, 'ITM1');

        Exporter.BuildExportLines('DOC1');

        AssertExportLine('DOC1', 10, "CG X119 Line Type"::Item, 'Blue Widget', '10', 'BOX', 'Expected the item line''s exported fields');
    end;

    [Test]
    procedure ItemLineWithBlankPrimaryDescriptionStillExportsAName()
    var
        Exporter: Codeunit "CG X119 Exporter";
    begin
        ClearAll();
        SeedItem('ITM2', '', 'Fallback Widget', 'BOX');
        SeedDocLine('DOC1', 20, "CG X119 Line Type"::Item, 'ITM2');

        Exporter.BuildExportLines('DOC1');

        AssertExportLine('DOC1', 20, "CG X119 Line Type"::Item, 'Fallback Widget', '20', 'BOX', 'Expected the item line''s exported name');
    end;

    [Test]
    procedure ItemLineWithNoUnitOnItsMasterStillExportsAUnit()
    var
        Exporter: Codeunit "CG X119 Exporter";
    begin
        ClearAll();
        SeedItem('ITM3', 'Plain Widget', '', '');
        SeedDocLine('DOC1', 30, "CG X119 Line Type"::Item, 'ITM3');

        Exporter.BuildExportLines('DOC1');

        AssertExportLine('DOC1', 30, "CG X119 Line Type"::Item, 'Plain Widget', '30', 'PCS', 'Expected the item line''s exported unit of measure');
    end;

    [Test]
    procedure ItemLineWithNoMasterRecordExportsABlankRow()
    var
        Exporter: Codeunit "CG X119 Exporter";
    begin
        ClearAll();
        SeedDocLine('DOC1', 150, "CG X119 Line Type"::Item, 'ITM-GONE');

        Exporter.BuildExportLines('DOC1');

        AssertExportLine('DOC1', 150, "CG X119 Line Type"::Item, '', '', '', 'Expected the item line with no matching master record');
    end;

    [Test]
    procedure GLAccountLineExportsNameAndLeavesUOMBlank()
    var
        Exporter: Codeunit "CG X119 Exporter";
    begin
        ClearAll();
        SeedGLAccount('GL1', 'Freight Expense');
        SeedDocLine('DOC1', 40, "CG X119 Line Type"::GLAccount, 'GL1');

        Exporter.BuildExportLines('DOC1');

        AssertExportLine('DOC1', 40, "CG X119 Line Type"::GLAccount, 'Freight Expense', '40', '', 'A G/L account line has no unit of measure and must not get a default one');
    end;

    [Test]
    procedure ResourceLineExportsFields()
    var
        Exporter: Codeunit "CG X119 Exporter";
    begin
        ClearAll();
        SeedResource('RES1', 'Install Labor', 'HOUR');
        SeedDocLine('DOC1', 50, "CG X119 Line Type"::Resource, 'RES1');

        Exporter.BuildExportLines('DOC1');

        AssertExportLine('DOC1', 50, "CG X119 Line Type"::Resource, 'Install Labor', '50', 'HOUR', 'Expected the resource line''s exported fields');
    end;

    [Test]
    procedure ResourceLineWithNoUnitOnItsMasterStillExportsAUnit()
    var
        Exporter: Codeunit "CG X119 Exporter";
    begin
        ClearAll();
        SeedResource('RES2', 'Consulting', '');
        SeedDocLine('DOC1', 60, "CG X119 Line Type"::Resource, 'RES2');

        Exporter.BuildExportLines('DOC1');

        AssertExportLine('DOC1', 60, "CG X119 Line Type"::Resource, 'Consulting', '60', 'PCS', 'Expected the resource line''s exported unit of measure');
    end;

    [Test]
    procedure ChargeLineExportsNameSellerIDAndUOM()
    var
        Exporter: Codeunit "CG X119 Exporter";
    begin
        ClearAll();
        SeedCharge('CHG1', 'Freight Surcharge', '', 'KG');
        SeedDocLine('DOC1', 70, "CG X119 Line Type"::Charge, 'CHG1');

        Exporter.BuildExportLines('DOC1');

        AssertExportLine('DOC1', 70, "CG X119 Line Type"::Charge, 'Freight Surcharge', '70', 'KG', 'Expected the charge line''s exported fields');
    end;

    [Test]
    procedure ChargeLineWithBlankPrimaryDescriptionStillExportsAName()
    var
        Exporter: Codeunit "CG X119 Exporter";
    begin
        ClearAll();
        SeedCharge('CHG2', '', 'Handling Fee', 'KG');
        SeedDocLine('DOC1', 80, "CG X119 Line Type"::Charge, 'CHG2');

        Exporter.BuildExportLines('DOC1');

        AssertExportLine('DOC1', 80, "CG X119 Line Type"::Charge, 'Handling Fee', '80', 'KG', 'Expected the charge line''s exported name');
    end;

    [Test]
    procedure ChargeLineNameStaysBlankWhenBothDescriptionsBlank()
    var
        Exporter: Codeunit "CG X119 Exporter";
    begin
        ClearAll();
        SeedCharge('CHG3', '', '', 'LITER');
        SeedDocLine('DOC1', 90, "CG X119 Line Type"::Charge, 'CHG3');

        Exporter.BuildExportLines('DOC1');

        AssertExportLine('DOC1', 90, "CG X119 Line Type"::Charge, '', '90', 'LITER', 'Expected the charge line''s exported fields');
    end;

    [Test]
    procedure ChargeLineWithNoUnitOnItsMasterStillExportsAUnit()
    var
        Exporter: Codeunit "CG X119 Exporter";
    begin
        ClearAll();
        SeedCharge('CHG4', 'Storage Fee', '', '');
        SeedDocLine('DOC1', 100, "CG X119 Line Type"::Charge, 'CHG4');

        Exporter.BuildExportLines('DOC1');

        AssertExportLine('DOC1', 100, "CG X119 Line Type"::Charge, 'Storage Fee', '100', 'PCS', 'Expected the charge line''s exported unit of measure');
    end;

    [Test]
    procedure ChargeLineWithNoMasterRecordExportsABlankRow()
    var
        Exporter: Codeunit "CG X119 Exporter";
    begin
        ClearAll();
        SeedDocLine('DOC1', 140, "CG X119 Line Type"::Charge, 'CHG-GONE');

        Exporter.BuildExportLines('DOC1');

        AssertExportLine('DOC1', 140, "CG X119 Line Type"::Charge, '', '', '', 'Expected the charge line with no matching master record');
    end;

    [Test]
    procedure RepeatedChargeCodeStillGetsDistinctSellerIDs()
    var
        Exporter: Codeunit "CG X119 Exporter";
    begin
        ClearAll();
        SeedCharge('CHG5', 'Freight Surcharge', '', 'KG');
        SeedDocLine('DOC1', 110, "CG X119 Line Type"::Charge, 'CHG5');
        SeedDocLine('DOC1', 120, "CG X119 Line Type"::Charge, 'CHG5');

        Exporter.BuildExportLines('DOC1');

        AssertExportLine('DOC1', 110, "CG X119 Line Type"::Charge, 'Freight Surcharge', '110', 'KG', 'The first of two same-charge lines keeps its own seller ID');
        AssertExportLine('DOC1', 120, "CG X119 Line Type"::Charge, 'Freight Surcharge', '120', 'KG', 'The second of two same-charge lines keeps its own seller ID, not the first line''s');
    end;

    [Test]
    procedure BuildExportLinesOnlyReplacesLinesForItsOwnDocument()
    var
        ExportLine: Record "CG X119 Export Line";
        Exporter: Codeunit "CG X119 Exporter";
    begin
        ClearAll();
        SeedStaleExportLine('DOC2', 10, "CG X119 Line Type"::Item, 'Untouched Line', '999', 'EA');
        SeedStaleExportLine('DOC1', 130, "CG X119 Line Type"::Item, 'Stale Line', '888', 'EA');
        SeedStaleExportLine('DOC1', 140, "CG X119 Line Type"::Item, 'Orphan Line', '777', 'EA');
        SeedCharge('CHG6', 'Freight Surcharge', '', 'KG');
        SeedDocLine('DOC1', 130, "CG X119 Line Type"::Charge, 'CHG6');

        Exporter.BuildExportLines('DOC1');

        AssertExportLine('DOC1', 130, "CG X119 Line Type"::Charge, 'Freight Surcharge', '130', 'KG', 'The requested document''s own stale export line is rebuilt, not duplicated');
        Assert.IsFalse(ExportLine.Get('DOC1', 140), 'A stale export line with no current document line must be removed when its document is rebuilt');
        AssertExportLine('DOC2', 10, "CG X119 Line Type"::Item, 'Untouched Line', '999', 'EA', 'A different document''s export line must not be touched');

        ExportLine.SetRange("Document No.", 'DOC1');
        Assert.AreEqual(1, ExportLine.Count(), 'Rebuilding a document must leave exactly one export line per current document line');
    end;

    [Test]
    procedure MixedDocumentExportsEveryLineTypeCorrectly()
    var
        Exporter: Codeunit "CG X119 Exporter";
    begin
        ClearAll();
        SeedItem('ITM9', 'Mixed Item', '', 'BOX');
        SeedGLAccount('GL9', 'Mixed Expense');
        SeedResource('RES9', 'Mixed Labor', 'HOUR');
        SeedCharge('CHG9', 'Mixed Charge', '', 'KG');
        SeedDocLine('DOC1', 200, "CG X119 Line Type"::Item, 'ITM9');
        SeedDocLine('DOC1', 210, "CG X119 Line Type"::GLAccount, 'GL9');
        SeedDocLine('DOC1', 220, "CG X119 Line Type"::Resource, 'RES9');
        SeedDocLine('DOC1', 230, "CG X119 Line Type"::Charge, 'CHG9');

        Exporter.BuildExportLines('DOC1');

        AssertExportLine('DOC1', 200, "CG X119 Line Type"::Item, 'Mixed Item', '200', 'BOX', 'The item line on a mixed document still exports correctly');
        AssertExportLine('DOC1', 210, "CG X119 Line Type"::GLAccount, 'Mixed Expense', '210', '', 'The G/L account line on a mixed document still exports correctly');
        AssertExportLine('DOC1', 220, "CG X119 Line Type"::Resource, 'Mixed Labor', '220', 'HOUR', 'The resource line on a mixed document still exports correctly');
        AssertExportLine('DOC1', 230, "CG X119 Line Type"::Charge, 'Mixed Charge', '230', 'KG', 'The charge line on the same mixed document exports as completely as its siblings');
    end;
}
