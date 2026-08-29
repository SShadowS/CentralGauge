codeunit 89385 "CG-AL-X165 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods (see
    // tests/al/hard/CG-AL-X065.Test.al for the same note), so every test
    // clears the four persisted tables before seeding its own rows. The
    // manifest row buffer is a temporary record owned by the caller, so it
    // never needs clearing - each test declares its own.

    local procedure ClearAll()
    var
        Shipment: Record "CG X165 Shipment";
        ShipmentLine: Record "CG X165 Shipment Line";
        Carrier: Record "CG X165 Carrier";
        Route: Record "CG X165 Route";
    begin
        Shipment.DeleteAll();
        ShipmentLine.DeleteAll();
        Carrier.DeleteAll();
        Route.DeleteAll();
    end;

    local procedure SeedCarrier(CarrierCode: Code[20]; DisplayName: Text[100]; SurchargePct: Decimal)
    var
        Carrier: Record "CG X165 Carrier";
    begin
        Carrier.Init();
        Carrier."Code" := CarrierCode;
        Carrier."Display Name" := DisplayName;
        Carrier."Surcharge Pct" := SurchargePct;
        Carrier.Insert();
    end;

    local procedure SeedRoute(RouteCode: Code[20]; DisplayName: Text[100])
    var
        Route: Record "CG X165 Route";
    begin
        Route.Init();
        Route."Code" := RouteCode;
        Route."Display Name" := DisplayName;
        Route.Insert();
    end;

    local procedure SeedShipment(ShipmentNo: Code[20]; CarrierCode: Code[20]; RouteCode: Code[20]; ShipmentPriority: Integer)
    var
        Shipment: Record "CG X165 Shipment";
    begin
        Shipment.Init();
        Shipment."No." := ShipmentNo;
        Shipment."Carrier Code" := CarrierCode;
        Shipment."Route Code" := RouteCode;
        Shipment.Priority := ShipmentPriority;
        Shipment.Insert();
    end;

    local procedure SeedShipmentLine(ShipmentNo: Code[20]; LineNo: Integer; LineWeight: Decimal; LineFreight: Decimal)
    var
        ShipmentLine: Record "CG X165 Shipment Line";
    begin
        ShipmentLine.Init();
        ShipmentLine."Shipment No." := ShipmentNo;
        ShipmentLine."Line No." := LineNo;
        ShipmentLine.Weight := LineWeight;
        ShipmentLine."Freight Amount" := LineFreight;
        ShipmentLine.Insert();
    end;

    local procedure FlushDataCache(DecoyShipmentNo: Code[20])
    begin
        // The warm-up call and the fixture-seeding loop leave the session's
        // data cache warm, and a cache-served read costs zero in the
        // counters below - the graded call would then measure nothing. A
        // write to an unrelated row, followed by SelectLatestVersion, forces
        // real statements again for the measured call.
        SeedShipment(DecoyShipmentNo, 'CAR-DECOY', 'RT-DECOY', 1);
        SeedShipmentLine(DecoyShipmentNo, 1, 1, 1);
        SelectLatestVersion();
    end;

    local procedure SelectRoute(Ordinal: Integer): Code[20]
    begin
        // Distributes shipments deterministically across three routes so a
        // route-summary row aggregates many shipments, without needing any
        // randomization.
        case Ordinal mod 3 of
            0:
                exit('RT-A');
            1:
                exit('RT-B');
            else
                exit('RT-C');
        end;
    end;

    local procedure MaxStatements(): Integer
    begin
        exit(70);
    end;

    [Test]
    procedure BuildManifestProducesShipmentRowsWithResolvedDisplaysAndTotals()
    var
        ManifestBuilder: Codeunit "CG X165 Manifest Builder";
        ManifestRow: Record "CG X165 Manifest Row" temporary;
    begin
        ClearAll();
        SeedCarrier('CAR-1', 'Alpha Carriers', 10);
        SeedRoute('RT-1', 'Northern Lane');
        SeedShipment('SHIP-1', 'CAR-1', 'RT-1', 7);
        SeedShipmentLine('SHIP-1', 1, 100, 50);
        SeedShipmentLine('SHIP-1', 2, 50, 30);

        ManifestBuilder.BuildManifest('CAR-1', ManifestRow);

        ManifestRow.SetRange("Row Kind", ManifestRow."Row Kind"::Shipment);
        ManifestRow.SetRange("Shipment No.", 'SHIP-1');
        ManifestRow.FindFirst();
        Assert.AreEqual('Alpha Carriers', ManifestRow."Carrier Display",
            'Expected the shipment row to show the carrier''s display name');
        Assert.AreEqual('Northern Lane', ManifestRow."Route Display",
            'Expected the shipment row to show the route''s display name');
        Assert.AreEqual(2, ManifestRow."Line Count",
            'Expected the shipment''s line count to match how many lines it has');
        Assert.AreEqual(150, ManifestRow."Total Weight",
            'Expected the shipment''s total weight to be the sum of its lines'' weight');
        Assert.AreEqual(88, ManifestRow."Freight Total",
            'Expected the shipment''s freight total to be its lines'' freight sum inflated by the carrier''s surcharge');
        Assert.AreEqual(7, ManifestRow.Priority,
            'Expected the shipment''s priority to carry through to the row unchanged');
    end;

    [Test]
    procedure BuildManifestGivesEachShipmentItsOwnTotals()
    var
        ManifestBuilder: Codeunit "CG X165 Manifest Builder";
        ManifestRow: Record "CG X165 Manifest Row" temporary;
    begin
        ClearAll();
        SeedCarrier('CAR-2', 'Beta Carriers', 0);
        SeedRoute('RT-2', 'Route Two');
        SeedShipment('SHIP-2A', 'CAR-2', 'RT-2', 1);
        SeedShipmentLine('SHIP-2A', 1, 10, 5);
        SeedShipment('SHIP-2B', 'CAR-2', 'RT-2', 2);
        SeedShipmentLine('SHIP-2B', 1, 20, 8);
        SeedShipmentLine('SHIP-2B', 2, 5, 2);

        ManifestBuilder.BuildManifest('CAR-2', ManifestRow);

        ManifestRow.SetRange("Row Kind", ManifestRow."Row Kind"::Shipment);
        ManifestRow.SetRange("Shipment No.", 'SHIP-2A');
        ManifestRow.FindFirst();
        Assert.AreEqual(1, ManifestRow."Line Count",
            'Expected this shipment to show its own line count, not another shipment''s');
        Assert.AreEqual(10, ManifestRow."Total Weight",
            'Expected this shipment to show its own total weight, not another shipment''s');
        Assert.AreEqual(5, ManifestRow."Freight Total",
            'Expected this shipment to show its own freight total, not another shipment''s');

        ManifestRow.SetRange("Shipment No.", 'SHIP-2B');
        ManifestRow.FindFirst();
        Assert.AreEqual(2, ManifestRow."Line Count",
            'Expected this shipment to show its own line count, not another shipment''s');
        Assert.AreEqual(25, ManifestRow."Total Weight",
            'Expected this shipment to show its own total weight, not another shipment''s');
        Assert.AreEqual(10, ManifestRow."Freight Total",
            'Expected this shipment to show its own freight total, not another shipment''s');
    end;

    [Test]
    procedure BuildManifestScopesToOneCarrierAndExcludesAnothersShipmentsEvenOnASharedRoute()
    var
        ManifestBuilder: Codeunit "CG X165 Manifest Builder";
        ManifestRow: Record "CG X165 Manifest Row" temporary;
    begin
        ClearAll();
        SeedCarrier('CAR-3A', 'Carrier 3A', 0);
        SeedCarrier('CAR-3B', 'Carrier 3B', 0);
        SeedRoute('RT-3', 'Route Three');
        SeedShipment('SHIP-3A', 'CAR-3A', 'RT-3', 1);
        SeedShipmentLine('SHIP-3A', 1, 40, 20);
        SeedShipment('SHIP-3B', 'CAR-3B', 'RT-3', 2);
        SeedShipmentLine('SHIP-3B', 1, 99, 77);

        ManifestBuilder.BuildManifest('CAR-3A', ManifestRow);

        ManifestRow.SetRange("Row Kind", ManifestRow."Row Kind"::Shipment);
        Assert.AreEqual(1, ManifestRow.Count(),
            'Expected only the requested carrier''s shipments to appear, not another carrier''s');
        ManifestRow.SetRange("Shipment No.", 'SHIP-3B');
        Assert.AreEqual(0, ManifestRow.Count(),
            'Expected the other carrier''s shipment to be entirely absent from this carrier''s manifest');

        ManifestRow.Reset();
        ManifestRow.SetRange("Row Kind", ManifestRow."Row Kind"::RouteTotal);
        ManifestRow.SetRange("Route Code", 'RT-3');
        ManifestRow.FindFirst();
        Assert.AreEqual(40, ManifestRow."Total Weight",
            'Expected the route total to include only this carrier''s shipment on that route, not the other carrier''s');
        Assert.AreEqual(20, ManifestRow."Freight Total",
            'Expected the route total to include only this carrier''s shipment on that route, not the other carrier''s');
    end;

    [Test]
    procedure RouteSummaryAggregatesAcrossMultipleShipmentsOnTheSameRoute()
    var
        ManifestBuilder: Codeunit "CG X165 Manifest Builder";
        ManifestRow: Record "CG X165 Manifest Row" temporary;
    begin
        ClearAll();
        SeedCarrier('CAR-4', 'Carrier Four', 20);
        SeedRoute('RT-4', 'Route Four');
        SeedShipment('SHIP-4A', 'CAR-4', 'RT-4', 1);
        SeedShipmentLine('SHIP-4A', 1, 100, 50);
        SeedShipment('SHIP-4B', 'CAR-4', 'RT-4', 2);
        SeedShipmentLine('SHIP-4B', 1, 60, 30);

        ManifestBuilder.BuildManifest('CAR-4', ManifestRow);

        ManifestRow.SetRange("Row Kind", ManifestRow."Row Kind"::RouteTotal);
        ManifestRow.SetRange("Route Code", 'RT-4');
        ManifestRow.FindFirst();
        Assert.AreEqual(160, ManifestRow."Total Weight",
            'Expected the route total to add both shipments'' weight together');
        Assert.AreEqual(96, ManifestRow."Freight Total",
            'Expected the route total to add both shipments'' surcharge-inflated freight together');
    end;

    [Test]
    procedure EachRouteGetsItsOwnSummaryWhenACarrierShipsOnSeveralRoutes()
    var
        ManifestBuilder: Codeunit "CG X165 Manifest Builder";
        ManifestRow: Record "CG X165 Manifest Row" temporary;
    begin
        ClearAll();
        SeedCarrier('CAR-8', 'Carrier Eight', 0);
        SeedRoute('RT-8A', 'Route Eight A');
        SeedRoute('RT-8B', 'Route Eight B');
        SeedShipment('SHIP-8A', 'CAR-8', 'RT-8A', 1);
        SeedShipmentLine('SHIP-8A', 1, 100, 40);
        SeedShipment('SHIP-8B', 'CAR-8', 'RT-8B', 2);
        SeedShipmentLine('SHIP-8B', 1, 25, 10);

        ManifestBuilder.BuildManifest('CAR-8', ManifestRow);

        ManifestRow.SetRange("Row Kind", ManifestRow."Row Kind"::RouteTotal);
        Assert.AreEqual(2, ManifestRow.Count(),
            'Expected one summary row for each route the carrier ships on, not a single combined one');
        ManifestRow.SetRange("Route Code", 'RT-8A');
        ManifestRow.FindFirst();
        Assert.AreEqual(100, ManifestRow."Total Weight",
            'Expected each route''s summary to hold only that route''s own shipments');
        Assert.AreEqual(40, ManifestRow."Freight Total",
            'Expected each route''s summary to hold only that route''s own shipments');
        ManifestRow.SetRange("Route Code", 'RT-8B');
        ManifestRow.FindFirst();
        Assert.AreEqual(25, ManifestRow."Total Weight",
            'Expected each route''s summary to hold only that route''s own shipments');
        Assert.AreEqual(10, ManifestRow."Freight Total",
            'Expected each route''s summary to hold only that route''s own shipments');
    end;

    [Test]
    procedure TheWholeRebuiltManifestIsVisibleToTheCaller()
    var
        ManifestBuilder: Codeunit "CG X165 Manifest Builder";
        ManifestRow: Record "CG X165 Manifest Row" temporary;
    begin
        ClearAll();
        SeedCarrier('CAR-9', 'Carrier Nine', 0);
        SeedRoute('RT-9', 'Route Nine');
        SeedShipment('SHIP-9', 'CAR-9', 'RT-9', 1);
        SeedShipmentLine('SHIP-9', 1, 10, 5);

        ManifestBuilder.BuildManifest('CAR-9', ManifestRow);

        Assert.AreEqual(2, ManifestRow.Count(),
            'Expected every row the build produced, shipment rows and route summaries alike, to be visible straight after the call');
    end;

    [Test]
    procedure BuildManifestLeavesDisplaysBlankWhenCarrierOrRouteMasterDataIsMissing()
    var
        ManifestBuilder: Codeunit "CG X165 Manifest Builder";
        ManifestRow: Record "CG X165 Manifest Row" temporary;
    begin
        ClearAll();
        // Deliberately no "CG X165 Carrier" row for 'CAR-5' and no
        // "CG X165 Route" row for 'RT-5' - the shipment references master
        // data that does not exist.
        SeedShipment('SHIP-5', 'CAR-5', 'RT-5', 9);
        SeedShipmentLine('SHIP-5', 1, 42, 21);

        ManifestBuilder.BuildManifest('CAR-5', ManifestRow);

        ManifestRow.SetRange("Row Kind", ManifestRow."Row Kind"::Shipment);
        ManifestRow.SetRange("Shipment No.", 'SHIP-5');
        ManifestRow.FindFirst();
        Assert.AreEqual('', ManifestRow."Carrier Display",
            'Expected a blank carrier display, not an error, when the carrier code matches no carrier');
        Assert.AreEqual('', ManifestRow."Route Display",
            'Expected a blank route display, not an error, when the route code matches no route');
        Assert.AreEqual(1, ManifestRow."Line Count",
            'Expected the line count to still be correct even when neither related name resolves');
        Assert.AreEqual(42, ManifestRow."Total Weight",
            'Expected the total weight to still be correct even when neither related name resolves');
        Assert.AreEqual(21, ManifestRow."Freight Total",
            'Expected the freight total to still be correct (no surcharge applied) even when the carrier does not resolve');
        Assert.AreEqual(9, ManifestRow.Priority,
            'Expected the priority to still carry through even when neither related name resolves');
    end;

    [Test]
    procedure BuildManifestProducesNoRowsForACarrierWithNoShipments()
    var
        ManifestBuilder: Codeunit "CG X165 Manifest Builder";
        ManifestRow: Record "CG X165 Manifest Row" temporary;
    begin
        ClearAll();
        SeedCarrier('CAR-6', 'Carrier Six', 5);

        ManifestBuilder.BuildManifest('CAR-6', ManifestRow);

        Assert.AreEqual(0, ManifestRow.Count(),
            'Expected no rows at all for a carrier with no shipments - and no error either');
    end;

    [Test]
    procedure RebuildingACarriersManifestReflectsAShipmentAddedSinceTheLastBuild()
    var
        ManifestBuilder: Codeunit "CG X165 Manifest Builder";
        ManifestRow: Record "CG X165 Manifest Row" temporary;
    begin
        ClearAll();
        SeedCarrier('CAR-7', 'Carrier Seven', 0);
        SeedRoute('RT-7', 'Route Seven');
        SeedShipment('SHIP-7A', 'CAR-7', 'RT-7', 1);
        SeedShipmentLine('SHIP-7A', 1, 10, 5);

        ManifestBuilder.BuildManifest('CAR-7', ManifestRow);
        ManifestRow.SetRange("Row Kind", ManifestRow."Row Kind"::Shipment);
        Assert.AreEqual(1, ManifestRow.Count(),
            'Expected exactly one shipment row after the first build with one shipment');

        SeedShipment('SHIP-7B', 'CAR-7', 'RT-7', 2);
        SeedShipmentLine('SHIP-7B', 1, 20, 8);
        ManifestBuilder.BuildManifest('CAR-7', ManifestRow);

        ManifestRow.SetRange("Row Kind", ManifestRow."Row Kind"::Shipment);
        Assert.AreEqual(2, ManifestRow.Count(),
            'Expected the rebuilt manifest to include the shipment added since the last build');
        ManifestRow.SetRange("Shipment No.", 'SHIP-7A');
        ManifestRow.FindFirst();
        Assert.AreEqual(10, ManifestRow."Total Weight",
            'Expected the earlier shipment''s row to still be correct after a rebuild, not dropped or stale');
        ManifestRow.SetRange("Shipment No.", 'SHIP-7B');
        ManifestRow.FindFirst();
        Assert.AreEqual(20, ManifestRow."Total Weight",
            'Expected the newly added shipment to appear correctly after a rebuild');

        ManifestRow.Reset();
        ManifestRow.SetRange("Row Kind", ManifestRow."Row Kind"::RouteTotal);
        ManifestRow.SetRange("Route Code", 'RT-7');
        ManifestRow.FindFirst();
        Assert.AreEqual(30, ManifestRow."Total Weight",
            'Expected the rebuilt route total to include both shipments, not just the one from the first build');
    end;

    [Test]
    procedure CallArgumentIsDiscardedAndRebuilt()
    var
        ManifestBuilder: Codeunit "CG X165 Manifest Builder";
        ManifestRow: Record "CG X165 Manifest Row" temporary;
    begin
        ClearAll();
        SeedCarrier('CAR-9', 'Carrier Nine', 0);
        SeedRoute('RT-9', 'Route Nine');
        SeedShipment('SHIP-9', 'CAR-9', 'RT-9', 1);
        SeedShipmentLine('SHIP-9', 1, 15, 6);

        ManifestRow.Init();
        ManifestRow."Row No." := 999;
        ManifestRow."Row Kind" := ManifestRow."Row Kind"::Shipment;
        ManifestRow."Shipment No." := 'LEFTOVER';
        ManifestRow.Insert();

        ManifestBuilder.BuildManifest('CAR-9', ManifestRow);

        ManifestRow.Reset();
        ManifestRow.SetRange("Row Kind", ManifestRow."Row Kind"::Shipment);
        Assert.AreEqual(1, ManifestRow.Count(),
            'Expected whatever the buffer held before the call to be discarded and rebuilt from scratch');
        ManifestRow.SetRange("Shipment No.", 'LEFTOVER');
        Assert.AreEqual(0, ManifestRow.Count(),
            'Expected a pre-existing entry in the caller''s buffer to be discarded, not merged into the rebuilt result');
        ManifestRow.SetRange("Shipment No.", 'SHIP-9');
        Assert.AreEqual(1, ManifestRow.Count(),
            'Expected only the real result of this call to remain after the buffer is rebuilt');
    end;

    [Test]
    procedure BuildingALargeCarriersManifestCostsTheSameAsASmallOne()
    var
        ManifestBuilder: Codeunit "CG X165 Manifest Builder";
        WarmManifestRow: Record "CG X165 Manifest Row" temporary;
        ManifestRow: Record "CG X165 Manifest Row" temporary;
        StatementsBefore: BigInteger;
        StatementsUsed: BigInteger;
        ShipmentNo: Code[20];
        i: Integer;
        j: Integer;
        ShipmentCount: Integer;
        LinesPerShipment: Integer;
    begin
        ClearAll();
        ShipmentCount := 400;
        LinesPerShipment := 5;

        // Warm up on an unrelated, single-shipment carrier first, so
        // first-touch metadata/plan loading lands outside the measurement
        // window below.
        SeedCarrier('CAR-WARM', 'Warm Carrier', 0);
        SeedRoute('RT-WARM', 'Warm Route');
        SeedShipment('S-WARM', 'CAR-WARM', 'RT-WARM', 1);
        SeedShipmentLine('S-WARM', 1, 1, 1);
        ManifestBuilder.BuildManifest('CAR-WARM', WarmManifestRow);
        ClearAll();

        // A large carrier: 400 shipments spread across 3 routes, each with
        // 5 identical lines - a busy carrier's manifest, versus the
        // one-shipment carrier measured above.
        SeedCarrier('CAR-BUSY', 'Busy Carrier', 10);
        SeedRoute('RT-A', 'Route Alpha');
        SeedRoute('RT-B', 'Route Beta');
        SeedRoute('RT-C', 'Route Gamma');
        for i := 1 to ShipmentCount do begin
            ShipmentNo := CopyStr(StrSubstNo('S-BUSY-%1', i), 1, MaxStrLen(ShipmentNo));
            SeedShipment(ShipmentNo, 'CAR-BUSY', SelectRoute(i), i);
            for j := 1 to LinesPerShipment do
                SeedShipmentLine(ShipmentNo, j, 10, 20);
        end;

        FlushDataCache('S-FLUSH-A');
        StatementsBefore := SessionInformation.SqlStatementsExecuted();
        ManifestBuilder.BuildManifest('CAR-BUSY', ManifestRow);
        StatementsUsed := SessionInformation.SqlStatementsExecuted() - StatementsBefore;

        ManifestRow.SetRange("Row Kind", ManifestRow."Row Kind"::Shipment);
        ManifestRow.SetRange("Shipment No.", 'S-BUSY-1');
        ManifestRow.FindFirst();
        Assert.AreEqual(LinesPerShipment, ManifestRow."Line Count",
            'Expected the correct line count on the low-cost build before judging its cost');
        Assert.AreEqual(50, ManifestRow."Total Weight",
            'Expected the correct total weight on the low-cost build before judging its cost');
        Assert.AreEqual(110, ManifestRow."Freight Total",
            'Expected the correct surcharge-inflated freight total on the low-cost build before judging its cost');
        ManifestRow.SetRange("Shipment No.", StrSubstNo('S-BUSY-%1', ShipmentCount));
        ManifestRow.FindFirst();
        Assert.AreEqual(110, ManifestRow."Freight Total",
            'Expected the correct freight total on the low-cost build before judging its cost - including the last shipment in a large carrier');
        Assert.IsTrue(StatementsUsed <= MaxStatements(),
            StrSubstNo('Expected building a large carrier''s manifest to cost the same as a small one: budget %1, actual %2 against %3 shipments', MaxStatements(), StatementsUsed, ShipmentCount));
    end;

    [Test]
    procedure BuildingACarriersManifestCostsTheSameAtADifferentVolumeToo()
    var
        ManifestBuilder: Codeunit "CG X165 Manifest Builder";
        WarmManifestRow: Record "CG X165 Manifest Row" temporary;
        ManifestRow: Record "CG X165 Manifest Row" temporary;
        StatementsBefore: BigInteger;
        StatementsUsed: BigInteger;
        ShipmentNo: Code[20];
        i: Integer;
        j: Integer;
        ShipmentCount: Integer;
        LinesPerShipment: Integer;
    begin
        ClearAll();
        ShipmentCount := 450;
        LinesPerShipment := 3;

        SeedCarrier('CAR-WARM2', 'Warm Carrier Two', 0);
        SeedRoute('RT-WARM2', 'Warm Route Two');
        SeedShipment('S-WARM2', 'CAR-WARM2', 'RT-WARM2', 1);
        SeedShipmentLine('S-WARM2', 1, 1, 1);
        ManifestBuilder.BuildManifest('CAR-WARM2', WarmManifestRow);
        ClearAll();

        SeedCarrier('CAR-BUSY2', 'Busy Carrier Two', 10);
        SeedRoute('RT-A', 'Route Alpha');
        SeedRoute('RT-B', 'Route Beta');
        SeedRoute('RT-C', 'Route Gamma');
        for i := 1 to ShipmentCount do begin
            ShipmentNo := CopyStr(StrSubstNo('S-BUSY2-%1', i), 1, MaxStrLen(ShipmentNo));
            SeedShipment(ShipmentNo, 'CAR-BUSY2', SelectRoute(i), i);
            for j := 1 to LinesPerShipment do
                SeedShipmentLine(ShipmentNo, j, 10, 20);
        end;

        FlushDataCache('S-FLUSH-B');
        StatementsBefore := SessionInformation.SqlStatementsExecuted();
        ManifestBuilder.BuildManifest('CAR-BUSY2', ManifestRow);
        StatementsUsed := SessionInformation.SqlStatementsExecuted() - StatementsBefore;

        ManifestRow.SetRange("Row Kind", ManifestRow."Row Kind"::Shipment);
        ManifestRow.SetRange("Shipment No.", 'S-BUSY2-1');
        ManifestRow.FindFirst();
        Assert.AreEqual(LinesPerShipment, ManifestRow."Line Count",
            'Expected the correct line count on the low-cost build before judging its cost');
        Assert.AreEqual(30, ManifestRow."Total Weight",
            'Expected the correct total weight on the low-cost build before judging its cost');
        Assert.AreEqual(66, ManifestRow."Freight Total",
            'Expected the correct surcharge-inflated freight total on the low-cost build before judging its cost');
        Assert.IsTrue(StatementsUsed <= MaxStatements(),
            StrSubstNo('Expected building a large carrier''s manifest to cost the same regardless of volume: budget %1, actual %2 against %3 shipments', MaxStatements(), StatementsUsed, ShipmentCount));
    end;

    [Test]
    procedure BuildingAManifestWithFewerShipmentsButMoreLinesEachStillCostsTheSame()
    var
        ManifestBuilder: Codeunit "CG X165 Manifest Builder";
        WarmManifestRow: Record "CG X165 Manifest Row" temporary;
        ManifestRow: Record "CG X165 Manifest Row" temporary;
        StatementsBefore: BigInteger;
        StatementsUsed: BigInteger;
        ShipmentNo: Code[20];
        i: Integer;
        j: Integer;
        ShipmentCount: Integer;
        LinesPerShipment: Integer;
    begin
        ClearAll();
        ShipmentCount := 380;
        LinesPerShipment := 14;

        SeedCarrier('CAR-WARM3', 'Warm Carrier Three', 0);
        SeedRoute('RT-WARM3', 'Warm Route Three');
        SeedShipment('S-WARM3', 'CAR-WARM3', 'RT-WARM3', 1);
        SeedShipmentLine('S-WARM3', 1, 1, 1);
        ManifestBuilder.BuildManifest('CAR-WARM3', WarmManifestRow);
        ClearAll();

        // Same order of magnitude of total lines as the other two perf
        // tests (via a much higher per-shipment line count), but noticeably
        // fewer shipments - a fix that only became cheap because of how
        // many shipments the earlier tests happened to use must still hold
        // here.
        SeedCarrier('CAR-BUSY3', 'Busy Carrier Three', 10);
        SeedRoute('RT-A', 'Route Alpha');
        SeedRoute('RT-B', 'Route Beta');
        SeedRoute('RT-C', 'Route Gamma');
        for i := 1 to ShipmentCount do begin
            ShipmentNo := CopyStr(StrSubstNo('S-BUSY3-%1', i), 1, MaxStrLen(ShipmentNo));
            SeedShipment(ShipmentNo, 'CAR-BUSY3', SelectRoute(i), i);
            for j := 1 to LinesPerShipment do
                SeedShipmentLine(ShipmentNo, j, 10, 20);
        end;

        FlushDataCache('S-FLUSH-C');
        StatementsBefore := SessionInformation.SqlStatementsExecuted();
        ManifestBuilder.BuildManifest('CAR-BUSY3', ManifestRow);
        StatementsUsed := SessionInformation.SqlStatementsExecuted() - StatementsBefore;

        ManifestRow.SetRange("Row Kind", ManifestRow."Row Kind"::Shipment);
        ManifestRow.SetRange("Shipment No.", 'S-BUSY3-1');
        ManifestRow.FindFirst();
        Assert.AreEqual(LinesPerShipment, ManifestRow."Line Count",
            'Expected the correct line count on the low-cost build before judging its cost');
        Assert.AreEqual(140, ManifestRow."Total Weight",
            'Expected the correct total weight on the low-cost build before judging its cost');
        Assert.AreEqual(308, ManifestRow."Freight Total",
            'Expected the correct surcharge-inflated freight total on the low-cost build before judging its cost');
        Assert.IsTrue(StatementsUsed <= MaxStatements(),
            StrSubstNo('Expected building a large carrier''s manifest to cost the same regardless of how many lines each shipment has: budget %1, actual %2 against %3 shipments', MaxStatements(), StatementsUsed, ShipmentCount));
    end;
}
