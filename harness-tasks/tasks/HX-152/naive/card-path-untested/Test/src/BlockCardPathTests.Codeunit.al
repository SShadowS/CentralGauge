codeunit 80596 "CGR Block Card Path Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure RentedOutVehicleRefused()
    var
        Vehicle: Record "CGR Vehicle";
        VehicleBlocking: Codeunit "CGR Vehicle Blocking";
    begin
        Lib.CreateVehicle('HX152-NC1', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Vehicle.Get('HX152-NC1');
        Vehicle."Checked Out" := true;
        Vehicle.Modify();
        Commit();

        asserterror VehicleBlocking.BlockVehicle('HX152-NC1', 'Brakes');

        Assert.ExpectedError('Vehicle HX152-NC1 is rented out.');
        Vehicle.Get('HX152-NC1');
        Assert.IsFalse(Vehicle.Blocked, 'Vehicle not blocked');
    end;

    [Test]
    procedure VehicleWithReturnedContractIsBlocked()
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        Runner: Codeunit "CGR Block Card Path Runner";
        ContractNo: Code[20];
    begin
        Lib.CreateVehicle('HX152-NC2', 1000, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := Lib.CreateContract('HX152-NC2');
        Contract.Get(ContractNo);
        Contract.Status := Contract.Status::Returned;
        Contract.Modify();
        Runner.SetVehicle('HX152-NC2');
        Commit();

        Assert.IsTrue(Runner.Run(), 'Block succeeds: ' + GetLastErrorText());

        Vehicle.Get('HX152-NC2');
        Assert.IsTrue(Vehicle.Blocked, 'Vehicle blocked');
        Assert.AreEqual('Brakes', Vehicle."Block Reason", 'Reason stored');
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'Returned contract unchanged');
    end;

    [Test]
    procedure PartnerRefusalKeepsVehicleFree()
    var
        Vehicle: Record "CGR Vehicle";
        PartnerSpy: Codeunit "CGR Block Card Path Spy";
        VehicleBlocking: Codeunit "CGR Vehicle Blocking";
    begin
        Lib.CreateVehicle('HX152-NC3', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Commit();
        BindSubscription(PartnerSpy);

        asserterror VehicleBlocking.BlockVehicle('HX152-NC3', 'Brakes');

        UnbindSubscription(PartnerSpy);
        Assert.ExpectedError('Partner blocked request for HX152-NC3.');
        Vehicle.Get('HX152-NC3');
        Assert.IsFalse(Vehicle.Blocked, 'Vehicle not blocked');
    end;
}
