codeunit 80010 "CGR Rental Tests"
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
        Lib.CreateVehicle('T-RENT-001', 1000, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := Lib.CreateContract('T-RENT-001');
        RentalMgt.CheckOut(ContractNo);
        Vehicle.Get('T-RENT-001');
        Assert.IsTrue(Vehicle."Checked Out", 'Fleet subscriber must mark the vehicle checked out');
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
        Lib.CreateVehicle('T-RENT-002', 1000, Enum::"CGR Maintenance Strategy"::Default);
        FirstContractNo := Lib.CreateContract('T-RENT-002');
        SecondContractNo := Lib.CreateContract('T-RENT-002');
        RentalMgt.CheckOut(FirstContractNo);
        asserterror RentalMgt.CheckOut(SecondContractNo);
        Assert.ExpectedError('Vehicle T-RENT-002 is not available.');
    end;

    [Test]
    procedure ReturnWithoutDamageReleasesVehicle()
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Lib.CreateVehicle('T-RENT-003', 1000, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := Lib.CreateContract('T-RENT-003');
        RentalMgt.CheckOut(ContractNo);
        RentalMgt.Return(ContractNo, 1300, '');
        Vehicle.Get('T-RENT-003');
        Assert.IsFalse(Vehicle."Checked Out", 'Returned vehicle is no longer checked out');
        Assert.AreEqual(1300, Vehicle.Mileage, 'Mileage is the return km');
        Assert.IsFalse(Vehicle.Blocked, 'Return without damage does not block');
        Assert.AreEqual(0, Vehicle."Open Damages", 'Return without damage leaves no open damage');
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'Contract status after return');
        Assert.AreEqual(1300, Contract."Return Km", 'Contract return km');
    end;

    [Test]
    procedure ReturnBelowStartKmFails()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Lib.CreateVehicle('T-RENT-004', 1000, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := Lib.CreateContract('T-RENT-004');
        RentalMgt.CheckOut(ContractNo);
        asserterror RentalMgt.Return(ContractNo, 999, '');
        Assert.ExpectedError('Return km 999 is below the start km 1000.');
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::"Checked Out", Contract.Status, 'Failed return keeps the contract checked out');
    end;
}
