codeunit 80121 "CGR Strategy Naive"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure HeavyDutyStrategyFromFleetExtension()
    var
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        Initialize();
        Lib.CreateVehicle('HX066-N01', 1000, Enum::"CGR Maintenance Strategy"::"Heavy Duty");
        Lib.SetLastServiceKm('HX066-N01', 1000);
        Assert.AreEqual(6000, FleetMgt.NextServiceKm('HX066-N01'), 'Heavy Duty adds 5000 km');
    end;

    [Test]
    procedure DefaultStrategyAddsFifteenThousand()
    var
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        Initialize();
        Lib.CreateVehicle('HX066-N02', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetLastServiceKm('HX066-N02', 1000);
        Assert.AreEqual(16000, FleetMgt.NextServiceKm('HX066-N02'), 'Default adds 15000 km');
    end;

    [Test]
    procedure OneFleetMgtForTwoVehicles()
    var
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        Initialize();
        Lib.CreateVehicle('HX066-N03', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetLastServiceKm('HX066-N03', 1000);
        Lib.CreateVehicle('HX066-N04', 1000, Enum::"CGR Maintenance Strategy"::"Heavy Duty");
        Lib.SetLastServiceKm('HX066-N04', 1000);
        Assert.AreEqual(16000, FleetMgt.NextServiceKm('HX066-N03'), 'Default vehicle');
        Assert.AreEqual(6000, FleetMgt.NextServiceKm('HX066-N04'), 'Heavy Duty vehicle through the same Fleet Mgt');
    end;

    [Test]
    procedure HeavyDutyVehicleOnDefaultPlan()
    var
        Vehicle: Record "CGR Vehicle";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        ServicePlanMgt: Codeunit "CGR Service Plan Mgt";
    begin
        Initialize();
        Lib.CreateServicePlan('HX66-NDEF', Enum::"CGR Maintenance Strategy"::Default, 6);
        Lib.CreateVehicle('HX066-N05', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetLastServiceKm('HX066-N05', 1000);
        ServicePlanMgt.AssignPlan('HX066-N05', 'HX66-NDEF');
        Vehicle.Get('HX066-N05');
        Vehicle.Strategy := Vehicle.Strategy::"Heavy Duty";
        Vehicle.Modify();
        Assert.AreEqual(6000, FleetMgt.NextServiceKm('HX066-N05'), 'The vehicle''s own strategy counts');
    end;

    local procedure Initialize()
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
    end;
}
