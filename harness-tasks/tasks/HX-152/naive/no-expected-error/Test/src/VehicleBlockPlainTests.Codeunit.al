codeunit 80593 "CGR Vehicle Block Plain Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure RobotKeepsOpenContract()
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        VehicleBlocking: Codeunit "CGR Vehicle Blocking";
        ContractNo: Code[20];
    begin
        Lib.CreateVehicle('HX152-NP1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := Lib.CreateContract('HX152-NP1');
        Commit();

        asserterror VehicleBlocking.BlockVehicle('HX152-NP1', 'Brakes');

        Assert.IsTrue(Contract.Get(ContractNo), 'Open contract kept');
        Assert.AreEqual(Contract.Status::Open, Contract.Status, 'Contract still Open');
        Vehicle.Get('HX152-NP1');
        Assert.IsFalse(Vehicle.Blocked, 'Vehicle not blocked');
    end;

    [Test]
    procedure RentedOutVehicleNotBlocked()
    var
        Vehicle: Record "CGR Vehicle";
        VehicleBlocking: Codeunit "CGR Vehicle Blocking";
    begin
        Lib.CreateVehicle('HX152-NP2', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Vehicle.Get('HX152-NP2');
        Vehicle."Checked Out" := true;
        Vehicle.Modify();
        Commit();

        asserterror VehicleBlocking.BlockVehicle('HX152-NP2', 'Brakes');

        Vehicle.Get('HX152-NP2');
        Assert.IsFalse(Vehicle.Blocked, 'Rented-out vehicle not blocked');
    end;

    [Test]
    procedure FreeVehicleIsBlocked()
    var
        Vehicle: Record "CGR Vehicle";
        VehicleBlocking: Codeunit "CGR Vehicle Blocking";
    begin
        Lib.CreateVehicle('HX152-NP3', 1000, Enum::"CGR Maintenance Strategy"::Default);

        VehicleBlocking.BlockVehicle('HX152-NP3', 'Brakes');

        Vehicle.Get('HX152-NP3');
        Assert.IsTrue(Vehicle.Blocked, 'Vehicle blocked');
        Assert.AreEqual('Brakes', Vehicle."Block Reason", 'Reason stored');
    end;
}
