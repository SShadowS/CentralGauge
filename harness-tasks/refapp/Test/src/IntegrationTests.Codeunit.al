codeunit 80040 "CGR Integration Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure PayloadCarriesVehicleNo()
    var
        Facade: Codeunit "CGR Integration Facade";
    begin
        Assert.AreEqual('{"event":"vehicleCheckedOut","vehicleNo":"T-INT-001"}',
            Facade.VehicleCheckedOutPayload('T-INT-001'), 'Payload shape');
    end;

    [Test]
    procedure OutboxQueuesCheckout()
    var
        Entry: Record "CGR Outbox Entry";
        RentalMgt: Codeunit "CGR Rental Mgt";
        Payload: JsonObject;
        Token: JsonToken;
    begin
        Lib.CreateVehicle('T-INT-002', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Entry.SetRange("Vehicle No.", 'T-INT-002');
        Entry.DeleteAll();
        RentalMgt.CheckOut(Lib.CreateContract('T-INT-002'));
        Assert.IsTrue(Entry.FindLast(), 'A checkout queues an outbox entry for the vehicle');
        Assert.AreEqual('vehicleCheckedOut', Entry."Event Type", 'Outbox event type');
        Assert.IsTrue(Payload.ReadFrom(Entry.Payload), 'The payload is JSON');
        Assert.IsTrue(Payload.Get('vehicleNo', Token), 'The payload names the vehicle');
        Assert.AreEqual('T-INT-002', Token.AsValue().AsText(), 'Payload vehicle number');
    end;
}
