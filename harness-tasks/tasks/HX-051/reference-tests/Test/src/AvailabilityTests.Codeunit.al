codeunit 80102 "CGR Availability Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure FreeVehicleIsAvailable()
    var
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        Initialize();
        Lib.CreateVehicle('HX051-V01', 1000, Enum::"CGR Maintenance Strategy"::Default);

        Assert.IsTrue(FleetMgt.IsAvailable('HX051-V01'), 'A free vehicle is available');
    end;

    [Test]
    procedure BlockedVehicleIsNotAvailable()
    var
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        Initialize();
        Lib.CreateVehicle('HX051-V02', 1000, Enum::"CGR Maintenance Strategy"::Default);
        SetVehicleState('HX051-V02', true, false);

        Assert.IsFalse(FleetMgt.IsAvailable('HX051-V02'), 'A blocked vehicle is not available');
    end;

    [Test]
    procedure CheckedOutVehicleIsNotAvailable()
    var
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        Initialize();
        Lib.CreateVehicle('HX051-V03', 1000, Enum::"CGR Maintenance Strategy"::Default);
        SetVehicleState('HX051-V03', false, true);

        Assert.IsFalse(FleetMgt.IsAvailable('HX051-V03'), 'A checked-out vehicle is not available');
    end;

    [Test]
    procedure UnknownVehicleIsNotAvailable()
    var
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        Initialize();
        RemoveVehicle('HX051-V04');

        Assert.IsFalse(FleetMgt.IsAvailable('HX051-V04'), 'A vehicle that does not exist is not available');
    end;

    [Test]
    procedure ExtensionLendsBlockedVehicle()
    var
        Rule: Codeunit "CGR Availability Rule";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        Available: Boolean;
    begin
        Initialize();
        Lib.CreateVehicle('HX051-V05', 1000, Enum::"CGR Maintenance Strategy"::Default);
        SetVehicleState('HX051-V05', true, false);
        Rule.SetRule('HX051-V05', true);
        BindSubscription(Rule);

        Available := FleetMgt.IsAvailable('HX051-V05');
        UnbindSubscription(Rule);
        Assert.IsTrue(Available, 'The extension''s answer wins for a blocked vehicle');
        Assert.AreEqual(1, Rule.HitCount(), 'The extension is asked once');
    end;

    [Test]
    procedure ExtensionLendsUnknownVehicle()
    var
        Rule: Codeunit "CGR Availability Rule";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        Available: Boolean;
    begin
        Initialize();
        RemoveVehicle('HX051-V06');
        Rule.SetRule('HX051-V06', true);
        BindSubscription(Rule);

        Available := FleetMgt.IsAvailable('HX051-V06');
        UnbindSubscription(Rule);
        Assert.IsTrue(Available, 'The extension''s answer wins for a vehicle that does not exist');
    end;

    [Test]
    procedure ExtensionLendsCheckedOutVehicle()
    var
        Rule: Codeunit "CGR Availability Rule";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        Available: Boolean;
    begin
        Initialize();
        Lib.CreateVehicle('HX051-V16', 1000, Enum::"CGR Maintenance Strategy"::Default);
        SetVehicleState('HX051-V16', false, true);
        Rule.SetRule('HX051-V16', true);
        BindSubscription(Rule);

        Available := FleetMgt.IsAvailable('HX051-V16');
        UnbindSubscription(Rule);
        Assert.IsTrue(Available, 'The extension''s answer wins for a checked-out vehicle');
    end;

    [Test]
    procedure ExtensionRefusesFreeVehicle()
    var
        Rule: Codeunit "CGR Availability Rule";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        Available: Boolean;
    begin
        Initialize();
        Lib.CreateVehicle('HX051-V07', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Rule.SetRule('HX051-V07', false);
        BindSubscription(Rule);

        Available := FleetMgt.IsAvailable('HX051-V07');
        UnbindSubscription(Rule);
        Assert.IsFalse(Available, 'The extension''s answer wins for a free vehicle');
    end;

    [Test]
    procedure ExtensionLetsBlockedVehicleCheckOut()
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
        Rule: Codeunit "CGR Availability Rule";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Initialize();
        Lib.CreateVehicle('HX051-V08', 4200, Enum::"CGR Maintenance Strategy"::Default);
        SetVehicleState('HX051-V08', true, false);
        ContractNo := Lib.CreateContract('HX051-V08');
        Rule.SetRule('HX051-V08', true);
        BindSubscription(Rule);

        RentalMgt.CheckOut(ContractNo);
        UnbindSubscription(Rule);
        Contract.Get(ContractNo);
        Assert.AreEqual(4200, Contract."Start Km", 'Start km is the mileage of the lent vehicle');
        Assert.AreEqual(Contract.Status::"Checked Out", Contract.Status, 'The contract is checked out');
        Vehicle.Get('HX051-V08');
        Assert.IsTrue(Vehicle."Checked Out", 'The lent vehicle is checked out');
    end;

    [Test]
    procedure StopMakesVehiclesUnavailable()
    var
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        Initialize();
        Lib.CreateVehicle('HX051-V09', 1000, Enum::"CGR Maintenance Strategy"::Default);
        SetSuspendRentals();

        Assert.IsFalse(FleetMgt.IsAvailable('HX051-V09'), 'No vehicle is available while rentals are suspended');
    end;

    [Test]
    procedure StopBlocksCheckout()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Initialize();
        Lib.CreateVehicle('HX051-V10', 1000, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := Lib.CreateContract('HX051-V10');
        SetSuspendRentals();

        asserterror RentalMgt.CheckOut(ContractNo);
        Assert.ExpectedError('Vehicle HX051-V10 is not available.');
    end;

    [Test]
    procedure CheckOutStartsTheRental()
    var
        Contract: Record "CGR Rental Contract";
        Vehicle: Record "CGR Vehicle";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Initialize();
        Lib.CreateVehicle('HX051-V12', 1500, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := Lib.CreateContract('HX051-V12');
        Contract.Get(ContractNo);
        Assert.AreEqual(0, Contract."Start Km", 'No start km before the checkout');
        Assert.AreEqual(Contract.Status::Open, Contract.Status, 'The contract is open before the checkout');
        Vehicle.Get('HX051-V12');
        Assert.IsFalse(Vehicle."Checked Out", 'The vehicle is not checked out before the checkout');

        RentalMgt.CheckOut(ContractNo);
        Contract.Get(ContractNo);
        Assert.AreEqual(1500, Contract."Start Km", 'Start km is the vehicle mileage');
        Assert.AreEqual(Contract.Status::"Checked Out", Contract.Status, 'The contract is checked out');
        Vehicle.Get('HX051-V12');
        Assert.IsTrue(Vehicle."Checked Out", 'The vehicle is checked out');
    end;

    [Test]
    procedure CheckOutOfReturnedContractFails()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Initialize();
        Lib.CreateVehicle('HX051-V13', 1000, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := Lib.CreateContract('HX051-V13');
        SetContractStatus(ContractNo, Enum::"CGR Rental Status"::Returned);

        asserterror RentalMgt.CheckOut(ContractNo);
        Assert.ExpectedError(StrSubstNo('Rental contract %1 must have status Open.', ContractNo));
    end;

    [Test]
    procedure CheckOutOfPostedContractFails()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Initialize();
        Lib.CreateVehicle('HX051-V14', 1000, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := Lib.CreateContract('HX051-V14');
        SetContractStatus(ContractNo, Enum::"CGR Rental Status"::Posted);

        asserterror RentalMgt.CheckOut(ContractNo);
        Assert.ExpectedError(StrSubstNo('Rental contract %1 must have status Open.', ContractNo));
    end;

    [Test]
    procedure CheckOutOfCheckedOutContractFails()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Initialize();
        Lib.CreateVehicle('HX051-V17', 1000, Enum::"CGR Maintenance Strategy"::Default);
        ContractNo := Lib.CreateContract('HX051-V17');
        SetContractStatus(ContractNo, Enum::"CGR Rental Status"::"Checked Out");

        asserterror RentalMgt.CheckOut(ContractNo);
        Assert.ExpectedError(StrSubstNo('Rental contract %1 must have status Open.', ContractNo));
    end;

    [Test]
    procedure CheckOutOfUnavailableVehicleFails()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Initialize();
        Lib.CreateVehicle('HX051-V15', 1000, Enum::"CGR Maintenance Strategy"::Default);
        SetVehicleState('HX051-V15', true, false);
        ContractNo := Lib.CreateContract('HX051-V15');

        asserterror RentalMgt.CheckOut(ContractNo);
        Assert.ExpectedError('Vehicle HX051-V15 is not available.');
    end;

    [Test]
    procedure NoSetupMeansNoStop()
    var
        Setup: Record "CGR Setup";
        Saved: Record "CGR Setup";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        Available: Boolean;
    begin
        Initialize();
        Lib.CreateVehicle('HX051-V11', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Setup.Get();
        Saved := Setup;
        Setup.Delete();

        Available := FleetMgt.IsAvailable('HX051-V11');
        Saved.Insert();
        Assert.IsTrue(Available, 'Without a CGR Setup record rentals are not suspended');
    end;

    local procedure Initialize()
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
    end;

    local procedure SetVehicleState(VehicleNo: Code[20]; NewBlocked: Boolean; NewCheckedOut: Boolean)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Get(VehicleNo);
        Vehicle.Blocked := NewBlocked;
        Vehicle."Checked Out" := NewCheckedOut;
        Vehicle.Modify();
    end;

    local procedure RemoveVehicle(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
    begin
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
    end;

    local procedure SetSuspendRentals()
    var
        Setup: Record "CGR Setup";
    begin
        Setup.Get();
        Setup."Suspend Rentals" := true;
        Setup.Modify();
    end;

    local procedure SetContractStatus(ContractNo: Code[20]; NewStatus: Enum "CGR Rental Status")
    var
        Contract: Record "CGR Rental Contract";
    begin
        Contract.Get(ContractNo);
        Contract.Status := NewStatus;
        Contract.Modify();
    end;
}
