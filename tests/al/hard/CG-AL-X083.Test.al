codeunit 88836 "CG-AL-X083 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        ShippingNsLbl: Label 'urn:tryal:freight:shipping:v2', Locked = true;
        TrackingNsLbl: Label 'urn:tryal:freight:tracking:v1', Locked = true;
        ForeignNsLbl: Label 'urn:partner:audit:v1', Locked = true;

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every test clears the table
    // before seeding or importing anything. An unrelated entry seeded with
    // a nonzero sentinel Package Count proves an import never touches rows
    // for a different shipment.

    [Test]
    procedure ImportCountsEveryPackageAndKeepsOtherFieldsAccurate()
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

        Payload := ShippingMessage(
            '<Header><ShipmentNo>' + ShipmentNo + '</ShipmentNo></Header>' +
            '<Packages>' +
            '<Package>' + TrackingElement(FirstTrackingNo) + '<Weight unit="KG">12.5</Weight></Package>' +
            '<Package>' + TrackingElement(SecondTrackingNo) + '<Weight unit="KG">3.25</Weight></Package>' +
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
    procedure ImportCountsEveryPackageWhenTheSenderFormatsTheMessageDifferently()
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
            '<f:Package>' + TrackingElement('1Z-' + UpperCase(Any.AlphanumericText(7))) + '<f:Weight unit="LB">10</f:Weight></f:Package>' +
            '<f:Package>' + TrackingElement('1Z-' + UpperCase(Any.AlphanumericText(7))) + '<f:Weight unit="LB">20</f:Weight></f:Package>' +
            '</f:Packages>' +
            '</f:ShipmentStatus>';

        Mgt.ImportShipmentStatus(Payload);

        ImportEntry.SetRange("Shipment No.", ShipmentNo);
        ImportEntry.FindLast();

        Assert.AreEqual(2, ImportEntry."Package Count", 'Expected one count per package however the sender chose to format this particular message - the two carriers'' messages describe the same shipment shape');
        Assert.AreEqual(ImportEntry.Status::Received, ImportEntry.Status, 'Expected a shipment with packages to be marked as received, not empty');
    end;

    [Test]
    procedure ForeignPackagesFromOtherPartnersNeverInflateTheCount()
    var
        ImportEntry: Record "CG X083 Shipment Import Entry";
        Mgt: Codeunit "CG X083 Shipment Import Mgt.";
        Any: Codeunit Any;
        ShipmentNo: Code[20];
        Payload: Text;
    begin
        ImportEntry.DeleteAll();

        ShipmentNo := CopyStr('SHP-' + UpperCase(Any.AlphanumericText(8)), 1, MaxStrLen(ShipmentNo));

        Payload := ShippingMessage(
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
    procedure APackageThatCarriesNoShipmentIdentityIsNeverCounted()
    var
        ImportEntry: Record "CG X083 Shipment Import Entry";
        Mgt: Codeunit "CG X083 Shipment Import Mgt.";
        Any: Codeunit Any;
        ShipmentNo: Code[20];
        Payload: Text;
    begin
        ImportEntry.DeleteAll();

        ShipmentNo := CopyStr('SHP-' + UpperCase(Any.AlphanumericText(8)), 1, MaxStrLen(ShipmentNo));

        Payload := ShippingMessage(
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
    procedure EmptyShipmentReportsZeroPackagesWithoutError()
    var
        ImportEntry: Record "CG X083 Shipment Import Entry";
        Mgt: Codeunit "CG X083 Shipment Import Mgt.";
        Any: Codeunit Any;
        ShipmentNo: Code[20];
        Payload: Text;
    begin
        ImportEntry.DeleteAll();

        ShipmentNo := CopyStr('SHP-' + UpperCase(Any.AlphanumericText(8)), 1, MaxStrLen(ShipmentNo));

        Payload := ShippingMessage('<Header><ShipmentNo>' + ShipmentNo + '</ShipmentNo></Header><Packages/>');

        Mgt.ImportShipmentStatus(Payload);

        ImportEntry.SetRange("Shipment No.", ShipmentNo);
        ImportEntry.FindLast();

        Assert.AreEqual(0, ImportEntry."Package Count", 'Expected zero for a shipment that genuinely carries no packages - not an error');
        Assert.AreEqual(0, ImportEntry."Tracking No. Count", 'Expected zero tracking numbers when there are no packages to carry one');
        Assert.AreEqual('', ImportEntry."Weight Unit", 'Expected an empty weight unit when there are no packages to weigh');
        Assert.AreEqual(ImportEntry.Status::"Empty Shipment", ImportEntry.Status, 'Expected a shipment with no packages to be marked empty');
    end;

    [Test]
    procedure TheOldMessageFormatStillImportsAnEmptyShipmentCleanly()
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
    procedure GetLastImportedPackageCountMatchesTheMostRecentImportForThatShipment()
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

        FirstPayload := ShippingMessage(
            '<Header><ShipmentNo>' + ShipmentNo + '</ShipmentNo></Header>' +
            '<Packages><Package><Weight unit="KG">1.0</Weight></Package></Packages>');
        Mgt.ImportShipmentStatus(FirstPayload);

        SecondPayload := ShippingMessage(
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
    procedure GetLastImportedPackageCountIsZeroForAShipmentNeverImported()
    var
        ImportEntry: Record "CG X083 Shipment Import Entry";
        Mgt: Codeunit "CG X083 Shipment Import Mgt.";
    begin
        ImportEntry.DeleteAll();

        Assert.AreEqual(0, Mgt.GetLastImportedPackageCount('SHP-NEVER-SEEN'), 'Expected zero for a shipment number that was never imported');
    end;

    local procedure ShippingMessage(InnerXml: Text): Text
    begin
        exit('<?xml version="1.0" encoding="UTF-8"?>' +
            '<ShipmentStatus xmlns="' + ShippingNsLbl + '">' + InnerXml + '</ShipmentStatus>');
    end;

    local procedure TrackingElement(Value: Text): Text
    begin
        exit('<trk:TrackingNo xmlns:trk="' + TrackingNsLbl + '">' + Value + '</trk:TrackingNo>');
    end;
}
