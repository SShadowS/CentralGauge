codeunit 80084 "CGR Rental Desk Naive Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure ReturnReleasesDeskVehicle()
    var
        Vehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Lib.SetPricing(0, 1000, 0);
        ContractNo := CheckedOutContract('HX041-N01', 1000);
        RentalMgt.Return(ContractNo, 1300, '');
        Vehicle.Get('HX041-N01');
        Assert.IsFalse(Vehicle."Checked Out", 'Returned vehicle is no longer checked out');
        Assert.AreEqual(1300, Vehicle.Mileage, 'Mileage is the return km');
        Assert.IsFalse(Vehicle.Blocked, 'Return without damage does not block');
        Assert.AreEqual(0, Vehicle."Open Damages", 'Return without damage leaves no open damage');
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'Contract status after return');
        Assert.AreEqual(1300, Contract."Return Km", 'Contract return km');
    end;

    [Test]
    procedure ReturnBelowDeskStartKmFails()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Lib.SetPricing(0, 1000, 0);
        ContractNo := CheckedOutContract('HX041-N02', 1000);
        asserterror RentalMgt.Return(ContractNo, 999, '');
        Assert.ExpectedError('Return km 999 is below the start km 1000.');
    end;

    [Test]
    procedure SwapMovesDeskContractToFreeVehicle()
    var
        OldVehicle: Record "CGR Vehicle";
        NewVehicle: Record "CGR Vehicle";
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Lib.SetPricing(0, 1000, 0);
        ContractNo := CheckedOutContract('HX041-N03', 1000);
        Lib.CreateVehicle('HX041-N04', 2500, Enum::"CGR Maintenance Strategy"::Default);
        RentalMgt.SwapVehicle(ContractNo, 'HX041-N04');
        Contract.Get(ContractNo);
        Assert.AreEqual('HX041-N04', Contract."Vehicle No.", 'Contract moves to the new vehicle');
        Assert.AreEqual(2500, Contract."Start Km", 'Start km is the new vehicle mileage');
        OldVehicle.Get('HX041-N03');
        Assert.IsFalse(OldVehicle."Checked Out", 'The old vehicle is released');
        NewVehicle.Get('HX041-N04');
        Assert.IsTrue(NewVehicle."Checked Out", 'The new vehicle is checked out');
    end;

    [Test]
    procedure SwapOntoBlockedDeskVehicleFails()
    var
        DamageMgt: Codeunit "CGR Damage Mgt";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Lib.SetPricing(0, 1000, 0);
        ContractNo := CheckedOutContract('HX041-N05', 1000);
        Lib.CreateVehicle('HX041-N06', 3000, Enum::"CGR Maintenance Strategy"::Default);
        DamageMgt.RegisterDamage('HX041-N06', 'Dent');
        asserterror RentalMgt.SwapVehicle(ContractNo, 'HX041-N06');
        Assert.ExpectedError('Vehicle HX041-N06 is not available.');
    end;

    [Test]
    procedure SwapOntoRentedDeskVehicleFails()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Lib.SetPricing(0, 1000, 0);
        ContractNo := CheckedOutContract('HX041-N07', 1000);
        CheckedOutContract('HX041-N08', 4000);
        asserterror RentalMgt.SwapVehicle(ContractNo, 'HX041-N08');
        Assert.ExpectedError('Vehicle HX041-N08 is not available.');
    end;

    [Test]
    procedure SwapOfOpenDeskContractFails()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Lib.SetPricing(0, 1000, 0);
        Lib.CreateVehicle('HX041-N09', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.CreateVehicle('HX041-N10', 1500, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := Lib.CreateContract('HX041-N09');
        asserterror RentalMgt.SwapVehicle(ContractNo, 'HX041-N10');
        Assert.ExpectedError(StrSubstNo('Rental contract %1 must have status %2.', ContractNo, Enum::"CGR Rental Status"::"Checked Out"));
    end;

    [Test]
    procedure ReturnWithDamageKeepsDeskDescription()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Lib.SetPricing(0, 1000, 0);
        ContractNo := CheckedOutContract('HX041-N11', 1000);
        RentalMgt.Return(ContractNo, 1250, 'Cracked windscreen');
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Returned, Contract.Status, 'Contract status after return');
        Assert.AreEqual(1250, Contract."Return Km", 'Contract return km');
        Assert.AreEqual('Cracked windscreen', Contract."Damage Description", 'Contract damage description');
    end;

    local procedure CheckedOutContract(VehicleNo: Code[20]; Mileage: Integer) ContractNo: Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        Lib.CreateVehicle(VehicleNo, Mileage, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := Lib.CreateContract(VehicleNo);
        RentalMgt.CheckOut(ContractNo);
    end;
}
