codeunit 86460 "HX050 Service Days Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        PlanCodeTok: Label 'HX050-P6', Locked = true;
        ZeroPlanCodeTok: Label 'HX050-P0', Locked = true;

    [Test]
    procedure DaysToPlannedServiceAhead()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
        Days: Integer;
    begin
        InitRun();
        VehicleWithPlannedDate('HX050-01A');

        Assert.IsTrue(ServicePlanMgt.DaysToPlannedService('HX050-01A', 20270701D, Days), 'A vehicle with a planned service date has one');
        Assert.AreEqual(9, Days, 'Nine days from 2027-07-01 to the planned date 2027-07-10');
    end;

    [Test]
    procedure NoPlanReturnsFalse()
    var
        Runner: Codeunit "HX050 Due Runner";
        Ok: Boolean;
    begin
        InitRun();
        VehicleWithoutPlan('HX050-02B');
        Runner.SetDaysCall('HX050-02B', 20270701D);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'DaysToPlannedService must not fail for a vehicle without a plan: ' + GetLastErrorText());
        Assert.IsFalse(Runner.Result(), 'A vehicle without a plan has no planned service date');
        Assert.AreEqual(0, Runner.Days(), 'Days is 0 without a planned service date');

        VehicleWithoutServiceDate('HX050-02C');
        Runner.SetDaysCall('HX050-02C', 20270701D);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'DaysToPlannedService must not fail for a vehicle without a last service date: ' + GetLastErrorText());
        Assert.IsFalse(Runner.Result(), 'A vehicle without a last service date has no planned service date');
        Assert.AreEqual(0, Runner.Days(), 'Days is 0 without a last service date');
    end;

    [Test]
    procedure OverdueServiceNegative()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
        Days: Integer;
    begin
        InitRun();
        VehicleWithPlannedDate('HX050-03A');

        Assert.IsTrue(ServicePlanMgt.DaysToPlannedService('HX050-03A', 20270731D, Days), 'A passed planned date is still a planned date');
        Assert.AreEqual(-21, Days, 'The planned date 2027-07-10 passed 21 days before 2027-07-31');
    end;

    [Test]
    procedure DueSoonOnWindowBoundary()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        InitRun();
        VehicleWithPlannedDate('HX050-04A');

        Assert.IsTrue(ServicePlanMgt.IsServiceDueSoon('HX050-04A', 20270626D, 14), 'A service exactly 14 days ahead is due soon in a 14-day window');
    end;

    [Test]
    procedure NotDueSoonOutsideWindow()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        InitRun();
        VehicleWithPlannedDate('HX050-05A');

        Assert.IsFalse(ServicePlanMgt.IsServiceDueSoon('HX050-05A', 20270625D, 14), 'A service 15 days ahead is not due soon in a 14-day window');
    end;

    [Test]
    procedure DueSoonWithoutPlanFalse()
    var
        Runner: Codeunit "HX050 Due Runner";
        Ok: Boolean;
    begin
        InitRun();
        VehicleWithoutPlan('HX050-06B');
        Runner.SetDueSoonCall('HX050-06B', 20270701D, 14);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'IsServiceDueSoon must not fail for a vehicle without a plan: ' + GetLastErrorText());
        Assert.IsFalse(Runner.Result(), 'A vehicle without a plan is never due soon');
    end;

    [Test]
    procedure DueSoonWithoutServiceDateFalse()
    var
        Runner: Codeunit "HX050 Due Runner";
        Ok: Boolean;
    begin
        InitRun();
        VehicleWithoutServiceDate('HX050-07C');
        Runner.SetDueSoonCall('HX050-07C', 20270701D, 14);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'IsServiceDueSoon must not fail for a vehicle without a last service date: ' + GetLastErrorText());
        Assert.IsFalse(Runner.Result(), 'A vehicle without a last service date has no planned service date');
    end;

    [Test]
    procedure OverdueIsDueSoon()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        InitRun();
        VehicleWithPlannedDate('HX050-08A');

        Assert.IsTrue(ServicePlanMgt.IsServiceDueSoon('HX050-08A', 20270801D, 14), 'An overdue service is due soon');
    end;

    [Test]
    procedure DueOnPlannedDate()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        InitRun();
        VehicleWithPlannedDate('HX050-09A');

        Assert.IsTrue(ServicePlanMgt.IsServiceDue('HX050-09A', 20270710D), 'Due on the planned date');
    end;

    [Test]
    procedure DueAfterPlannedDate()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        InitRun();
        VehicleWithPlannedDate('HX050-10A');

        Assert.IsTrue(ServicePlanMgt.IsServiceDue('HX050-10A', 20270801D), 'Due after the planned date');
    end;

    [Test]
    procedure NotDueBeforePlannedDate()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        InitRun();
        VehicleWithPlannedDate('HX050-11A');

        Assert.IsFalse(ServicePlanMgt.IsServiceDue('HX050-11A', 20270709D), 'Not due the day before the planned date');
    end;

    [Test]
    procedure NoPlanNotDue()
    var
        Runner: Codeunit "HX050 Due Runner";
        Ok: Boolean;
    begin
        InitRun();
        VehicleWithoutPlan('HX050-12B');
        Runner.SetDueCall('HX050-12B', 20270701D);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'IsServiceDue must not fail for a vehicle without a plan: ' + GetLastErrorText());
        Assert.IsFalse(Runner.Result(), 'A vehicle without a plan below its service km is not due');
    end;

    [Test]
    procedure DueByKmThroughStrategy()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        InitRun();
        NewVehicle('HX050-13D', 7000, Enum::"CGR Maintenance Strategy"::"Heavy Duty", '', 0D);

        Assert.IsTrue(ServicePlanMgt.IsServiceDue('HX050-13D', 20270301D), 'Heavy Duty is due at 1000 + 5000 km; the vehicle has 7000');
    end;

    [Test]
    procedure DueByKmWithPlannedDateAhead()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
        Days: Integer;
    begin
        InitRun();
        NewVehicle('HX050-14E', 7000, Enum::"CGR Maintenance Strategy"::"Heavy Duty", PlanCodeTok, 20270110D);

        Assert.IsTrue(ServicePlanMgt.DaysToPlannedService('HX050-14E', 20270701D, Days), 'Precondition: the vehicle has a planned service date');
        Assert.AreEqual(9, Days, 'Precondition: the planned service date is nine days ahead, so not due by date');
        Assert.IsTrue(ServicePlanMgt.IsServiceDue('HX050-14E', 20270701D), 'Heavy Duty is due at 1000 + 5000 km; the vehicle has 7000, whatever the plan date says');
    end;

    [Test]
    procedure ZeroIntervalPlanHasNoPlannedDate()
    var
        Runner: Codeunit "HX050 Due Runner";
        DueSoonRunner: Codeunit "HX050 Due Runner";
        Ok: Boolean;
    begin
        InitRun();
        NewVehicle('HX050-15F', 1000, Enum::"CGR Maintenance Strategy"::Default, ZeroPlanCodeTok, 20270110D);
        Runner.SetDaysCall('HX050-15F', 20270701D);
        DueSoonRunner.SetDueSoonCall('HX050-15F', 20270110D, 14);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'DaysToPlannedService must not fail for a plan without an interval: ' + GetLastErrorText());
        Assert.IsFalse(Runner.Result(), 'A plan with 0 interval months gives no planned service date');
        Assert.AreEqual(0, Runner.Days(), 'Days is 0 for a plan with 0 interval months');

        Commit();
        Ok := DueSoonRunner.Run();

        Assert.IsTrue(Ok, 'IsServiceDueSoon must not fail for a plan without an interval: ' + GetLastErrorText());
        Assert.IsFalse(DueSoonRunner.Result(), 'A plan with 0 interval months is never due soon, also on the last service date');
    end;

    [Test]
    procedure DueSoonZeroWindow()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        InitRun();
        VehicleWithPlannedDate('HX050-16A');

        Assert.IsTrue(ServicePlanMgt.IsServiceDueSoon('HX050-16A', 20270710D, 0), 'With a 0-day window the service is due soon on the planned date');
        Assert.IsFalse(ServicePlanMgt.IsServiceDueSoon('HX050-16A', 20270709D, 0), 'With a 0-day window a service one day ahead is not due soon');
    end;

    [Test]
    procedure DueSoonSevenDayWindowBoundary()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        InitRun();
        VehicleWithPlannedDate('HX050-17A');

        Assert.IsTrue(ServicePlanMgt.IsServiceDueSoon('HX050-17A', 20270703D, 7), 'A service exactly 7 days ahead is due soon in a 7-day window');
        Assert.IsFalse(ServicePlanMgt.IsServiceDueSoon('HX050-17A', 20270702D, 7), 'A service 8 days ahead is not due soon in a 7-day window');
    end;

    local procedure InitRun()
    var
        Setup: Record "CGR Setup";
        ServicePlan: Record "CGR Service Plan";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();

        if ServicePlan.Get(PlanCodeTok) then
            ServicePlan.Delete();
        ServicePlan.Init();
        ServicePlan.Code := PlanCodeTok;
        ServicePlan.Description := 'HX050 six months';
        ServicePlan.Strategy := Enum::"CGR Maintenance Strategy"::Default;
        ServicePlan."Interval Months" := 6;
        ServicePlan.Insert();

        if ServicePlan.Get(ZeroPlanCodeTok) then
            ServicePlan.Delete();
        ServicePlan.Init();
        ServicePlan.Code := ZeroPlanCodeTok;
        ServicePlan.Description := 'HX050 no interval';
        ServicePlan.Strategy := Enum::"CGR Maintenance Strategy"::Default;
        ServicePlan."Interval Months" := 0;
        ServicePlan.Insert();
    end;

    local procedure VehicleWithPlannedDate(VehicleNo: Code[20])
    begin
        // Planned service date 2027-07-10 (2027-01-10 + 6 months); km rule not due (1000 + 15000).
        NewVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default, PlanCodeTok, 20270110D);
    end;

    local procedure VehicleWithoutPlan(VehicleNo: Code[20])
    begin
        NewVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default, '', 0D);
    end;

    local procedure VehicleWithoutServiceDate(VehicleNo: Code[20])
    begin
        NewVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default, PlanCodeTok, 0D);
    end;

    local procedure NewVehicle(VehicleNo: Code[20]; Mileage: Integer; Strategy: Enum "CGR Maintenance Strategy"; PlanCode: Code[20]; LastServiceDate: Date)
    var
        Vehicle: Record "CGR Vehicle";
    begin
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := Mileage;
        Vehicle.Strategy := Strategy;
        Vehicle."Last Service Km" := 1000;
        Vehicle."Service Plan Code" := PlanCode;
        Vehicle."Last Service Date" := LastServiceDate;
        Vehicle.Insert();
    end;
}
