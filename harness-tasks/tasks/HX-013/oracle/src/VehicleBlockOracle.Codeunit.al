codeunit 85720 "HX013 Vehicle Block Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure ServiceOnDamagedVehicleKeepsBlock()
    var
        DamageMgt: Codeunit "CGR Damage Mgt";
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        WorkDate(20310301D);
        InitHX13Setup();
        NewHX13Vehicle('HX013-A', 1000, Enum::"CGR Maintenance Strategy"::Default, 0);
        DamageMgt.RegisterDamage('HX013-A', 'Dent');

        ServicePlanMgt.RegisterService('HX013-A', 20310301D, 1000);
        AssertVehicleBlocked('HX013-A', true, 'A service does not release a vehicle with an open damage');
        Assert.IsFalse(FleetMgt.IsAvailable('HX013-A'), 'A damaged vehicle stays unavailable after a service');
    end;

    [Test]
    procedure ServiceReleasesUndamagedDueVehicle()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        WorkDate(20310301D);
        InitHX13Setup();
        NewHX13Vehicle('HX013-B', 15000, Enum::"CGR Maintenance Strategy"::Default, 0);
        BlockVehicleForService('HX013-B');

        ServicePlanMgt.RegisterService('HX013-B', 20310301D, 15000);
        AssertVehicleBlocked('HX013-B', false, 'A service that covers the interval releases an undamaged vehicle');
        Assert.IsTrue(FleetMgt.IsAvailable('HX013-B'), 'The serviced vehicle is available again');
    end;

    [Test]
    procedure RepairKeepsKmDueVehicleBlocked()
    var
        DamageMgt: Codeunit "CGR Damage Mgt";
        EntryNo: Integer;
    begin
        WorkDate(20310301D);
        InitHX13Setup();
        NewHX13Vehicle('HX013-C', 20000, Enum::"CGR Maintenance Strategy"::Default, 5000);
        EntryNo := DamageMgt.RegisterDamage('HX013-C', 'Dent');

        DamageMgt.RepairDamage(EntryNo);
        AssertVehicleBlocked('HX013-C', true, 'A vehicle at its service km stays blocked after the last repair');
    end;

    [Test]
    procedure RepairKeepsHeavyDutyDueBlocked()
    var
        DamageMgt: Codeunit "CGR Damage Mgt";
        EntryNo: Integer;
    begin
        WorkDate(20310301D);
        InitHX13Setup();
        NewHX13Vehicle('HX013-D', 15000, Enum::"CGR Maintenance Strategy"::"Heavy Duty", 10000);
        EntryNo := DamageMgt.RegisterDamage('HX013-D', 'Dent');

        DamageMgt.RepairDamage(EntryNo);
        AssertVehicleBlocked('HX013-D', true, 'A Heavy Duty vehicle 5000 km after its service is due and stays blocked');
    end;

    [Test]
    procedure RepairReleasesHeavyDutyBelowInterval()
    var
        DamageMgt: Codeunit "CGR Damage Mgt";
        EntryNo: Integer;
    begin
        WorkDate(20310301D);
        InitHX13Setup();
        NewHX13Vehicle('HX013-E', 14999, Enum::"CGR Maintenance Strategy"::"Heavy Duty", 10000);
        EntryNo := DamageMgt.RegisterDamage('HX013-E', 'Dent');

        DamageMgt.RepairDamage(EntryNo);
        AssertVehicleBlocked('HX013-E', false, 'A Heavy Duty vehicle one km before its service km is released');
    end;

    [Test]
    procedure RepairKeepsPlanDateDueBlocked()
    var
        DamageMgt: Codeunit "CGR Damage Mgt";
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
        EntryNo: Integer;
    begin
        WorkDate(20310301D);
        InitHX13Setup();
        NewHX13Plan('HX013-P6F');
        NewHX13Vehicle('HX013-F', 1000, Enum::"CGR Maintenance Strategy"::Default, 0);
        ServicePlanMgt.AssignPlan('HX013-F', 'HX013-P6F');
        ServicePlanMgt.RegisterService('HX013-F', 20300901D, 1000);
        EntryNo := DamageMgt.RegisterDamage('HX013-F', 'Dent');

        DamageMgt.RepairDamage(EntryNo);
        AssertVehicleBlocked('HX013-F', true, 'A vehicle whose plan date is the work date stays blocked after the last repair');
    end;

    [Test]
    procedure RepairReleasesDayBeforePlanDate()
    var
        DamageMgt: Codeunit "CGR Damage Mgt";
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
        EntryNo: Integer;
    begin
        WorkDate(20250630D);
        InitHX13Setup();
        NewHX13Plan('HX013-P6G');
        NewHX13Vehicle('HX013-G', 1000, Enum::"CGR Maintenance Strategy"::Default, 0);
        ServicePlanMgt.AssignPlan('HX013-G', 'HX013-P6G');
        ServicePlanMgt.RegisterService('HX013-G', 20250101D, 1000);
        EntryNo := DamageMgt.RegisterDamage('HX013-G', 'Dent');

        DamageMgt.RepairDamage(EntryNo);
        AssertVehicleBlocked('HX013-G', false, 'A vehicle the day before its plan date is released after the last repair');
    end;

    [Test]
    procedure LateServiceStillDueStaysBlocked()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        WorkDate(20310301D);
        InitHX13Setup();
        NewHX13Vehicle('HX013-H', 19500, Enum::"CGR Maintenance Strategy"::"Heavy Duty", 0);
        BlockVehicleForService('HX013-H');

        ServicePlanMgt.RegisterService('HX013-H', 20310301D, 14000);
        AssertVehicleBlocked('HX013-H', true, 'A service at 14000 km leaves a Heavy Duty vehicle at 19500 km due');
        Assert.IsFalse(FleetMgt.IsAvailable('HX013-H'), 'A vehicle still due for service stays unavailable');
    end;

    [Test]
    procedure RepairWithOtherDamageOpenStaysBlocked()
    var
        Vehicle: Record "CGR Vehicle";
        DamageMgt: Codeunit "CGR Damage Mgt";
        FirstEntryNo: Integer;
    begin
        WorkDate(20310301D);
        InitHX13Setup();
        NewHX13Vehicle('HX013-I', 1000, Enum::"CGR Maintenance Strategy"::Default, 0);
        FirstEntryNo := DamageMgt.RegisterDamage('HX013-I', 'Dent');
        DamageMgt.RegisterDamage('HX013-I', 'Scratch');

        DamageMgt.RepairDamage(FirstEntryNo);
        Vehicle.Get('HX013-I');
        Assert.AreEqual(1, Vehicle."Open Damages", 'One damage is still open');
        Assert.IsTrue(Vehicle.Blocked, 'A vehicle with an open damage stays blocked');
    end;

    [Test]
    procedure RepairedDueVehicleCannotBeCheckedOut()
    var
        DamageMgt: Codeunit "CGR Damage Mgt";
        RentalMgt: Codeunit "CGR Rental Mgt";
        ContractNo: Code[20];
        EntryNo: Integer;
    begin
        WorkDate(20310301D);
        InitHX13Setup();
        NewHX13Vehicle('HX013-J', 20000, Enum::"CGR Maintenance Strategy"::Default, 5000);
        ContractNo := RentalMgt.CreateContract('HX013-J', 'HX013 Customer', 20310303D, 20310305D);
        EntryNo := DamageMgt.RegisterDamage('HX013-J', 'Dent');
        DamageMgt.RepairDamage(EntryNo);

        asserterror RentalMgt.CheckOut(ContractNo);
        Assert.ExpectedError('Vehicle HX013-J is not available.');
    end;

    [Test]
    procedure ServiceThenRepairReleases()
    var
        DamageMgt: Codeunit "CGR Damage Mgt";
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        EntryNo: Integer;
    begin
        WorkDate(20310301D);
        InitHX13Setup();
        NewHX13Vehicle('HX013-K', 20000, Enum::"CGR Maintenance Strategy"::Default, 5000);
        EntryNo := DamageMgt.RegisterDamage('HX013-K', 'Dent');
        ServicePlanMgt.RegisterService('HX013-K', 20310301D, 20000);

        DamageMgt.RepairDamage(EntryNo);
        AssertVehicleBlocked('HX013-K', false, 'Serviced and repaired: no reason remains, the vehicle is released');
        Assert.IsTrue(FleetMgt.IsAvailable('HX013-K'), 'The serviced and repaired vehicle is available');
    end;

    [Test]
    procedure LateServiceByDateStaysBlocked()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        WorkDate(20310301D);
        InitHX13Setup();
        NewHX13Plan('HX013-P6L');
        NewHX13Vehicle('HX013-L', 1000, Enum::"CGR Maintenance Strategy"::Default, 0);
        ServicePlanMgt.AssignPlan('HX013-L', 'HX013-P6L');
        ServicePlanMgt.RegisterService('HX013-L', 20300901D, 1000);
        BlockVehicleForService('HX013-L');

        ServicePlanMgt.RegisterService('HX013-L', 20300820D, 1000);
        AssertVehicleBlocked('HX013-L', true, 'A service dated 2030-08-20 makes the plan date 2031-02-20, still due on the work date');
        Assert.IsFalse(FleetMgt.IsAvailable('HX013-L'), 'A vehicle still due by its plan date stays unavailable');
    end;

    local procedure InitHX13Setup()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        Setup.GetOrCreate();
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();
    end;

    local procedure NewHX13Vehicle(VehicleNo: Code[20]; Mileage: Integer; Strategy: Enum "CGR Maintenance Strategy"; LastServiceKm: Integer)
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
        Vehicle.Mileage := Mileage;
        Vehicle.Strategy := Strategy;
        Vehicle."Last Service Km" := LastServiceKm;
        Vehicle.Insert();
    end;

    local procedure NewHX13Plan(PlanCode: Code[20])
    var
        ServicePlan: Record "CGR Service Plan";
    begin
        if ServicePlan.Get(PlanCode) then
            ServicePlan.Delete();
        ServicePlan.Init();
        ServicePlan.Code := PlanCode;
        ServicePlan.Description := 'HX013 six months';
        ServicePlan.Strategy := Enum::"CGR Maintenance Strategy"::Default;
        ServicePlan."Interval Months" := 6;
        ServicePlan.Insert();
    end;

    local procedure BlockVehicleForService(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
        ServiceBlockMgt: Codeunit "CGR Service Block Mgt";
    begin
        Vehicle.SetRange("No.", VehicleNo);
        ServiceBlockMgt.BlockDueVehicles(Vehicle, WorkDate());
        AssertVehicleBlocked(VehicleNo, true, 'Arrange: the workshop blocks the due vehicle');
    end;

    local procedure AssertVehicleBlocked(VehicleNo: Code[20]; Expected: Boolean; Msg: Text)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Vehicle.Get(VehicleNo);
        Assert.AreEqual(Expected, Vehicle.Blocked, Msg);
    end;
}
