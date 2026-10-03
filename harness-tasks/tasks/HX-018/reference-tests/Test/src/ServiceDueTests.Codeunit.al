codeunit 80072 "CGR Service Due Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        RegisteredMarkerErr: Label 'Registered %1 on %2.', Comment = '%1 = last service km, %2 = last service date';

    [Test]
    procedure HeavyDutyDueAtStrategyKm()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-SD-001', 6000, Enum::"CGR Maintenance Strategy"::"Heavy Duty");
        Lib.SetLastServiceKm('T-SD-001', 1000);
        Lib.CreateVehicle('T-SD-002', 5999, Enum::"CGR Maintenance Strategy"::"Heavy Duty");
        Lib.SetLastServiceKm('T-SD-002', 1000);

        Assert.IsTrue(ServicePlanMgt.IsServiceDue('T-SD-001', 20270301D), 'Heavy Duty is due 5000 km after the last service');
        Assert.IsFalse(ServicePlanMgt.IsServiceDue('T-SD-002', 20270301D), 'Heavy Duty is not due one km before');
    end;

    [Test]
    procedure DueByKmEvenWithPlanDateAhead()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateServicePlan('T-SD-HD6', Enum::"CGR Maintenance Strategy"::"Heavy Duty", 6);
        Lib.CreateVehicle('T-SD-003', 9000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.CreateVehicle('T-SD-012', 8999, Enum::"CGR Maintenance Strategy"::Default);
        ServicePlanMgt.AssignPlan('T-SD-003', 'T-SD-HD6');
        ServicePlanMgt.AssignPlan('T-SD-012', 'T-SD-HD6');
        ServicePlanMgt.RegisterService('T-SD-003', 20270301D, 4000);
        ServicePlanMgt.RegisterService('T-SD-012', 20270301D, 4000);

        Assert.AreEqual(20270901D, ServicePlanMgt.NextServiceDate('T-SD-003'), 'Plan date six months ahead');
        Assert.IsTrue(ServicePlanMgt.IsServiceDue('T-SD-003', 20270301D), 'Due by km although the plan date is ahead');
        Assert.IsFalse(ServicePlanMgt.IsServiceDue('T-SD-012', 20270301D), 'Not due one km before, plan date ahead');
    end;

    [Test]
    procedure PlanAssignmentTakesStrategy()
    var
        Vehicle: Record "CGR Vehicle";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateServicePlan('T-SD-HD', Enum::"CGR Maintenance Strategy"::"Heavy Duty", 6);
        Lib.CreateVehicle('T-SD-004', 3000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetLastServiceKm('T-SD-004', 2000);

        ServicePlanMgt.AssignPlan('T-SD-004', 'T-SD-HD');
        Vehicle.Get('T-SD-004');
        Assert.AreEqual('T-SD-HD', Vehicle."Service Plan Code", 'Plan stored on the vehicle');
        Assert.AreEqual(Enum::"CGR Maintenance Strategy"::"Heavy Duty", Vehicle.Strategy, 'Strategy taken from the plan');
        Assert.AreEqual(7000, FleetMgt.NextServiceKm('T-SD-004'), 'Heavy Duty next service km');
    end;

    [Test]
    procedure UnknownPlanCannotBeAssigned()
    var
        ServicePlan: Record "CGR Service Plan";
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-SD-005', 1000, Enum::"CGR Maintenance Strategy"::Default);
        ServicePlan.SetRange(Code, 'T-SD-NONE');
        ServicePlan.DeleteAll();

        asserterror ServicePlanMgt.AssignPlan('T-SD-005', 'T-SD-NONE');
    end;

    [Test]
    procedure ServiceAtMileageIsRegistered()
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-SD-006', 8000, Enum::"CGR Maintenance Strategy"::Default);

        asserterror RegisterThenReport('T-SD-006', 20270215D, 8000);
        Assert.ExpectedError('Registered 8000 on 2027-02-15.');
    end;

    [Test]
    procedure ServiceAboveMileageFails()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-SD-007', 8000, Enum::"CGR Maintenance Strategy"::Default);

        asserterror ServicePlanMgt.RegisterService('T-SD-007', 20270215D, 8001);
        Assert.ExpectedError('Service km 8001 is above the mileage 8000 of vehicle T-SD-007.');
    end;

    [Test]
    procedure EventSeesUpdatedVehicle()
    var
        Vehicle: Record "CGR Vehicle";
        Spy: Codeunit "CGR Service Registered Spy";
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-SD-008', 9000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetLastServiceKm('T-SD-008', 1000);
        BindSubscription(Spy);

        ServicePlanMgt.RegisterService('T-SD-008', 20270220D, 8500);
        UnbindSubscription(Spy);
        Assert.AreEqual(1, Spy.HitCount(), 'Extensions notified once');
        Assert.AreEqual('T-SD-008', Spy.SeenServiceVehicleNo(), 'Event passes the serviced vehicle');
        Assert.AreEqual(8500, Spy.SeenServiceKm(), 'Event sees the new last service km');
        Assert.AreEqual(20270220D, Spy.SeenServiceDate(), 'Event sees the new last service date');
        Vehicle.Get('T-SD-008');
        Assert.AreEqual(8500, Vehicle."Last Service Km", 'Service km stored');
        Assert.AreEqual(20270220D, Vehicle."Last Service Date", 'Service date stored');
    end;

    [Test]
    procedure NoServiceDateWithoutLastService()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateServicePlan('T-SD-6M', Enum::"CGR Maintenance Strategy"::Default, 6);
        Lib.CreateVehicle('T-SD-009', 1000, Enum::"CGR Maintenance Strategy"::Default);
        ServicePlanMgt.AssignPlan('T-SD-009', 'T-SD-6M');

        Assert.AreEqual(0D, ServicePlanMgt.NextServiceDate('T-SD-009'), 'No last service, no next service date');
        Assert.IsFalse(ServicePlanMgt.IsServiceDue('T-SD-009', 20280301D), 'Not due without a last service date');
    end;

    [Test]
    procedure NoServiceDateForZeroInterval()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateServicePlan('T-SD-0M', Enum::"CGR Maintenance Strategy"::Default, 0);
        Lib.CreateVehicle('T-SD-010', 1500, Enum::"CGR Maintenance Strategy"::Default);
        ServicePlanMgt.AssignPlan('T-SD-010', 'T-SD-0M');
        ServicePlanMgt.RegisterService('T-SD-010', 20270301D, 1000);

        Assert.AreEqual(0D, ServicePlanMgt.NextServiceDate('T-SD-010'), 'Interval 0, no next service date');
        Assert.IsFalse(ServicePlanMgt.IsServiceDue('T-SD-010', 20280301D), 'Not due by date with interval 0');
    end;

    [Test]
    procedure DueFromPlanDateBoundary()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateServicePlan('T-SD-3M', Enum::"CGR Maintenance Strategy"::Default, 3);
        Lib.CreateVehicle('T-SD-011', 2000, Enum::"CGR Maintenance Strategy"::Default);
        ServicePlanMgt.AssignPlan('T-SD-011', 'T-SD-3M');
        ServicePlanMgt.RegisterService('T-SD-011', 20270131D, 2000);

        Assert.AreEqual(20270430D, ServicePlanMgt.NextServiceDate('T-SD-011'), 'Three months after the last service');
        Assert.IsFalse(ServicePlanMgt.IsServiceDue('T-SD-011', 20270429D), 'Not due the day before');
        Assert.IsTrue(ServicePlanMgt.IsServiceDue('T-SD-011', 20270430D), 'Due on the next service date');
        Assert.IsTrue(ServicePlanMgt.IsServiceDue('T-SD-011', 20270515D), 'Due after the next service date');
    end;

    local procedure RegisterThenReport(VehicleNo: Code[20]; ServiceDate: Date; ServiceKm: Integer)
    var
        Vehicle: Record "CGR Vehicle";
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        ServicePlanMgt.RegisterService(VehicleNo, ServiceDate, ServiceKm);
        Vehicle.Get(VehicleNo);
        Error(RegisteredMarkerErr, Format(Vehicle."Last Service Km", 0, 9), Format(Vehicle."Last Service Date", 0, 9));
    end;
}
