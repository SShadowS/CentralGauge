codeunit 80055 "CGR Service Plan Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure AssignPlanSetsStrategy()
    var
        Vehicle: Record "CGR Vehicle";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateServicePlan('T-SP-HD', Enum::"CGR Maintenance Strategy"::"Heavy Duty", 6);
        Lib.CreateVehicle('T-SP-001', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetLastServiceKm('T-SP-001', 1000);

        ServicePlanMgt.AssignPlan('T-SP-001', 'T-SP-HD');
        Vehicle.Get('T-SP-001');
        Assert.AreEqual('T-SP-HD', Vehicle."Service Plan Code", 'Plan assigned');
        Assert.AreEqual(Enum::"CGR Maintenance Strategy"::"Heavy Duty", Vehicle.Strategy, 'Strategy taken from the plan');
        Assert.AreEqual(6000, FleetMgt.NextServiceKm('T-SP-001'), 'Heavy Duty adds 5000 km');
    end;

    [Test]
    procedure NextServiceDateFromPlanInterval()
    var
        Vehicle: Record "CGR Vehicle";
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateServicePlan('T-SP-6M', Enum::"CGR Maintenance Strategy"::Default, 6);
        Lib.CreateVehicle('T-SP-002', 5000, Enum::"CGR Maintenance Strategy"::Default);
        ServicePlanMgt.AssignPlan('T-SP-002', 'T-SP-6M');

        ServicePlanMgt.RegisterService('T-SP-002', 20270301D, 4800);
        Vehicle.Get('T-SP-002');
        Assert.AreEqual(4800, Vehicle."Last Service Km", 'Service km recorded');
        Assert.AreEqual(20270301D, Vehicle."Last Service Date", 'Service date recorded');
        Assert.AreEqual(20270901D, ServicePlanMgt.NextServiceDate('T-SP-002'), 'Six months after the last service');
        Assert.IsFalse(ServicePlanMgt.IsServiceDue('T-SP-002', 20270831D), 'Not due the day before');
        Assert.IsTrue(ServicePlanMgt.IsServiceDue('T-SP-002', 20270901D), 'Due on the plan date');
    end;

    [Test]
    procedure DueByKmWithoutPlan()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-SP-003', 21000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetLastServiceKm('T-SP-003', 6000);
        Lib.CreateVehicle('T-SP-004', 20999, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetLastServiceKm('T-SP-004', 6000);

        Assert.AreEqual(0D, ServicePlanMgt.NextServiceDate('T-SP-003'), 'No plan, no service date');
        Assert.IsTrue(ServicePlanMgt.IsServiceDue('T-SP-003', 20270301D), 'Due at the service km');
        Assert.IsFalse(ServicePlanMgt.IsServiceDue('T-SP-004', 20270301D), 'Not due one km before');
    end;

    [Test]
    procedure ServiceKmAboveMileageFails()
    var
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('T-SP-005', 1000, Enum::"CGR Maintenance Strategy"::Default);
        asserterror ServicePlanMgt.RegisterService('T-SP-005', 20270301D, 1001);
        Assert.ExpectedError('Service km 1001 is above the mileage 1000 of vehicle T-SP-005.');
    end;
}
