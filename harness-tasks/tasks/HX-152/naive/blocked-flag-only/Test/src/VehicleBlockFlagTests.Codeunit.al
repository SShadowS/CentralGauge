codeunit 80594 "CGR Vehicle Block Flag Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure RobotRefusesOpenContracts()
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        VehicleBlocking: Codeunit "CGR Vehicle Blocking";
        ContractNo: Code[20];
    begin
        Lib.CreateVehicle('HX152-NF1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := Lib.CreateContract('HX152-NF1');
        Commit();

        asserterror VehicleBlocking.BlockVehicle('HX152-NF1', 'Brakes');

        Assert.ExpectedError('Vehicle HX152-NF1 has open contracts. Block it from the vehicle card.');
        Assert.IsTrue(Contract.Get(ContractNo), 'Open contract kept');
        Vehicle.Get('HX152-NF1');
        Assert.IsFalse(Vehicle.Blocked, 'Vehicle not blocked');
    end;

    [Test]
    procedure RentedOutVehicleRefused()
    var
        Vehicle: Record "CGR Vehicle";
        VehicleBlocking: Codeunit "CGR Vehicle Blocking";
    begin
        Lib.CreateVehicle('HX152-NF2', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Vehicle.Get('HX152-NF2');
        Vehicle."Checked Out" := true;
        Vehicle.Modify();
        Commit();

        asserterror VehicleBlocking.BlockVehicle('HX152-NF2', 'Brakes');

        Assert.ExpectedError('Vehicle HX152-NF2 is rented out.');
    end;

    [Test]
    procedure FreeVehicleIsBlocked()
    var
        Vehicle: Record "CGR Vehicle";
        VehicleBlocking: Codeunit "CGR Vehicle Blocking";
    begin
        Lib.CreateVehicle('HX152-NF3', 1000, Enum::"CGR Maintenance Strategy"::Default);

        VehicleBlocking.BlockVehicle('HX152-NF3', 'Brakes');

        Vehicle.Get('HX152-NF3');
        Assert.IsTrue(Vehicle.Blocked, 'Vehicle blocked');
    end;

    [Test]
    procedure PartnerRefusalKeepsVehicleFree()
    var
        Vehicle: Record "CGR Vehicle";
        PartnerSpy: Codeunit "CGR Block Flag Partner Spy";
        VehicleBlocking: Codeunit "CGR Vehicle Blocking";
    begin
        Lib.CreateVehicle('HX152-NF4', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Commit();
        BindSubscription(PartnerSpy);

        asserterror VehicleBlocking.BlockVehicle('HX152-NF4', 'Brakes');

        UnbindSubscription(PartnerSpy);
        Assert.ExpectedError('Partner says no to HX152-NF4.');
        Vehicle.Get('HX152-NF4');
        Assert.IsFalse(Vehicle.Blocked, 'Vehicle not blocked');
    end;
}
