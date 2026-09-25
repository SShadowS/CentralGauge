codeunit 80040 "CGR Integration Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure PayloadCarriesVehicleNo()
    var
        Facade: Codeunit "CGR Integration Facade";
    begin
        Assert.AreEqual('{"event":"vehicleCheckedOut","vehicleNo":"T-INT-001"}',
            Facade.VehicleCheckedOutPayload('T-INT-001'), 'Payload shape');
    end;
}
