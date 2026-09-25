codeunit 85200 "HX003 Service Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        DueErr: Label 'Vehicle %1 is due for service.', Locked = true;

    [Test]
    procedure DefaultVehicleDueIsRefused()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Prepare();
        MakeVehicle('HX3-A', Enum::"CGR Maintenance Strategy"::Default, 10000, 25000);
        ContractNo := NewContract('HX3-A');
        asserterror RentalMgt.CheckOut(ContractNo);
        Assert.ExpectedError(StrSubstNo(DueErr, 'HX3-A'));
    end;

    [Test]
    procedure DefaultVehicleBelowIntervalRents()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Prepare();
        MakeVehicle('HX3-B', Enum::"CGR Maintenance Strategy"::Default, 10000, 24999);
        ContractNo := NewContract('HX3-B');
        RentalMgt.CheckOut(ContractNo);
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::"Checked Out", Contract.Status, 'A vehicle below its interval can be rented');
        Assert.AreEqual(24999, Contract."Start Km", 'Start km is the vehicle mileage');
    end;

    [Test]
    procedure HeavyDutyDueAtFiveThousand()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Prepare();
        MakeVehicle('HX3-C', Enum::"CGR Maintenance Strategy"::"Heavy Duty", 10000, 15000);
        ContractNo := NewContract('HX3-C');
        asserterror RentalMgt.CheckOut(ContractNo);
        Assert.ExpectedError(StrSubstNo(DueErr, 'HX3-C'));
    end;

    [Test]
    procedure HeavyDutyBelowIntervalRents()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Prepare();
        MakeVehicle('HX3-D', Enum::"CGR Maintenance Strategy"::"Heavy Duty", 10000, 14999);
        ContractNo := NewContract('HX3-D');
        RentalMgt.CheckOut(ContractNo);
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::"Checked Out", Contract.Status, 'A Heavy Duty vehicle below its interval can be rented');
    end;

    [Test]
    procedure ExtensionStrategyDueIsRefused()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Prepare();
        MakeVehicle('HX3-E', Enum::"CGR Maintenance Strategy"::"HX3 Short", 10000, 11000);
        ContractNo := NewContract('HX3-E');
        asserterror RentalMgt.CheckOut(ContractNo);
        Assert.ExpectedError(StrSubstNo(DueErr, 'HX3-E'));
    end;

    [Test]
    procedure ExtensionStrategyBelowIntervalRents()
    var
        Contract: Record "CGR Rental Contract";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Prepare();
        MakeVehicle('HX3-F', Enum::"CGR Maintenance Strategy"::"HX3 Short", 10000, 10999);
        ContractNo := NewContract('HX3-F');
        RentalMgt.CheckOut(ContractNo);
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::"Checked Out", Contract.Status, 'A vehicle below an extension strategy interval can be rented');
    end;

    [Test]
    procedure SwapToDueVehicleIsRefused()
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Prepare();
        MakeVehicle('HX3-G', Enum::"CGR Maintenance Strategy"::Default, 0, 1000);
        MakeVehicle('HX3-H', Enum::"CGR Maintenance Strategy"::Default, 0, 15000);
        ContractNo := NewContract('HX3-G');
        RentalMgt.CheckOut(ContractNo);
        asserterror RentalMgt.SwapVehicle(ContractNo, 'HX3-H');
        Assert.ExpectedError(StrSubstNo(DueErr, 'HX3-H'));
    end;

    [Test]
    procedure AvailabilityReportsDueVehicle()
    var
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        Prepare();
        MakeVehicle('HX3-I', Enum::"CGR Maintenance Strategy"::Default, 0, 15000);
        MakeVehicle('HX3-J', Enum::"CGR Maintenance Strategy"::Default, 0, 14999);
        Assert.IsFalse(FleetMgt.IsAvailable('HX3-I'), 'A vehicle due for service is not available');
        Assert.IsTrue(FleetMgt.IsAvailable('HX3-J'), 'A vehicle not yet due is available');
    end;

    [Test]
    procedure OverrideCannotReleaseDueVehicle()
    var
        Override: Codeunit "HX3 Availability Override";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Prepare();
        BindSubscription(Override);
        MakeVehicle('HX3-K', Enum::"CGR Maintenance Strategy"::Default, 0, 15000);
        ContractNo := NewContract('HX3-K');
        Assert.IsFalse(FleetMgt.IsAvailable('HX3-K'), 'An availability override cannot release a vehicle due for service');
        asserterror RentalMgt.CheckOut(ContractNo);
        Assert.ExpectedError(StrSubstNo(DueErr, 'HX3-K'));
        UnbindSubscription(Override);
    end;

    [Test]
    procedure SwapUnderOverrideRefused()
    var
        Override: Codeunit "HX3 Availability Override";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Prepare();
        BindSubscription(Override);
        MakeVehicle('HX3-M', Enum::"CGR Maintenance Strategy"::Default, 0, 1000);
        MakeVehicle('HX3-N', Enum::"CGR Maintenance Strategy"::Default, 0, 15000);
        ContractNo := NewContract('HX3-M');
        RentalMgt.CheckOut(ContractNo);
        asserterror RentalMgt.SwapVehicle(ContractNo, 'HX3-N');
        Assert.ExpectedError(StrSubstNo(DueErr, 'HX3-N'));
        UnbindSubscription(Override);
    end;

    [Test]
    procedure OverrideStillAppliesToVehiclesNotDue()
    var
        Contract: Record "CGR Rental Contract";
        Override: Codeunit "HX3 Availability Override";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
    begin
        Prepare();
        BindSubscription(Override);
        MakeVehicle('HX3-L', Enum::"CGR Maintenance Strategy"::Default, 0, 1000);
        SetBlocked('HX3-L');
        ContractNo := NewContract('HX3-L');
        Assert.IsTrue(FleetMgt.IsAvailable('HX3-L'), 'The override still decides for a vehicle that is not due');
        RentalMgt.CheckOut(ContractNo);
        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::"Checked Out", Contract.Status, 'Checkout follows the override for a vehicle that is not due');
        UnbindSubscription(Override);
    end;

    local procedure Prepare()
    var
        Setup: Record "CGR Setup";
    begin
        Setup.GetOrCreate();
        Setup."Suspend Rentals" := false;
        Setup.Modify();
    end;

    local procedure MakeVehicle(VehicleNo: Code[20]; Strategy: Enum "CGR Maintenance Strategy"; LastServiceKm: Integer; Mileage: Integer)
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        Contract: Record "CGR Rental Contract";
    begin
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.DeleteAll();
        Contract.SetRange("Vehicle No.", VehicleNo);
        Contract.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Strategy := Strategy;
        Vehicle."Last Service Km" := LastServiceKm;
        Vehicle.Mileage := Mileage;
        Vehicle.Blocked := false;
        Vehicle."Checked Out" := false;
        Vehicle.Insert();
    end;

    local procedure SetBlocked(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Get(VehicleNo);
        Vehicle.Blocked := true;
        Vehicle.Modify();
    end;

    local procedure NewContract(VehicleNo: Code[20]): Code[20]
    var
        RentalMgt: Codeunit "CGR Rental Mgt";
    begin
        exit(RentalMgt.CreateContract(VehicleNo, 'Oracle Customer', 20270301D, 20270303D));
    end;
}
