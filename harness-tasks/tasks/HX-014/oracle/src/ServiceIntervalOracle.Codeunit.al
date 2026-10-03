codeunit 85740 "HX014 Service Interval Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure DefaultStrategyGetsTwelveMonths()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        WorkDate(20270301D);
        InitSetup();
        MakePlan('HX14-DEF', Enum::"CGR Maintenance Strategy"::Default, 0);
        MakeVehicle('HX014-A', Enum::"CGR Maintenance Strategy"::Default);
        ServicePlanMgt.AssignPlan('HX014-A', 'HX14-DEF');
        ServicePlanMgt.RegisterService('HX014-A', 20270301D, 1000);

        Assert.AreEqual(20280301D, ServicePlanMgt.NextServiceDate('HX014-A'), 'Default strategy: 12 months after the last service');
    end;

    [Test]
    procedure HeavyDutyGetsSixMonths()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        WorkDate(20270301D);
        InitSetup();
        MakePlan('HX14-HD', Enum::"CGR Maintenance Strategy"::"Heavy Duty", 0);
        MakeVehicle('HX014-B', Enum::"CGR Maintenance Strategy"::Default);
        ServicePlanMgt.AssignPlan('HX014-B', 'HX14-HD');
        ServicePlanMgt.RegisterService('HX014-B', 20270301D, 1000);

        Assert.AreEqual(20270901D, ServicePlanMgt.NextServiceDate('HX014-B'), 'Heavy Duty strategy: 6 months after the last service');
    end;

    [Test]
    procedure PartnerWithoutIntervalGetsTwelve()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        WorkDate(20270301D);
        InitSetup();
        MakePlan('HX14-OLD', Enum::"CGR Maintenance Strategy"::"HX014 Old Partner", 0);
        MakeVehicle('HX014-C', Enum::"CGR Maintenance Strategy"::Default);
        ServicePlanMgt.AssignPlan('HX014-C', 'HX14-OLD');
        ServicePlanMgt.RegisterService('HX014-C', 20270301D, 1000);

        Assert.AreEqual(20280301D, ServicePlanMgt.NextServiceDate('HX014-C'), 'A strategy of another app without its own interval gets 12 months');
    end;

    [Test]
    procedure PartnerIntervalIsUsed()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        WorkDate(20270301D);
        InitSetup();
        MakePlan('HX14-NEW', Enum::"CGR Maintenance Strategy"::"HX014 New Partner", 0);
        MakeVehicle('HX014-D', Enum::"CGR Maintenance Strategy"::Default);
        ServicePlanMgt.AssignPlan('HX014-D', 'HX14-NEW');
        ServicePlanMgt.RegisterService('HX014-D', 20270301D, 1000);

        Assert.AreEqual(20271201D, ServicePlanMgt.NextServiceDate('HX014-D'), 'A strategy of another app uses the interval it provides (9 months)');
    end;

    [Test]
    procedure PlanIntervalKeptWhenSet()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        WorkDate(20270301D);
        InitSetup();
        MakePlan('HX14-HD3', Enum::"CGR Maintenance Strategy"::"Heavy Duty", 3);
        MakeVehicle('HX014-E', Enum::"CGR Maintenance Strategy"::Default);
        ServicePlanMgt.AssignPlan('HX014-E', 'HX14-HD3');
        ServicePlanMgt.RegisterService('HX014-E', 20270301D, 1000);

        Assert.AreEqual(20270601D, ServicePlanMgt.NextServiceDate('HX014-E'), 'A plan interval above 0 is kept');
    end;

    [Test]
    procedure PlanStrategyDecidesNotVehicle()
    var
        Vehicle: Record "CGR Vehicle";
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        WorkDate(20270301D);
        InitSetup();
        MakePlan('HX14-DV', Enum::"CGR Maintenance Strategy"::Default, 0);
        MakeVehicle('HX014-F', Enum::"CGR Maintenance Strategy"::Default);
        ServicePlanMgt.AssignPlan('HX014-F', 'HX14-DV');
        Vehicle.Get('HX014-F');
        Vehicle.Strategy := Enum::"CGR Maintenance Strategy"::"Heavy Duty";
        Vehicle.Modify();
        ServicePlanMgt.RegisterService('HX014-F', 20270301D, 1000);

        Assert.AreEqual(20280301D, ServicePlanMgt.NextServiceDate('HX014-F'), 'The strategy of the plan decides the default interval, not the vehicle strategy');
    end;

    [Test]
    procedure DueOnDefaultIntervalBoundary()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        WorkDate(20270301D);
        InitSetup();
        MakePlan('HX14-DB', Enum::"CGR Maintenance Strategy"::Default, 0);
        MakeVehicle('HX014-G', Enum::"CGR Maintenance Strategy"::Default);
        ServicePlanMgt.AssignPlan('HX014-G', 'HX14-DB');
        ServicePlanMgt.RegisterService('HX014-G', 20270301D, 1000);

        Assert.IsFalse(ServicePlanMgt.IsServiceDue('HX014-G', 20280229D), 'Not due the day before the default interval ends');
        Assert.IsTrue(ServicePlanMgt.IsServiceDue('HX014-G', 20280301D), 'Due on the date the default interval ends');
    end;

    [Test]
    procedure NoPlanOrNoServiceNoDate()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        WorkDate(20270301D);
        InitSetup();
        MakePlan('HX14-NS', Enum::"CGR Maintenance Strategy"::Default, 0);
        MakeVehicle('HX014-H', Enum::"CGR Maintenance Strategy"::Default);
        ServicePlanMgt.AssignPlan('HX014-H', 'HX14-NS');
        MakeVehicle('HX014-I', Enum::"CGR Maintenance Strategy"::Default);
        ServicePlanMgt.RegisterService('HX014-I', 20270301D, 1000);

        Assert.AreEqual(0D, ServicePlanMgt.NextServiceDate('HX014-H'), 'No last service date, no next service date');
        Assert.AreEqual(0D, ServicePlanMgt.NextServiceDate('HX014-I'), 'No service plan, no next service date');
    end;

    local procedure InitSetup()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        Setup.GetOrCreate();
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();
    end;

    local procedure MakePlan(PlanCode: Code[20]; Strategy: Enum "CGR Maintenance Strategy"; IntervalMonths: Integer)
    var
        ServicePlan: Record "CGR Service Plan";
    begin
        if ServicePlan.Get(PlanCode) then
            ServicePlan.Delete();
        ServicePlan.Init();
        ServicePlan.Code := PlanCode;
        ServicePlan.Description := 'Oracle plan';
        ServicePlan.Strategy := Strategy;
        ServicePlan."Interval Months" := IntervalMonths;
        ServicePlan.Insert();
    end;

    local procedure MakeVehicle(VehicleNo: Code[20]; Strategy: Enum "CGR Maintenance Strategy")
    var
        Vehicle: Record "CGR Vehicle";
    begin
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 1000;
        Vehicle.Strategy := Strategy;
        Vehicle.Insert();
    end;
}
