codeunit 88540 "HX172 Plan Code Change Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure VehiclesFollowNewCode()
    var
        Vehicle: Record "CGR Vehicle";
        ServicePlan: Record "CGR Service Plan";
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        InitRun();
        ClearPlan('HX172-1N');
        NewPlan('HX172-1O', Enum::"CGR Maintenance Strategy"::Default, 12, 'HX172 plan one');
        NewVehicle('HX172-1A', 'HX172-1O', Enum::"CGR Maintenance Strategy"::Default);
        NewVehicle('HX172-1B', 'HX172-1O', Enum::"CGR Maintenance Strategy"::Default);

        ServicePlanMgt.ChangePlanCode('HX172-1O', 'HX172-1N');

        Assert.IsFalse(ServicePlan.Get('HX172-1O'), 'The old code is no longer a plan');
        Assert.IsTrue(ServicePlan.Get('HX172-1N'), 'The plan exists under the new code');
        Vehicle.Get('HX172-1A');
        Assert.AreEqual('HX172-1N', Vehicle."Service Plan Code", 'The first vehicle on the plan carries the new code');
        Vehicle.Get('HX172-1B');
        Assert.AreEqual('HX172-1N', Vehicle."Service Plan Code", 'The second vehicle on the plan carries the new code');
        Vehicle.Reset();
        Vehicle.SetRange("Service Plan Code", 'HX172-1O');
        Assert.AreEqual(0, Vehicle.Count(), 'No vehicle is left on the old code');
    end;

    [Test]
    procedure VisitsFollowNewCode()
    var
        ServiceVisit: Record "CGR Service Visit";
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
        FirstVisit: Integer;
        SecondVisit: Integer;
        MovedVisit: Integer;
    begin
        InitRun();
        ClearPlan('HX172-2N');
        NewPlan('HX172-2O', Enum::"CGR Maintenance Strategy"::Default, 12, 'HX172 plan two');
        NewPlan('HX172-2X', Enum::"CGR Maintenance Strategy"::Default, 6, 'HX172 plan two other');
        NewVehicle('HX172-2A', 'HX172-2O', Enum::"CGR Maintenance Strategy"::Default);
        NewVehicle('HX172-2B', 'HX172-2X', Enum::"CGR Maintenance Strategy"::Default);
        FirstVisit := InsertVisit('HX172-2A', 'HX172-2O', 20260310D, 15000);
        SecondVisit := InsertVisit('HX172-2A', 'HX172-2O', 20260915D, 30000);
        MovedVisit := InsertVisit('HX172-2B', 'HX172-2O', 20260520D, 22000);

        ServicePlanMgt.ChangePlanCode('HX172-2O', 'HX172-2N');

        ServiceVisit.Get(FirstVisit);
        Assert.AreEqual('HX172-2N', ServiceVisit."Service Plan Code", 'The first visit under the plan shows the new code');
        ServiceVisit.Get(SecondVisit);
        Assert.AreEqual('HX172-2N', ServiceVisit."Service Plan Code", 'The second visit under the plan shows the new code');
        ServiceVisit.Get(MovedVisit);
        Assert.AreEqual('HX172-2N', ServiceVisit."Service Plan Code", 'A visit under the plan of a vehicle now on another plan shows the new code');
        ServiceVisit.Reset();
        ServiceVisit.SetRange("Service Plan Code", 'HX172-2O');
        Assert.AreEqual(0, ServiceVisit.Count(), 'No visit is left under the old code');
    end;

    [Test]
    procedure PlanKeepsItsData()
    var
        ServicePlan: Record "CGR Service Plan";
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        InitRun();
        ClearPlan('HX172-3N');
        NewPlan('HX172-3O', Enum::"CGR Maintenance Strategy"::"Heavy Duty", 9, 'HX172 heavy van plan');

        ServicePlanMgt.ChangePlanCode('HX172-3O', 'HX172-3N');

        ServicePlan.Get('HX172-3N');
        Assert.AreEqual('HX172 heavy van plan', ServicePlan.Description, 'The description is kept');
        Assert.AreEqual(Enum::"CGR Maintenance Strategy"::"Heavy Duty", ServicePlan.Strategy, 'The maintenance strategy is kept');
        Assert.AreEqual(9, ServicePlan."Interval Months", 'The interval is kept');
        Assert.IsFalse(ServicePlan.Get('HX172-3O'), 'The old code is no longer a plan');
    end;

    [Test]
    procedure VehiclesKeepTheirData()
    var
        Vehicle: Record "CGR Vehicle";
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        InitRun();
        ClearPlan('HX172-4N');
        NewPlan('HX172-4O', Enum::"CGR Maintenance Strategy"::Default, 12, 'HX172 plan four');
        NewVehicle('HX172-4A', 'HX172-4O', Enum::"CGR Maintenance Strategy"::"Heavy Duty");
        Vehicle.Get('HX172-4A');
        Vehicle.Mileage := 45210;
        Vehicle."Last Service Km" := 40000;
        Vehicle."Last Service Date" := 20260115D;
        Vehicle."Daily Rate" := 55.5;
        Vehicle.Description := 'HX172 box van';
        Vehicle.Blocked := true;
        Vehicle."Checked Out" := true;
        Vehicle."Open Damages" := 2;
        Vehicle.Modify();

        ServicePlanMgt.ChangePlanCode('HX172-4O', 'HX172-4N');

        Vehicle.Get('HX172-4A');
        Assert.AreEqual('HX172-4N', Vehicle."Service Plan Code", 'The vehicle carries the new code');
        Assert.AreEqual(Enum::"CGR Maintenance Strategy"::"Heavy Duty", Vehicle.Strategy, 'The vehicle keeps its own maintenance strategy');
        Assert.AreEqual(45210, Vehicle.Mileage, 'Mileage is kept');
        Assert.AreEqual(40000, Vehicle."Last Service Km", 'Last service km is kept');
        Assert.AreEqual(20260115D, Vehicle."Last Service Date", 'Last service date is kept');
        Assert.AreEqual(55.5, Vehicle."Daily Rate", 'Daily rate is kept');
        Assert.AreEqual('HX172 box van', Vehicle.Description, 'Description is kept');
        Assert.IsTrue(Vehicle.Blocked, 'The blocked state is kept');
        Assert.IsTrue(Vehicle."Checked Out", 'The checked-out state is kept');
        Assert.AreEqual(2, Vehicle."Open Damages", 'Open damages are kept');
    end;

    [Test]
    procedure OtherPlansUntouched()
    var
        ServicePlan: Record "CGR Service Plan";
        Vehicle: Record "CGR Vehicle";
        ServiceVisit: Record "CGR Service Visit";
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
        OtherVisit: Integer;
    begin
        InitRun();
        ClearPlan('HX172-5N');
        NewPlan('HX172-5O', Enum::"CGR Maintenance Strategy"::Default, 12, 'HX172 plan five');
        NewPlan('HX172-5X', Enum::"CGR Maintenance Strategy"::"Heavy Duty", 4, 'HX172 plan five other');
        NewVehicle('HX172-5A', 'HX172-5O', Enum::"CGR Maintenance Strategy"::Default);
        NewVehicle('HX172-5B', 'HX172-5X', Enum::"CGR Maintenance Strategy"::"Heavy Duty");
        OtherVisit := InsertVisit('HX172-5B', 'HX172-5X', 20260412D, 18000);

        ServicePlanMgt.ChangePlanCode('HX172-5O', 'HX172-5N');

        ServicePlan.Get('HX172-5X');
        Assert.AreEqual(4, ServicePlan."Interval Months", 'The other plan keeps its interval');
        Assert.AreEqual('HX172 plan five other', ServicePlan.Description, 'The other plan keeps its description');
        Assert.AreEqual(Enum::"CGR Maintenance Strategy"::"Heavy Duty", ServicePlan.Strategy, 'The other plan keeps its strategy');
        Vehicle.Get('HX172-5B');
        Assert.AreEqual('HX172-5X', Vehicle."Service Plan Code", 'The vehicle on the other plan keeps its plan');
        ServiceVisit.Get(OtherVisit);
        Assert.AreEqual('HX172-5X', ServiceVisit."Service Plan Code", 'The visit under the other plan keeps its plan');
    end;

    [Test]
    procedure TakenCodeRefused()
    var
        ServicePlan: Record "CGR Service Plan";
        Vehicle: Record "CGR Vehicle";
        ServiceVisit: Record "CGR Service Visit";
        Runner: Codeunit "HX172 Plan Code Runner";
        VisitNo: Integer;
        Ok: Boolean;
    begin
        InitRun();
        NewPlan('HX172-6O', Enum::"CGR Maintenance Strategy"::Default, 12, 'HX172 plan six');
        NewPlan('HX172-6N', Enum::"CGR Maintenance Strategy"::Default, 3, 'HX172 plan six taken');
        NewVehicle('HX172-6A', 'HX172-6O', Enum::"CGR Maintenance Strategy"::Default);
        VisitNo := InsertVisit('HX172-6A', 'HX172-6O', 20260601D, 9000);
        Commit();

        Runner.SetPlanCodePair('HX172-6O', 'HX172-6N');
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'Changing to a code that is already a plan fails');
        Assert.ExpectedError('Service plan HX172-6N already exists.');
        Assert.IsTrue(ServicePlan.Get('HX172-6O'), 'The plan keeps its old code');
        ServicePlan.Get('HX172-6N');
        Assert.AreEqual(3, ServicePlan."Interval Months", 'The existing plan is unchanged');
        Vehicle.Get('HX172-6A');
        Assert.AreEqual('HX172-6O', Vehicle."Service Plan Code", 'The vehicle keeps the old code');
        ServiceVisit.Get(VisitNo);
        Assert.AreEqual('HX172-6O', ServiceVisit."Service Plan Code", 'The visit keeps the old code');
    end;

    local procedure InitRun()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();
    end;

    local procedure ClearPlan(PlanCode: Code[20])
    var
        ServicePlan: Record "CGR Service Plan";
    begin
        if ServicePlan.Get(PlanCode) then
            ServicePlan.Delete();
    end;

    local procedure NewPlan(PlanCode: Code[20]; Strategy: Enum "CGR Maintenance Strategy"; IntervalMonths: Integer; Description: Text[100])
    var
        ServicePlan: Record "CGR Service Plan";
    begin
        ClearPlan(PlanCode);
        ServicePlan.Init();
        ServicePlan.Code := PlanCode;
        ServicePlan.Description := Description;
        ServicePlan.Strategy := Strategy;
        ServicePlan."Interval Months" := IntervalMonths;
        ServicePlan.Insert();
    end;

    local procedure NewVehicle(VehicleNo: Code[20]; PlanCode: Code[20]; Strategy: Enum "CGR Maintenance Strategy")
    var
        Vehicle: Record "CGR Vehicle";
        ServiceVisit: Record "CGR Service Visit";
    begin
        ServiceVisit.SetRange("Vehicle No.", VehicleNo);
        ServiceVisit.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Mileage := 50000;
        Vehicle.Strategy := Strategy;
        Vehicle."Service Plan Code" := PlanCode;
        Vehicle.Insert();
    end;

    local procedure InsertVisit(VehicleNo: Code[20]; PlanCode: Code[20]; ServiceDate: Date; ServiceKm: Integer): Integer
    var
        ServiceVisit: Record "CGR Service Visit";
    begin
        ServiceVisit.Init();
        ServiceVisit."Vehicle No." := VehicleNo;
        ServiceVisit."Service Plan Code" := PlanCode;
        ServiceVisit."Service Date" := ServiceDate;
        ServiceVisit."Service Km" := ServiceKm;
        ServiceVisit.Insert();
        exit(ServiceVisit."Entry No.");
    end;
}
