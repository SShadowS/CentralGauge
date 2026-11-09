codeunit 80590 "CGR Vehicle Blocking Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure RobotCannotBlockVehicleWithOpenContract()
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        VehicleBlocking: Codeunit "CGR Vehicle Blocking";
        ContractNo: Code[20];
    begin
        HX152Prepare();
        Lib.CreateVehicle('HX152-R1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := Lib.CreateContract('HX152-R1');
        Commit();

        asserterror VehicleBlocking.BlockVehicle('HX152-R1', 'Brakes');

        Assert.ExpectedError('Vehicle HX152-R1 has open contracts. Block it from the vehicle card.');
        Assert.IsTrue(Contract.Get(ContractNo), 'Without a user interface the open contract is kept');
        Assert.AreEqual(Contract.Status::Open, Contract.Status, 'The open contract stays Open');
        Vehicle.Get('HX152-R1');
        Assert.IsFalse(Vehicle.Blocked, 'The vehicle is not blocked');
        Assert.AreEqual('', Vehicle."Block Reason", 'No block reason is stored');
    end;

    [Test]
    procedure CheckedOutVehicleCannotBeBlocked()
    var
        Vehicle: Record "CGR Vehicle";
        VehicleBlocking: Codeunit "CGR Vehicle Blocking";
    begin
        HX152Prepare();
        Lib.CreateVehicle('HX152-C1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Vehicle.Get('HX152-C1');
        Vehicle."Checked Out" := true;
        Vehicle.Modify();
        Commit();

        asserterror VehicleBlocking.BlockVehicle('HX152-C1', 'Brakes');

        Assert.ExpectedError('Vehicle HX152-C1 is rented out.');
        Vehicle.Get('HX152-C1');
        Assert.IsFalse(Vehicle.Blocked, 'A checked-out vehicle is not blocked');
    end;

    [Test]
    procedure VehicleWithoutOpenContractsIsBlocked()
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        Runner: Codeunit "CGR Vehicle Blocking Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        HX152Prepare();
        Lib.CreateVehicle('HX152-B1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := Lib.CreateContract('HX152-B1');
        Contract.Get(ContractNo);
        Contract.Status := Contract.Status::Returned;
        Contract.Modify();
        Runner.SetBlockRun('HX152-B1', 'Brakes');
        Commit();

        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'A vehicle without open contracts is blocked: ' + GetLastErrorText());
        Vehicle.Get('HX152-B1');
        Assert.IsTrue(Vehicle.Blocked, 'The vehicle is blocked');
        Assert.AreEqual('Brakes', Vehicle."Block Reason", 'The block reason is stored');
        Assert.IsTrue(Contract.Get(ContractNo), 'The returned contract is kept');
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'The returned contract is unchanged');
    end;

    [Test]
    procedure PartnerRefusalChangesNothing()
    var
        Vehicle: Record "CGR Vehicle";
        PartnerSpy: Codeunit "CGR Block Partner Spy";
        VehicleBlocking: Codeunit "CGR Vehicle Blocking";
    begin
        HX152Prepare();
        Lib.CreateVehicle('HX152-P1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Commit();
        BindSubscription(PartnerSpy);

        asserterror VehicleBlocking.BlockVehicle('HX152-P1', 'Brakes');

        UnbindSubscription(PartnerSpy);
        Assert.ExpectedError('Fleet partner refused vehicle HX152-P1.');
        Vehicle.Get('HX152-P1');
        Assert.IsFalse(Vehicle.Blocked, 'A refused block changes nothing');
        Assert.AreEqual('', Vehicle."Block Reason", 'A refused block stores no reason');
    end;

    local procedure HX152Prepare()
    begin
        WorkDate(20250415D);
        Lib.SetPricing(0, 100, 0.35);
    end;
}
