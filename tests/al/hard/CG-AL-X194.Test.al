codeunit 89416 "CG-AL-X194 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    // This oracle merges 4 independent modules' test suites into one
    // codeunit. Every test and helper procedure is prefixed with the module
    // it belongs to so identical helper names across the source suites cannot
    // collide. Assembled from already-gated donors; see NOTES.md.

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
        // All records here are temporary buffers scoped to each test's own local
        // variable, never a persisted table, so no DeleteAll seeding step is
        // needed between tests.
        // The default test isolation persists writes between test methods, so
        // every test clears both tables before seeding its own rows. Each test
        // also uses its own Batch Code so seeding never collides with another
        // test's rows even before the clear runs.
        // every test clears both tables before seeding its own rows. Rows that
        // belong to a different document than the one under test are seeded
        // with a nonzero count/value so "untouched" and "coincidentally zero"
        // stay distinguishable.

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
    // X077 - donor CG-AL-X077
    // ==========================================================

    local procedure X077_AddLine(var PriceLine: Record "CG X077 Price Validity Line" temporary; LineNo: Integer; StartDate: Date; EndDate: Date)
    begin
        PriceLine.Init();
        PriceLine."Line No." := LineNo;
        PriceLine."Starting Date" := StartDate;
        PriceLine."Ending Date" := EndDate;
        PriceLine.Insert();
    end;

    [Test]
    procedure X077_MergeCombinesOverlappingWindowsIntoOnePeriod()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        MergedPeriod: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] Two windows sharing several days combine into one continuous coverage period
        X077_AddLine(PriceLine, 10000, DMY2Date(1, 1, 2027), DMY2Date(20, 1, 2027));
        X077_AddLine(PriceLine, 20000, DMY2Date(10, 1, 2027), DMY2Date(5, 2, 2027));

        Analyzer.MergeValidityPeriods(PriceLine, MergedPeriod);

        Assert.AreEqual(1, MergedPeriod.Count(), 'Two overlapping windows must merge into a single continuous coverage period');
        MergedPeriod.Get(10000);
        Assert.AreEqual(DMY2Date(1, 1, 2027), MergedPeriod."Starting Date", 'The merged coverage period must start on the earliest window''s starting date');
        Assert.AreEqual(DMY2Date(5, 2, 2027), MergedPeriod."Ending Date", 'The merged coverage period must end on the latest window''s ending date');
    end;

    [Test]
    procedure X077_MergeKeepsOpenEndedWindowOutputUnbounded()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        MergedPeriod: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] A blank ending date means "valid forever", so a later window is absorbed and the coverage period stays open-ended
        X077_AddLine(PriceLine, 10000, DMY2Date(1, 1, 2027), 0D);
        X077_AddLine(PriceLine, 20000, DMY2Date(1, 3, 2027), DMY2Date(31, 3, 2027));

        Analyzer.MergeValidityPeriods(PriceLine, MergedPeriod);

        Assert.AreEqual(1, MergedPeriod.Count(), 'An open-ended window must absorb every later window into one coverage period');
        MergedPeriod.Get(10000);
        Assert.AreEqual(0D, MergedPeriod."Ending Date", 'A coverage period built from an open-ended window must itself stay open-ended, not switch to a concrete ending date');
    end;

    [Test]
    procedure X077_DisjointConcretePeriodsAreNotConflicting()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] Windows with a real gap between them are no conflict
        X077_AddLine(PriceLine, 10000, DMY2Date(1, 1, 2027), DMY2Date(31, 1, 2027));
        X077_AddLine(PriceLine, 20000, DMY2Date(1, 3, 2027), DMY2Date(31, 3, 2027));

        Assert.AreEqual(0, Analyzer.CountConflictingPairs(PriceLine), 'Windows with a real gap between them must not count as a conflicting pair');
    end;

    [Test]
    procedure X077_AdjacentConcretePeriodsAreNotConflicting()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] Touching windows share no day, so they are NOT a conflict
        X077_AddLine(PriceLine, 10000, DMY2Date(1, 1, 2027), DMY2Date(10, 1, 2027));
        X077_AddLine(PriceLine, 20000, DMY2Date(11, 1, 2027), DMY2Date(20, 1, 2027));

        Assert.AreEqual(0, Analyzer.CountConflictingPairs(PriceLine), 'Windows that touch but share no calendar day must not count as a conflicting pair');
    end;

    [Test]
    procedure X077_PeriodsSharingExactlyOneDayAreConflicting()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] One window ends on the exact day the next begins - one shared day is a conflict
        X077_AddLine(PriceLine, 10000, DMY2Date(1, 1, 2027), DMY2Date(10, 1, 2027));
        X077_AddLine(PriceLine, 20000, DMY2Date(10, 1, 2027), DMY2Date(20, 1, 2027));

        Assert.AreEqual(1, Analyzer.CountConflictingPairs(PriceLine), 'Windows sharing exactly one calendar day must count as one conflicting pair');
    end;

    [Test]
    procedure X077_OverlappingConcretePeriodsAreConflicting()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] Two ordinary dated windows sharing several days are one conflicting pair
        X077_AddLine(PriceLine, 10000, DMY2Date(1, 1, 2027), DMY2Date(20, 1, 2027));
        X077_AddLine(PriceLine, 20000, DMY2Date(15, 1, 2027), DMY2Date(31, 1, 2027));

        Assert.AreEqual(1, Analyzer.CountConflictingPairs(PriceLine), 'Two windows sharing several days must count as one conflicting pair');
    end;

    [Test]
    procedure X077_ContainedPeriodIsConflicting()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] A window fully inside another is a conflict too
        X077_AddLine(PriceLine, 10000, DMY2Date(1, 1, 2027), DMY2Date(31, 12, 2027));
        X077_AddLine(PriceLine, 20000, DMY2Date(1, 3, 2027), DMY2Date(31, 3, 2027));

        Assert.AreEqual(1, Analyzer.CountConflictingPairs(PriceLine), 'A window fully inside another window must count as one conflicting pair');
    end;

    [Test]
    procedure X077_IdenticalPeriodsAreConflicting()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] Two lines with the same window are the classic duplicate import - one conflicting pair
        X077_AddLine(PriceLine, 10000, DMY2Date(1, 4, 2027), DMY2Date(30, 4, 2027));
        X077_AddLine(PriceLine, 20000, DMY2Date(1, 4, 2027), DMY2Date(30, 4, 2027));

        Assert.AreEqual(1, Analyzer.CountConflictingPairs(PriceLine), 'Two lines with identical validity windows must count as one conflicting pair');
    end;

    [Test]
    procedure X077_ConflictCountReflectsPairsNotLines()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] A year-long window against two disjoint short ones is 2 pairs, though 3 lines are involved
        X077_AddLine(PriceLine, 10000, DMY2Date(1, 1, 2027), DMY2Date(31, 12, 2027));
        X077_AddLine(PriceLine, 20000, DMY2Date(10, 1, 2027), DMY2Date(20, 1, 2027));
        X077_AddLine(PriceLine, 30000, DMY2Date(1, 3, 2027), DMY2Date(10, 3, 2027));

        Assert.AreEqual(2, Analyzer.CountConflictingPairs(PriceLine), 'A year-long window conflicting with two disjoint shorter windows must count as 2 pairs, not the number of lines involved');
    end;

    [Test]
    procedure X077_OpenEndedWindowConflictsWithMuchLaterWindow()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] A window with no ending date never expires - it conflicts with a window starting years later
        X077_AddLine(PriceLine, 10000, DMY2Date(1, 6, 2027), 0D);
        X077_AddLine(PriceLine, 20000, DMY2Date(1, 12, 2029), DMY2Date(31, 12, 2029));

        Assert.AreEqual(1, Analyzer.CountConflictingPairs(PriceLine), 'A window with no ending date must count as conflicting with a window starting years later - it never expires');
    end;

    [Test]
    procedure X077_OpenEndedWindowOnHigherLineNoConflictsWithEarlierWindow()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] An open-ended window is not only ever the earlier-numbered line of a pair - it must still count as conflicting when it is the later-numbered one
        X077_AddLine(PriceLine, 10000, DMY2Date(1, 1, 2027), DMY2Date(31, 1, 2027));
        X077_AddLine(PriceLine, 20000, DMY2Date(15, 1, 2027), 0D);

        Assert.AreEqual(1, Analyzer.CountConflictingPairs(PriceLine), 'A window with no ending date must count as conflicting with an earlier window, regardless of which of the two lines has the higher line number');
    end;

    [Test]
    procedure X077_OpenEndedWindowDoesNotConflictWithEarlierDisjointWindow()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] A window with no ending date still has a real starting date - it must not conflict with a window that ended before it even started
        X077_AddLine(PriceLine, 10000, DMY2Date(1, 3, 2028), 0D);
        X077_AddLine(PriceLine, 20000, DMY2Date(1, 1, 2027), DMY2Date(31, 1, 2027));

        Assert.AreEqual(0, Analyzer.CountConflictingPairs(PriceLine), 'A window with no ending date must not count as conflicting with a window that ended entirely before it starts');
    end;

    [Test]
    procedure X077_MergeRejectsEndingDateBeforeStartingDate()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        MergedPeriod: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] A reversed validity window fails the merge with the promised message
        X077_AddLine(PriceLine, 10000, DMY2Date(10, 5, 2027), DMY2Date(1, 5, 2027));

        asserterror Analyzer.MergeValidityPeriods(PriceLine, MergedPeriod);
        Assert.ExpectedError('before the starting date');
    end;

    [Test]
    procedure X077_ConflictCountRejectsEndingDateBeforeStartingDate()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] A reversed validity window fails the conflict count with the promised message
        X077_AddLine(PriceLine, 10000, DMY2Date(1, 7, 2027), DMY2Date(31, 7, 2027));
        X077_AddLine(PriceLine, 20000, DMY2Date(10, 7, 2027), DMY2Date(5, 7, 2027));

        asserterror Analyzer.CountConflictingPairs(PriceLine);
        Assert.ExpectedError('before the starting date');
    end;

    [Test]
    procedure X077_PeriodsSharingExactlyOneDayAreConflictingWhicheverLineComesFirst()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] A shared day is a conflict whichever line comes first - the lower-numbered line starts later and shares only its first day with the higher-numbered line's last day
        X077_AddLine(PriceLine, 10000, DMY2Date(10, 1, 2027), DMY2Date(20, 1, 2027));
        X077_AddLine(PriceLine, 20000, DMY2Date(1, 1, 2027), DMY2Date(10, 1, 2027));

        Assert.AreEqual(1, Analyzer.CountConflictingPairs(PriceLine), 'A shared day is a conflict whichever line comes first');
    end;

    [Test]
    procedure X077_MergeProducesSeparatePeriodsAcrossARealGap()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        MergedPeriod: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] Two windows merge into one continuous period, but a third window with a real gap after them must stay a separate second period
        X077_AddLine(PriceLine, 10000, DMY2Date(1, 1, 2027), DMY2Date(10, 1, 2027));
        X077_AddLine(PriceLine, 20000, DMY2Date(5, 1, 2027), DMY2Date(15, 1, 2027));
        X077_AddLine(PriceLine, 30000, DMY2Date(1, 3, 2027), DMY2Date(10, 3, 2027));

        Analyzer.MergeValidityPeriods(PriceLine, MergedPeriod);

        Assert.AreEqual(2, MergedPeriod.Count(), 'A real gap after a merged group must start a new, separate coverage period rather than folding everything into one');
        MergedPeriod.Get(10000);
        Assert.AreEqual(DMY2Date(1, 1, 2027), MergedPeriod."Starting Date", 'The first coverage period must start on the earliest window''s starting date');
        Assert.AreEqual(DMY2Date(15, 1, 2027), MergedPeriod."Ending Date", 'The first coverage period must end on the later of the two overlapping windows'' ending dates');
        MergedPeriod.Get(20000);
        Assert.AreEqual(DMY2Date(1, 3, 2027), MergedPeriod."Starting Date", 'The second coverage period must start on the gapped window''s own starting date');
        Assert.AreEqual(DMY2Date(10, 3, 2027), MergedPeriod."Ending Date", 'The second coverage period must end on the gapped window''s own ending date');
    end;

    [Test]
    procedure X077_MergeCombinesTouchingWindowsWithNoGapIntoOnePeriod()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        MergedPeriod: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] One window ends the exact day before the next begins - no gap day between them, so they merge into one continuous coverage period
        X077_AddLine(PriceLine, 10000, DMY2Date(1, 1, 2027), DMY2Date(10, 1, 2027));
        X077_AddLine(PriceLine, 20000, DMY2Date(11, 1, 2027), DMY2Date(20, 1, 2027));

        Analyzer.MergeValidityPeriods(PriceLine, MergedPeriod);

        Assert.AreEqual(1, MergedPeriod.Count(), 'Touching windows with no gap day between them must merge into a single continuous coverage period');
        MergedPeriod.Get(10000);
        Assert.AreEqual(DMY2Date(1, 1, 2027), MergedPeriod."Starting Date", 'The merged coverage period must start on the earlier window''s starting date');
        Assert.AreEqual(DMY2Date(20, 1, 2027), MergedPeriod."Ending Date", 'The merged coverage period must end on the later window''s ending date');
    end;

    [Test]
    procedure X077_MergeSortsLinesByStartingDateRegardlessOfLineNoOrder()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        MergedPeriod: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] The earlier-starting window is entered under the higher line number - the merge must still process windows in date order, not insertion order
        X077_AddLine(PriceLine, 10000, DMY2Date(15, 1, 2027), DMY2Date(31, 1, 2027));
        X077_AddLine(PriceLine, 20000, DMY2Date(1, 1, 2027), DMY2Date(20, 1, 2027));

        Analyzer.MergeValidityPeriods(PriceLine, MergedPeriod);

        Assert.AreEqual(1, MergedPeriod.Count(), 'Two overlapping windows must merge into a single continuous coverage period regardless of which one has the higher line number');
        MergedPeriod.Get(10000);
        Assert.AreEqual(DMY2Date(1, 1, 2027), MergedPeriod."Starting Date", 'The merged coverage period must start on the earliest starting date even when that window has the higher line number');
        Assert.AreEqual(DMY2Date(31, 1, 2027), MergedPeriod."Ending Date", 'The merged coverage period must end on the latest ending date');
    end;

    [Test]
    procedure X077_MergeAcceptsASingleDayWindow()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        MergedPeriod: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] A window that starts and ends on the same day is a legitimate one-day validity period, not a reversed range
        X077_AddLine(PriceLine, 10000, DMY2Date(5, 1, 2027), DMY2Date(5, 1, 2027));

        Analyzer.MergeValidityPeriods(PriceLine, MergedPeriod);

        Assert.AreEqual(1, MergedPeriod.Count(), 'A single-day window must not be rejected as an invalid range');
        MergedPeriod.Get(10000);
        Assert.AreEqual(DMY2Date(5, 1, 2027), MergedPeriod."Starting Date", 'A single-day coverage period must start on that day');
        Assert.AreEqual(DMY2Date(5, 1, 2027), MergedPeriod."Ending Date", 'A single-day coverage period must end on that same day');
    end;

    [Test]
    procedure X077_MergeValidatesEveryLineRegardlessOfAnyCallerAppliedFilter()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        MergedPeriod: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] A reversed window on an item the caller has filtered out must still be rejected - validation cannot depend on a filter the caller happens to have set
        PriceLine.Init();
        PriceLine."Line No." := 10000;
        PriceLine."Item No." := 'A';
        PriceLine."Starting Date" := DMY2Date(1, 1, 2027);
        PriceLine."Ending Date" := DMY2Date(31, 1, 2027);
        PriceLine.Insert();

        PriceLine.Init();
        PriceLine."Line No." := 20000;
        PriceLine."Item No." := 'B';
        PriceLine."Starting Date" := DMY2Date(10, 5, 2027);
        PriceLine."Ending Date" := DMY2Date(1, 5, 2027);
        PriceLine.Insert();

        PriceLine.SetRange("Item No.", 'A');

        asserterror Analyzer.MergeValidityPeriods(PriceLine, MergedPeriod);
        Assert.ExpectedError('before the starting date');
    end;

    [Test]
    procedure X077_MergeCalledTwiceOnTheSameOutputBufferReflectsOnlyTheSecondCall()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        MergedPeriod: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] A caller that reuses the same output buffer across two merges must see only the second call's periods, not a mix of both
        X077_AddLine(PriceLine, 10000, DMY2Date(1, 1, 2027), DMY2Date(10, 1, 2027));
        Analyzer.MergeValidityPeriods(PriceLine, MergedPeriod);

        PriceLine.DeleteAll();
        X077_AddLine(PriceLine, 10000, DMY2Date(1, 6, 2027), DMY2Date(10, 6, 2027));
        Analyzer.MergeValidityPeriods(PriceLine, MergedPeriod);

        Assert.AreEqual(1, MergedPeriod.Count(), 'A second merge into a reused output buffer must leave only the second call''s periods behind');
        MergedPeriod.Get(10000);
        Assert.AreEqual(DMY2Date(1, 6, 2027), MergedPeriod."Starting Date", 'The output buffer must reflect only the second call''s period, not any period left over from the first call');
        Assert.AreEqual(DMY2Date(10, 6, 2027), MergedPeriod."Ending Date", 'The output buffer must reflect only the second call''s period, not any period left over from the first call');
    end;

    [Test]
    procedure X077_MergeKeepsTheOuterEndingDateWhenAWindowSitsFullyInsideAnother()
    var
        PriceLine: Record "CG X077 Price Validity Line" temporary;
        MergedPeriod: Record "CG X077 Price Validity Line" temporary;
        Analyzer: Codeunit "CG X077 Validity Analyzer";
    begin
        // [SCENARIO] A short window sits entirely within a year-long one. The
        // year-long window already covers it, so the merged coverage period
        // must still run to the outer ending date - absorbing the inner window
        // must not pull the end backwards to the inner one's earlier date.
        X077_AddLine(PriceLine, 10000, DMY2Date(1, 1, 2027), DMY2Date(31, 12, 2027));
        X077_AddLine(PriceLine, 20000, DMY2Date(1, 3, 2027), DMY2Date(10, 3, 2027));

        Analyzer.MergeValidityPeriods(PriceLine, MergedPeriod);

        Assert.AreEqual(1, MergedPeriod.Count(), 'A window contained by another must merge into a single coverage period');
        MergedPeriod.Get(10000);
        Assert.AreEqual(DMY2Date(1, 1, 2027), MergedPeriod."Starting Date", 'The merged coverage period must start on the outer window''s starting date');
        Assert.AreEqual(DMY2Date(31, 12, 2027), MergedPeriod."Ending Date", 'The merged coverage period must run to the outer window''s ending date, not stop on the inner window''s earlier ending date');
    end;

    // ==========================================================
    // X070 - donor CG-AL-X070
    // ==========================================================

    local procedure X070_Reset()
    var
        ImportLine: Record "CG X070 Import Line";
        ImportedOrder: Record "CG X070 Imported Order";
    begin
        ImportLine.DeleteAll();
        ImportedOrder.DeleteAll();
    end;

    local procedure X070_CreateLine(BatchCode: Code[20]; LineNo: Integer; CustomerNo: Code[20]; LineQuantity: Decimal)
    begin
        X070_CreateLine(BatchCode, LineNo, CustomerNo, LineQuantity, "CG X070 Import Status"::Pending);
    end;

    local procedure X070_CreateLine(BatchCode: Code[20]; LineNo: Integer; CustomerNo: Code[20]; LineQuantity: Decimal; LineStatus: Enum "CG X070 Import Status")
    var
        ImportLine: Record "CG X070 Import Line";
    begin
        ImportLine.Init();
        ImportLine."Batch Code" := BatchCode;
        ImportLine."Line No." := LineNo;
        ImportLine."Customer No." := CustomerNo;
        ImportLine.Quantity := LineQuantity;
        ImportLine.Status := LineStatus;
        ImportLine.Insert();
    end;

    local procedure X070_ImportedOrderCount(BatchCode: Code[20]): Integer
    var
        ImportedOrder: Record "CG X070 Imported Order";
    begin
        ImportedOrder.SetRange("Batch Code", BatchCode);
        exit(ImportedOrder.Count());
    end;

    local procedure X070_ImportedOrderExists(BatchCode: Code[20]; LineNo: Integer): Boolean
    var
        ImportedOrder: Record "CG X070 Imported Order";
    begin
        exit(ImportedOrder.Get(BatchCode, LineNo));
    end;

    local procedure X070_AssertLineHasStatus(BatchCode: Code[20]; LineNo: Integer; ExpectedStatus: Enum "CG X070 Import Status"; Msg: Text)
    var
        ImportLine: Record "CG X070 Import Line";
    begin
        Assert.IsTrue(ImportLine.Get(BatchCode, LineNo), StrSubstNo('Expected line %1 of batch %2 to still exist', LineNo, BatchCode));
        Assert.AreEqual(Format(ExpectedStatus), Format(ImportLine.Status), Msg);
    end;

    local procedure X070_AssertErrorContains(Fragment: Text)
    var
        ActualError: Text;
    begin
        ActualError := GetLastErrorText();
        Assert.IsTrue(LowerCase(ActualError).Contains(LowerCase(Fragment)),
            StrSubstNo('Expected the error to mention "%1", got: %2', Fragment, ActualError));
    end;

    [Test]
    procedure X070_AllPendingLinesOfTheBatchAreImported()
    var
        ImportBatch: Codeunit "CG X070 Import Batch";
        Any: Codeunit Any;
    begin
        X070_Reset();
        X070_CreateLine('X70-T01', 10, 'CUST-A', Any.DecimalInRange(1, 500, 2));
        X070_CreateLine('X70-T01', 20, 'CUST-B', Any.DecimalInRange(1, 500, 2));
        X070_CreateLine('X70-T01', 30, 'CUST-C', Any.DecimalInRange(1, 500, 2));

        ImportBatch.ImportBatch('X70-T01');

        Assert.AreEqual(3, X070_ImportedOrderCount('X70-T01'), 'Expected exactly one imported order per pending line of a clean batch');
        X070_AssertLineHasStatus('X70-T01', 10, "CG X070 Import Status"::Imported, 'Line 10 must be marked imported');
        X070_AssertLineHasStatus('X70-T01', 20, "CG X070 Import Status"::Imported, 'Line 20 must be marked imported');
        X070_AssertLineHasStatus('X70-T01', 30, "CG X070 Import Status"::Imported, 'Line 30 must be marked imported');
    end;

    [Test]
    procedure X070_ImportCopiesCustomerAndQuantityToTheImportedOrder()
    var
        ImportedOrder: Record "CG X070 Imported Order";
        ImportBatch: Codeunit "CG X070 Import Batch";
        Any: Codeunit Any;
        CustomerNo: Code[20];
        LineQuantity: Decimal;
    begin
        X070_Reset();
        CustomerNo := CopyStr('X70-' + UpperCase(Any.AlphabeticText(10)), 1, 20);
        LineQuantity := Any.DecimalInRange(1, 900, 2);
        X070_CreateLine('X70-T02', 10, CustomerNo, LineQuantity);

        ImportBatch.ImportBatch('X70-T02');

        Assert.IsTrue(ImportedOrder.Get('X70-T02', 10), 'Expected an imported order for the imported line');
        Assert.AreEqual(CustomerNo, ImportedOrder."Customer No.", 'Expected the line''s customer to carry over to the imported order');
        Assert.AreEqual(LineQuantity, ImportedOrder.Quantity, 'Expected the line''s quantity to carry over to the imported order');
    end;

    [Test]
    procedure X070_ALineWithNoCustomerFailsAndIsNotImported()
    var
        ImportBatch: Codeunit "CG X070 Import Batch";
    begin
        X070_Reset();
        X070_CreateLine('X70-T03', 10, '', 5);
        Commit();

        asserterror ImportBatch.ImportBatch('X70-T03');

        X070_AssertErrorContains('Customer No.');
        X070_AssertErrorContains('must have a value');
        Assert.IsFalse(X070_ImportedOrderExists('X70-T03', 10), 'Expected no imported order for a line missing its customer');
        X070_AssertLineHasStatus('X70-T03', 10, "CG X070 Import Status"::Pending, 'A line that fails its own guard must stay pending');
    end;

    [Test]
    procedure X070_AZeroQuantityLineFailsAndIsNotImported()
    var
        ImportBatch: Codeunit "CG X070 Import Batch";
    begin
        X070_Reset();
        X070_CreateLine('X70-T04', 10, 'CUST-A', 0);
        Commit();

        asserterror ImportBatch.ImportBatch('X70-T04');

        X070_AssertErrorContains('must be positive');
        Assert.IsFalse(X070_ImportedOrderExists('X70-T04', 10), 'Expected no imported order for a zero-quantity line');
        X070_AssertLineHasStatus('X70-T04', 10, "CG X070 Import Status"::Pending, 'A line that fails its own guard must stay pending');
    end;

    [Test]
    procedure X070_ANegativeQuantityLineFailsAndIsNotImported()
    var
        ImportBatch: Codeunit "CG X070 Import Batch";
        Any: Codeunit Any;
    begin
        X070_Reset();
        X070_CreateLine('X70-T05', 10, 'CUST-A', -Any.DecimalInRange(1, 500, 2));
        Commit();

        asserterror ImportBatch.ImportBatch('X70-T05');

        X070_AssertErrorContains('must be positive');
        Assert.IsFalse(X070_ImportedOrderExists('X70-T05', 10), 'Expected no imported order for a negative-quantity line');
        X070_AssertLineHasStatus('X70-T05', 10, "CG X070 Import Status"::Pending, 'A line that fails its own guard must stay pending');
    end;

    local procedure X070_SeedPoisonedBatch(BatchCode: Code[20])
    var
        Any: Codeunit Any;
    begin
        X070_CreateLine(BatchCode, 10, 'CUST-A', Any.DecimalInRange(1, 500, 2));
        X070_CreateLine(BatchCode, 20, 'CUST-B', Any.DecimalInRange(1, 500, 2));
        X070_CreateLine(BatchCode, 30, '', Any.DecimalInRange(1, 500, 2));
        X070_CreateLine(BatchCode, 40, 'CUST-D', Any.DecimalInRange(1, 500, 2));
        // Committed so the failing run's own error can only affect what the
        // run itself writes, never this test's own arrangement.
        Commit();
    end;

    [Test]
    procedure X070_LinesImportedBeforeAFailingLineSurviveTheRun()
    var
        ImportBatch: Codeunit "CG X070 Import Batch";
    begin
        X070_Reset();
        X070_SeedPoisonedBatch('X70-T06');

        asserterror ImportBatch.ImportBatch('X70-T06');

        X070_AssertErrorContains('must have a value');
        Assert.IsTrue(X070_ImportedOrderExists('X70-T06', 10),
            'Expected the imported order of line 10 to still exist after a later line in the same run failed');
        Assert.IsTrue(X070_ImportedOrderExists('X70-T06', 20),
            'Expected the imported order of line 20 to still exist after a later line in the same run failed');
        X070_AssertLineHasStatus('X70-T06', 10, "CG X070 Import Status"::Imported, 'Line 10 must remain marked imported after a later line failed');
        X070_AssertLineHasStatus('X70-T06', 20, "CG X070 Import Status"::Imported, 'Line 20 must remain marked imported after a later line failed');
    end;

    [Test]
    procedure X070_TheFailingLineAndItsSuccessorAreNotImported()
    var
        ImportBatch: Codeunit "CG X070 Import Batch";
    begin
        X070_Reset();
        X070_SeedPoisonedBatch('X70-T07');

        asserterror ImportBatch.ImportBatch('X70-T07');

        X070_AssertErrorContains('must have a value');
        Assert.IsFalse(X070_ImportedOrderExists('X70-T07', 30), 'Expected no imported order for the line that failed its own guard');
        X070_AssertLineHasStatus('X70-T07', 30, "CG X070 Import Status"::Pending, 'The failing line itself must stay pending');
        Assert.IsFalse(X070_ImportedOrderExists('X70-T07', 40), 'Expected no imported order for the line after the one that failed - the run must stop there');
        X070_AssertLineHasStatus('X70-T07', 40, "CG X070 Import Status"::Pending, 'The line after the failing one must stay untouched');
    end;

    [Test]
    procedure X070_RepairedBatchResumesWithoutDuplicatingEarlierLines()
    var
        ImportLine: Record "CG X070 Import Line";
        ImportBatch: Codeunit "CG X070 Import Batch";
    begin
        X070_Reset();
        X070_SeedPoisonedBatch('X70-T08');
        asserterror ImportBatch.ImportBatch('X70-T08');
        ImportLine.Get('X70-T08', 30);
        ImportLine."Customer No." := 'CUST-FIX';
        ImportLine.Modify();
        Commit();

        ImportBatch.ImportBatch('X70-T08');

        Assert.AreEqual(4, X070_ImportedOrderCount('X70-T08'),
            'Expected the repaired rerun to leave exactly one imported order per line - no duplicates for lines imported on the earlier run');
        X070_AssertLineHasStatus('X70-T08', 10, "CG X070 Import Status"::Imported, 'Line 10 must be imported');
        X070_AssertLineHasStatus('X70-T08', 20, "CG X070 Import Status"::Imported, 'Line 20 must be imported');
        X070_AssertLineHasStatus('X70-T08', 30, "CG X070 Import Status"::Imported, 'The repaired line must be imported');
        X070_AssertLineHasStatus('X70-T08', 40, "CG X070 Import Status"::Imported, 'The line after the repaired one must be imported');
    end;

    [Test]
    procedure X070_ImportOnlyAffectsLinesOfTheGivenBatch()
    var
        ImportBatch: Codeunit "CG X070 Import Batch";
    begin
        X070_Reset();
        X070_CreateLine('X70-T09A', 10, 'CUST-A', 10);
        X070_CreateLine('X70-T09A', 20, 'CUST-B', 20);
        X070_CreateLine('X70-T09B', 10, '', 5);

        ImportBatch.ImportBatch('X70-T09A');

        Assert.AreEqual(2, X070_ImportedOrderCount('X70-T09A'), 'Expected both lines of the given batch to be imported');
        Assert.AreEqual(0, X070_ImportedOrderCount('X70-T09B'), 'Expected a neighbour batch to be left untouched by importing a different batch');
        X070_AssertLineHasStatus('X70-T09B', 10, "CG X070 Import Status"::Pending, 'A neighbour batch''s line must stay pending');
    end;

    [Test]
    procedure X070_AlreadyImportedLinesAreNotReprocessed()
    var
        ImportBatch: Codeunit "CG X070 Import Batch";
    begin
        X070_Reset();
        X070_CreateLine('X70-T10', 10, 'CUST-A', 5, "CG X070 Import Status"::Imported);
        X070_CreateLine('X70-T10', 20, 'CUST-B', 7);

        ImportBatch.ImportBatch('X70-T10');

        Assert.IsFalse(X070_ImportedOrderExists('X70-T10', 10), 'Expected no new imported order for a line already marked imported');
        Assert.IsTrue(X070_ImportedOrderExists('X70-T10', 20), 'Expected the pending line to be imported');
    end;

    [Test]
    procedure X070_EmptyBatchIsAQuietNoOp()
    var
        ImportBatch: Codeunit "CG X070 Import Batch";
    begin
        X070_Reset();

        ImportBatch.ImportBatch('X70-T11');

        Assert.AreEqual(0, X070_ImportedOrderCount('X70-T11'), 'Expected a batch with no pending lines to import nothing');
    end;

    [Test]
    procedure X070_ALineThatFailsToWriteStillSparesItsPredecessors()
    var
        ImportedOrder: Record "CG X070 Imported Order";
        ImportBatch: Codeunit "CG X070 Import Batch";
    begin
        X070_Reset();
        X070_CreateLine('X70-T12', 10, 'CUST-A', 10);
        X070_CreateLine('X70-T12', 20, 'CUST-B', 20);
        X070_CreateLine('X70-T12', 30, 'CUST-C', 30);
        X070_CreateLine('X70-T12', 40, 'CUST-D', 40);
        // A stray imported order already occupies line 30's key, so its own
        // Insert fails - not a guard error, a write-time error.
        ImportedOrder.Init();
        ImportedOrder."Batch Code" := 'X70-T12';
        ImportedOrder."Line No." := 30;
        ImportedOrder."Customer No." := 'STRAY';
        ImportedOrder.Quantity := 1;
        ImportedOrder.Insert();
        Commit();

        asserterror ImportBatch.ImportBatch('X70-T12');

        X070_AssertErrorContains('already exists');
        Assert.IsTrue(X070_ImportedOrderExists('X70-T12', 10),
            'Expected the imported order of line 10 to still exist after a later line crashed while writing its own imported order');
        Assert.IsTrue(X070_ImportedOrderExists('X70-T12', 20),
            'Expected the imported order of line 20 to still exist after a later line crashed while writing its own imported order');
        X070_AssertLineHasStatus('X70-T12', 10, "CG X070 Import Status"::Imported, 'Line 10 must remain marked imported');
        X070_AssertLineHasStatus('X70-T12', 20, "CG X070 Import Status"::Imported, 'Line 20 must remain marked imported');
        X070_AssertLineHasStatus('X70-T12', 30, "CG X070 Import Status"::Pending, 'The line that crashed while writing must stay pending');
        Assert.IsFalse(X070_ImportedOrderExists('X70-T12', 40), 'Expected no imported order for the line after the one that crashed - the run must stop there');
    end;

    // ==========================================================
    // X074 - donor CG-AL-X074
    // ==========================================================

    local procedure X074_SeedComment(ExpenseReportNo: Code[20]; LineNo: Integer; CommentText: Text[250])
    var
        CommentLine: Record "CG X074 Comment Line";
    begin
        CommentLine.Init();
        CommentLine."Expense Report No." := ExpenseReportNo;
        CommentLine."Line No." := LineNo;
        CommentLine."Comment Text" := CommentText;
        CommentLine.Insert();
    end;

    local procedure X074_SeedReport(No: Code[20]; InitialCommentCount: Integer)
    var
        ExpenseReport: Record "CG X074 Report";
    begin
        ExpenseReport.Init();
        ExpenseReport."No." := No;
        ExpenseReport."Total Comment Count" := InitialCommentCount;
        ExpenseReport.Insert();
    end;

    [Test]
    procedure X074_BrandNewReportShowsNoRelatedComments()
    var
        CommentLineRec: Record "CG X074 Comment Line";
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
        CommentCount: Integer;
    begin
        CommentLineRec.DeleteAll();

        // Orphaned comment lines left behind by other users' unsaved
        // reports elsewhere in the system - none of these belong to the
        // report being opened.
        X074_SeedComment('', 1, 'orphan one');
        X074_SeedComment('', 2, 'orphan two');
        X074_SeedComment('', 3, 'orphan three');

        // A real, saved report's own comments - also not the one being
        // opened, and must not be counted either.
        X074_SeedComment('R0001', 1, 'unrelated report comment');
        X074_SeedComment('R0001', 2, 'unrelated report comment');

        // A comments list opening for a brand-new, not-yet-saved report has
        // no report key yet.
        CommentLineRec.SetRange("Expense Report No.", '');
        CommentMgt.CountRelatedComments(CommentLineRec, CommentCount);

        Assert.AreEqual(0, CommentCount, 'A brand-new report has no comments of its own yet');
    end;

    [Test]
    procedure X074_SavedReportCountIncludesOnlyItsOwnComments()
    var
        CommentLineRec: Record "CG X074 Comment Line";
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
        CommentCount: Integer;
    begin
        CommentLineRec.DeleteAll();

        X074_SeedComment('R0002', 1, 'r0002 comment');
        X074_SeedComment('R0002', 2, 'r0002 comment');
        X074_SeedComment('R0003', 1, 'r0003 comment');
        X074_SeedComment('R0003', 2, 'r0003 comment');
        X074_SeedComment('R0003', 3, 'r0003 comment');
        X074_SeedComment('R0003', 4, 'r0003 comment');
        X074_SeedComment('', 1, 'orphan');

        // Positioned on one of the report's own lines - the way a saved
        // report's comments list actually lands once it opens, rather than
        // a range with nothing found yet.
        CommentLineRec.SetRange("Expense Report No.", 'R0002');
        CommentLineRec.FindFirst();
        CommentMgt.CountRelatedComments(CommentLineRec, CommentCount);

        Assert.AreEqual(2, CommentCount, 'A saved report only counts its own comments');
    end;

    [Test]
    procedure X074_PositionedRecordWithNoActiveRangeUsesItsOwnKey()
    var
        CommentLineRec: Record "CG X074 Comment Line";
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
        CommentCount: Integer;
    begin
        CommentLineRec.DeleteAll();

        X074_SeedComment('R0004', 1, 'r0004 comment');
        X074_SeedComment('R0004', 2, 'r0004 comment');
        X074_SeedComment('R0004', 3, 'r0004 comment');
        X074_SeedComment('R0004', 4, 'r0004 comment');
        X074_SeedComment('R0004', 5, 'r0004 comment');
        X074_SeedComment('R0005', 1, 'other report comment');

        // Positioned directly on one of the report's own lines, with no
        // range ever set on the field - the way a row looks once you've
        // simply looked it up, rather than searched for it.
        CommentLineRec.Get('R0004', 1);
        CommentMgt.CountRelatedComments(CommentLineRec, CommentCount);

        Assert.AreEqual(5, CommentCount, 'A positioned line must report its own report''s comment count');
    end;

    [Test]
    procedure X074_CommentsAreAppendedWithIncreasingLineNumbers()
    var
        CommentLine: Record "CG X074 Comment Line";
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
    begin
        CommentLine.DeleteAll();

        CommentMgt.AddComment('R0006', 'first note');
        CommentMgt.AddComment('R0006', 'second note');

        CommentLine.Get('R0006', 10000);
        Assert.AreEqual('first note', CommentLine."Comment Text", 'The first comment must be stored at the first line');

        CommentLine.Get('R0006', 20000);
        Assert.AreEqual('second note', CommentLine."Comment Text", 'The second comment must be stored at the next line');
    end;

    [Test]
    procedure X074_ReportSummaryReflectsOnlyItsOwnCommentsAndLeavesOthersAlone()
    var
        CommentLine: Record "CG X074 Comment Line";
        ExpenseReport: Record "CG X074 Report";
        OtherExpenseReport: Record "CG X074 Report";
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
    begin
        CommentLine.DeleteAll();
        ExpenseReport.DeleteAll();

        X074_SeedReport('R0007', 0);
        X074_SeedReport('R0008', 777);

        CommentMgt.AddComment('R0007', 'a');
        CommentMgt.AddComment('R0007', 'b');
        CommentMgt.AddComment('R0007', 'c');

        ExpenseReport.Get('R0007');
        CommentMgt.UpdateReportSummary(ExpenseReport);

        ExpenseReport.Get('R0007');
        Assert.AreEqual(3, ExpenseReport."Total Comment Count", 'The updated report must show its own current comment count');

        OtherExpenseReport.Get('R0008');
        Assert.AreEqual(777, OtherExpenseReport."Total Comment Count", 'A different report''s stored count must not change');
    end;

    [Test]
    procedure X074_UpdateReportSummaryExcludesAnUnrelatedReportsComments()
    var
        CommentLine: Record "CG X074 Comment Line";
        ExpenseReport: Record "CG X074 Report";
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
    begin
        CommentLine.DeleteAll();
        ExpenseReport.DeleteAll();

        X074_SeedReport('R0007', 0);
        CommentMgt.AddComment('R0007', 'a');
        CommentMgt.AddComment('R0007', 'b');

        X074_SeedComment('R0008', 1, 'unrelated');
        X074_SeedComment('R0008', 2, 'unrelated');
        X074_SeedComment('R0008', 3, 'unrelated');

        ExpenseReport.Get('R0007');
        CommentMgt.UpdateReportSummary(ExpenseReport);

        ExpenseReport.Get('R0007');
        Assert.AreEqual(2, ExpenseReport."Total Comment Count",
          'A report''s updated comment count must reflect only its own comments, not another report''s');
    end;

    [Test]
    procedure X074_LineNumberingDoesNotLeakAcrossReports()
    var
        CommentLine: Record "CG X074 Comment Line";
        CommentMgt: Codeunit "CG X074 Comment Mgt.";
    begin
        CommentLine.DeleteAll();

        CommentMgt.AddComment('R9999', 'someone else''s first note');
        CommentMgt.AddComment('R0001', 'first note for a different report');

        CommentLine.Get('R0001', 10000);
        Assert.AreEqual('first note for a different report', CommentLine."Comment Text",
          'A report''s first comment must always start at its own first line, regardless of what other reports already contain');
    end;
}
