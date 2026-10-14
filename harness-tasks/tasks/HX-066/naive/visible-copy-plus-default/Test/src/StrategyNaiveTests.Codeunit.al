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
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('HX066-N01', 1000, Enum::"CGR Maintenance Strategy"::"Heavy Duty");
        Lib.SetLastServiceKm('HX066-N01', 1000);
        Assert.AreEqual(6000, FleetMgt.NextServiceKm('HX066-N01'), 'Heavy Duty adds 5000 km');
    end;

    [Test]
    procedure DefaultStrategyAddsFifteenThousand()
    var
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.CreateVehicle('HX066-N02', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetLastServiceKm('HX066-N02', 1000);
        Assert.AreEqual(16000, FleetMgt.NextServiceKm('HX066-N02'), 'Default adds 15000 km');
    end;
}
