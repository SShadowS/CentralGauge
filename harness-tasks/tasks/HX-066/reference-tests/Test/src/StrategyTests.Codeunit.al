codeunit 80118 "CGR Strategy Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure DefaultStrategyAddsFifteenThousandKm()
    var
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        Initialize();
        Lib.CreateVehicle('HX066-V01', 1500, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetLastServiceKm('HX066-V01', 1000);

        Assert.AreEqual(16000, FleetMgt.NextServiceKm('HX066-V01'), 'Default adds 15000 km to the last service km');
    end;

    [Test]
    procedure HeavyDutyStrategyAddsFiveThousandKm()
    var
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        Initialize();
        Lib.CreateVehicle('HX066-V02', 1500, Enum::"CGR Maintenance Strategy"::"Heavy Duty");
        Lib.SetLastServiceKm('HX066-V02', 1000);

        Assert.AreEqual(6000, FleetMgt.NextServiceKm('HX066-V02'), 'Heavy Duty adds 5000 km to the last service km');
    end;

    [Test]
    procedure PartnerStrategyGivesItsOwnInterval()
    var
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        Initialize();
        Lib.CreateVehicle('HX066-V03', 1500, Enum::"CGR Maintenance Strategy"::"CGR Test City Car");
        Lib.SetLastServiceKm('HX066-V03', 1000);

        Assert.AreEqual(11000, FleetMgt.NextServiceKm('HX066-V03'), 'A strategy another app adds gives its own interval');
    end;

    [Test]
    procedure OneFleetMgtAnswersForEachVehicle()
    var
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        Initialize();
        Lib.CreateVehicle('HX066-V04', 1500, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetLastServiceKm('HX066-V04', 1000);
        Lib.CreateVehicle('HX066-V05', 2500, Enum::"CGR Maintenance Strategy"::"Heavy Duty");
        Lib.SetLastServiceKm('HX066-V05', 2000);
        Lib.CreateVehicle('HX066-V06', 3500, Enum::"CGR Maintenance Strategy"::"CGR Test City Car");
        Lib.SetLastServiceKm('HX066-V06', 3000);

        Assert.AreEqual(16000, FleetMgt.NextServiceKm('HX066-V04'), 'First vehicle: Default');
        Assert.AreEqual(7000, FleetMgt.NextServiceKm('HX066-V05'), 'Second vehicle through the same Fleet Mgt: Heavy Duty');
        Assert.AreEqual(13000, FleetMgt.NextServiceKm('HX066-V06'), 'Third vehicle through the same Fleet Mgt: the partner strategy');
    end;

    [Test]
    procedure VehicleStrategyWinsOverDefaultPlan()
    var
        Vehicle: Record "CGR Vehicle";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        Initialize();
        Lib.CreateServicePlan('HX66-DEF', Enum::"CGR Maintenance Strategy"::Default, 6);
        Lib.CreateVehicle('HX066-V07', 1500, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetLastServiceKm('HX066-V07', 1000);
        ServicePlanMgt.AssignPlan('HX066-V07', 'HX66-DEF');
        Vehicle.Get('HX066-V07');
        Vehicle.Strategy := Vehicle.Strategy::"Heavy Duty";
        Vehicle.Modify();

        Vehicle.Get('HX066-V07');
        Assert.AreEqual('HX66-DEF', Vehicle."Service Plan Code", 'Arrange: the vehicle keeps the Default plan');
        Assert.AreEqual(Enum::"CGR Maintenance Strategy"::"Heavy Duty", Vehicle.Strategy, 'Arrange: the vehicle''s own strategy is Heavy Duty');
        Assert.AreEqual(6000, FleetMgt.NextServiceKm('HX066-V07'), 'The vehicle''s own Heavy Duty strategy counts, not the plan''s Default');
    end;

    [Test]
    procedure VehicleStrategyWinsOverHeavyDutyPlan()
    var
        Vehicle: Record "CGR Vehicle";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        Initialize();
        Lib.CreateServicePlan('HX66-HD', Enum::"CGR Maintenance Strategy"::"Heavy Duty", 6);
        Lib.CreateVehicle('HX066-V08', 1500, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetLastServiceKm('HX066-V08', 1000);
        ServicePlanMgt.AssignPlan('HX066-V08', 'HX66-HD');
        Vehicle.Get('HX066-V08');
        Vehicle.Strategy := Vehicle.Strategy::"CGR Test City Car";
        Vehicle.Modify();

        Vehicle.Get('HX066-V08');
        Assert.AreEqual('HX66-HD', Vehicle."Service Plan Code", 'Arrange: the vehicle keeps the Heavy Duty plan');
        Assert.AreEqual(Enum::"CGR Maintenance Strategy"::"CGR Test City Car", Vehicle.Strategy, 'Arrange: the vehicle''s own strategy is the partner strategy');
        Assert.AreEqual(11000, FleetMgt.NextServiceKm('HX066-V08'), 'The vehicle''s own partner strategy counts, not the plan''s Heavy Duty');
    end;

    local procedure Initialize()
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
    end;
}
