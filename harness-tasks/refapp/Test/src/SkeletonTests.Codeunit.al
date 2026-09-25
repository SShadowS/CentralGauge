codeunit 80000 "CGR Skeleton Tests"
{
    Subtype = Test;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure CheckOutMarksVehicleCheckedOut()
    var
        Vehicle: Record "CGR Vehicle";
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        CreateVehicle('SPIKE-001', 1000, Enum::"CGR Maintenance Strategy"::Default);
        RentalMgt.CheckOut('SPIKE-001');
        Vehicle.Get('SPIKE-001');
        Assert.IsTrue(Vehicle."Checked Out", 'Fleet subscriber must mark the vehicle checked out');
    end;

    [Test]
    procedure CheckOutTwiceFails()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        CreateVehicle('SPIKE-002', 1000, Enum::"CGR Maintenance Strategy"::Default);
        RentalMgt.CheckOut('SPIKE-002');
        asserterror RentalMgt.CheckOut('SPIKE-002');
        Assert.ExpectedError('Vehicle SPIKE-002 is not available.');
    end;

    [Test]
    procedure HeavyDutyStrategyFromFleetExtension()
    var
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        CreateVehicle('SPIKE-003', 1000, Enum::"CGR Maintenance Strategy"::"Heavy Duty");
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

    local procedure CreateVehicle(VehicleNo: Code[20]; Mileage: Integer; Strategy: Enum "CGR Maintenance Strategy")
    var
        Vehicle: Record "CGR Vehicle";
    begin
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := Mileage;
        Vehicle.Strategy := Strategy;
        Vehicle.Insert();
    end;
}
