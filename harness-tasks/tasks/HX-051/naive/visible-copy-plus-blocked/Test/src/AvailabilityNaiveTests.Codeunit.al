codeunit 80103 "CGR Availability Naive Tests"
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
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('HX051-N01', 1000, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := Lib.CreateContract('HX051-N01');
        RentalMgt.CheckOut(ContractNo);
        Vehicle.Get('HX051-N01');
        Assert.IsTrue(Vehicle."Checked Out", 'Vehicle is checked out');
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::"Checked Out", Contract.Status, 'Contract status after checkout');
        Assert.AreEqual(1000, Contract."Start Km", 'Start km is the vehicle mileage at checkout');
    end;

    [Test]
    procedure CheckOutTwiceFails()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        FirstContractNo: Code[20];
        SecondContractNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('HX051-N02', 1000, Enum::"CGR Maintenance Strategy"::Default);
        FirstContractNo := Lib.CreateContract('HX051-N02');
        SecondContractNo := Lib.CreateContract('HX051-N02');
        RentalMgt.CheckOut(FirstContractNo);
        asserterror RentalMgt.CheckOut(SecondContractNo);
        Assert.ExpectedError('Vehicle HX051-N02 is not available.');
    end;

    [Test]
    procedure SuspendRentalsBlocksCheckout()
    var
        Setup: Record "CGR Setup";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('HX051-N03', 1000, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := Lib.CreateContract('HX051-N03');
        Setup.Get();
        Setup."Suspend Rentals" := true;
        Setup.Modify();
        asserterror RentalMgt.CheckOut(ContractNo);
        Assert.ExpectedError('Vehicle HX051-N03 is not available.');
    end;

    [Test]
    procedure BlockedVehicleIsNotAvailable()
    var
        Vehicle: Record "CGR Vehicle";
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('HX051-N04', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Vehicle.Get('HX051-N04');
        Vehicle.Blocked := true;
        Vehicle.Modify();
        Assert.IsFalse(FleetMgt.IsAvailable('HX051-N04'), 'A blocked vehicle is not available');
    end;
}
