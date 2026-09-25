codeunit 80020 "CGR Fleet Tests"
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
        Lib.CreateVehicle('T-FLT-001', 1000, Enum::"CGR Maintenance Strategy"::"Heavy Duty");
        Lib.SetLastServiceKm('T-FLT-001', 1000);
        Assert.AreEqual(6000, FleetMgt.NextServiceKm('T-FLT-001'), 'Heavy Duty adds 5000 km');
    end;

    [Test]
    procedure DamageBlocksVehicle()
    var
        Vehicle: Record "CGR Vehicle";
        DamageMgt: Codeunit "CGR Damage Mgt";
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        Lib.CreateVehicle('T-FLT-002', 1000, Enum::"CGR Maintenance Strategy"::Default);
        DamageMgt.RegisterDamage('T-FLT-002', 'Dent');
        Vehicle.Get('T-FLT-002');
        Assert.IsTrue(Vehicle.Blocked, 'Registered damage blocks the vehicle');
        Assert.AreEqual(1, Vehicle."Open Damages", 'One open damage');
        Assert.IsFalse(FleetMgt.IsAvailable('T-FLT-002'), 'Blocked vehicle is not available');
    end;

    [Test]
    procedure RepairLastDamageUnblocks()
    var
        Vehicle: Record "CGR Vehicle";
        DamageMgt: Codeunit "CGR Damage Mgt";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        FirstEntryNo: Integer;
        SecondEntryNo: Integer;
    begin
        Lib.CreateVehicle('T-FLT-003', 1000, Enum::"CGR Maintenance Strategy"::Default);
        FirstEntryNo := DamageMgt.RegisterDamage('T-FLT-003', 'Dent');
        SecondEntryNo := DamageMgt.RegisterDamage('T-FLT-003', 'Scratch');
        Vehicle.Get('T-FLT-003');
        Assert.AreEqual(2, Vehicle."Open Damages", 'Two open damages');

        DamageMgt.RepairDamage(FirstEntryNo);
        Vehicle.Get('T-FLT-003');
        Assert.AreEqual(1, Vehicle."Open Damages", 'One open damage after the first repair');
        Assert.IsTrue(Vehicle.Blocked, 'Still blocked while a damage is open');

        DamageMgt.RepairDamage(SecondEntryNo);
        Vehicle.Get('T-FLT-003');
        Assert.AreEqual(0, Vehicle."Open Damages", 'No open damage after the last repair');
        Assert.IsFalse(Vehicle.Blocked, 'Unblocked after the last repair');
        Assert.IsTrue(FleetMgt.IsAvailable('T-FLT-003'), 'Repaired vehicle is available');
    end;
}
