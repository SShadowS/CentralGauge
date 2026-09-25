codeunit 80000 "CGR Skeleton Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure CheckOutMarksVehicleCheckedOut()
    var
        Vehicle: Record "CGR Vehicle";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        Lib.CreateVehicle('SPIKE-001', 1000, Enum::"CGR Maintenance Strategy"::Default);
        RentalMgt.CheckOut(Lib.CreateContract('SPIKE-001'));
        Vehicle.Get('SPIKE-001');
        Assert.IsTrue(Vehicle."Checked Out", 'Fleet subscriber must mark the vehicle checked out');
    end;

    [Test]
    procedure CheckOutTwiceFails()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        FirstContractNo: Code[20];
        SecondContractNo: Code[20];
    begin
        Lib.CreateVehicle('SPIKE-002', 1000, Enum::"CGR Maintenance Strategy"::Default);
        FirstContractNo := Lib.CreateContract('SPIKE-002');
        SecondContractNo := Lib.CreateContract('SPIKE-002');
        RentalMgt.CheckOut(FirstContractNo);
        asserterror RentalMgt.CheckOut(SecondContractNo);
        Assert.ExpectedError('Vehicle SPIKE-002 is not available.');
    end;

    [Test]
    procedure HeavyDutyStrategyFromFleetExtension()
    var
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        Lib.CreateVehicle('SPIKE-003', 1000, Enum::"CGR Maintenance Strategy"::"Heavy Duty");
        Lib.SetLastServiceKm('SPIKE-003', 1000);
        Assert.AreEqual(6000, FleetMgt.NextServiceKm('SPIKE-003'), 'Heavy Duty adds 5000 km (Integer vs Integer)');
    end;

    [Test]
    procedure LeaseRateUsesCoreInternal()
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
        Expected: Decimal;
    begin
        Expected := 112;
        Assert.AreEqual(Expected, LeaseMgt.MonthlyRate(100, 12), '12 months adds 12 percent');
    end;

    [Test]
    procedure PayloadCarriesVehicleNo()
    var
        Facade: Codeunit "CGR Integration Facade";
    begin
        Assert.AreEqual('{"event":"vehicleCheckedOut","vehicleNo":"SPIKE-004"}',
            Facade.VehicleCheckedOutPayload('SPIKE-004'), 'Payload shape');
    end;
}
