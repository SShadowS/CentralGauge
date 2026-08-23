codeunit 88833 "CG-AL-X080 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods (SOAP
    // runner), so every test deletes its own rows before seeding.

    local procedure StatusAfterSync(ShipmentNo: Code[20]; WireCode: Integer): Integer
    var
        ShipmentTracking: Record "CG X080 Shipment Tracking";
        Sync: Codeunit "CG X080 Shipment Status Sync";
    begin
        Sync.UpdateStatus(ShipmentNo, WireCode);
        ShipmentTracking.Get(ShipmentNo);
        exit(ShipmentTracking.Status.AsInteger());
    end;

    [Test]
    procedure EveryOriginalStatusCodeStillResolvesCorrectly()
    var
        ShipmentTracking: Record "CG X080 Shipment Tracking";
    begin
        ShipmentTracking.DeleteAll();

        Assert.AreEqual(Enum::"CG X080 Carrier Status"::Unknown.AsInteger(), StatusAfterSync('S1', 0), 'Wire code 0 must resolve to Unknown');
        Assert.AreEqual(Enum::"CG X080 Carrier Status"::Registered.AsInteger(), StatusAfterSync('S2', 10), 'Wire code 10 must resolve to Registered');
        Assert.AreEqual(Enum::"CG X080 Carrier Status"::"In Transit".AsInteger(), StatusAfterSync('S3', 20), 'Wire code 20 must resolve to In Transit');
        Assert.AreEqual(Enum::"CG X080 Carrier Status"::Delivered.AsInteger(), StatusAfterSync('S4', 30), 'Wire code 30 must resolve to Delivered');
    end;

    [Test]
    procedure TheNewlyIntroducedStatusCodeNoLongerGetsStuckAtUnknown()
    var
        ShipmentTracking: Record "CG X080 Shipment Tracking";
    begin
        ShipmentTracking.DeleteAll();

        Assert.AreEqual(
            Enum::"CG X080 Carrier Status"::"Out For Delivery".AsInteger(),
            StatusAfterSync('S1', 40),
            'The status code the carrier introduced must resolve to its own status, not fall back to Unknown');
    end;

    [Test]
    procedure AnUnrecognizedStatusCodeStaysUnknown()
    var
        ShipmentTracking: Record "CG X080 Shipment Tracking";
    begin
        ShipmentTracking.DeleteAll();

        Assert.AreEqual(
            Enum::"CG X080 Carrier Status"::Unknown.AsInteger(),
            StatusAfterSync('S1', 999),
            'A status code the carrier has never sent must resolve to Unknown, not raise an error and not resolve to any other status');
    end;

    [Test]
    procedure AStatusCodeAddedAfterThisReleaseAlsoResolvesCorrectly()
    var
        ShipmentTracking: Record "CG X080 Shipment Tracking";
    begin
        ShipmentTracking.DeleteAll();

        Assert.AreEqual(
            Enum::"CG X080 Carrier Status"::"Held At Customs".AsInteger(),
            StatusAfterSync('S1', 50),
            'A status code the carrier adds after this release must also resolve to its own status, exactly like the status the carrier already introduced');
    end;

    [Test]
    procedure EveryStatusEncodesBackToItsOwnWireCode()
    var
        Mapper: Codeunit "CG X080 Carrier Status Mapper";
    begin
        Assert.AreEqual(0, Mapper.ToWire(Enum::"CG X080 Carrier Status"::Unknown), 'Unknown must encode back to wire code 0');
        Assert.AreEqual(10, Mapper.ToWire(Enum::"CG X080 Carrier Status"::Registered), 'Registered must encode back to wire code 10');
        Assert.AreEqual(20, Mapper.ToWire(Enum::"CG X080 Carrier Status"::"In Transit"), 'In Transit must encode back to wire code 20');
        Assert.AreEqual(30, Mapper.ToWire(Enum::"CG X080 Carrier Status"::Delivered), 'Delivered must encode back to wire code 30');
        Assert.AreEqual(40, Mapper.ToWire(Enum::"CG X080 Carrier Status"::"Out For Delivery"), 'The status code the carrier introduced must encode back to its own wire code');
        Assert.AreEqual(50, Mapper.ToWire(Enum::"CG X080 Carrier Status"::"Held At Customs"), 'A status code the carrier adds after this release must also encode back to its own wire code');
    end;

    [Test]
    procedure SyncingOneShipmentDoesNotDisturbAnotherShipmentsStatus()
    var
        ShipmentTracking: Record "CG X080 Shipment Tracking";
        Sync: Codeunit "CG X080 Shipment Status Sync";
    begin
        ShipmentTracking.DeleteAll();

        Sync.UpdateStatus('S1', 10);
        Sync.UpdateStatus('S2', 30);

        Sync.UpdateStatus('S1', 40);

        ShipmentTracking.Get('S2');
        Assert.AreEqual(
            Enum::"CG X080 Carrier Status"::Delivered.AsInteger(),
            ShipmentTracking.Status.AsInteger(),
            'Refreshing one shipment must not change another shipment''s recorded status');
    end;

    [Test]
    procedure ReSyncingAShipmentWithARecognizedCodeReplacesAnEarlierUnknownStatus()
    var
        ShipmentTracking: Record "CG X080 Shipment Tracking";
        Sync: Codeunit "CG X080 Shipment Status Sync";
    begin
        ShipmentTracking.DeleteAll();

        Sync.UpdateStatus('S1', 999);
        Sync.UpdateStatus('S1', 20);

        ShipmentTracking.Get('S1');
        Assert.AreEqual(
            Enum::"CG X080 Carrier Status"::"In Transit".AsInteger(),
            ShipmentTracking.Status.AsInteger(),
            'Re-running the sync with a recognized status code must update the shipment to that status, not leave it at the earlier Unknown result');
        Assert.AreEqual(
            20,
            ShipmentTracking."Carrier Wire Code",
            'The shipment must record the latest status code it was synced with');
    end;
}
