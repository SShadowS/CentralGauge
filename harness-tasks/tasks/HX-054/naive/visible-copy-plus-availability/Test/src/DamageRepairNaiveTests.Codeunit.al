codeunit 80110 "CGR Damage Repair Naive Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure DamageBlocksFleetVehicle()
    var
        Vehicle: Record "CGR Vehicle";
        DamageMgt: Codeunit "CGR Damage Mgt";
        FleetMgt: Codeunit "CGR Fleet Mgt";
    begin
        Lib.SetPricing(0, 1000, 0);
        Lib.CreateVehicle('HX054-N01', 1000, Enum::"CGR Maintenance Strategy"::Default);
        DamageMgt.RegisterDamage('HX054-N01', 'Dent');
        Vehicle.Get('HX054-N01');
        Assert.IsTrue(Vehicle.Blocked, 'Registered damage blocks the vehicle');
        Assert.AreEqual(1, Vehicle."Open Damages", 'One open damage');
        Assert.IsFalse(FleetMgt.IsAvailable('HX054-N01'), 'Blocked vehicle is not available');
    end;

    [Test]
    procedure RepairBothDamagesMakesVehicleAvailable()
    var
        Vehicle: Record "CGR Vehicle";
        DamageMgt: Codeunit "CGR Damage Mgt";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        FirstEntryNo: Integer;
        SecondEntryNo: Integer;
    begin
        Lib.SetPricing(0, 1000, 0);
        Lib.CreateVehicle('HX054-N02', 1000, Enum::"CGR Maintenance Strategy"::Default);
        FirstEntryNo := DamageMgt.RegisterDamage('HX054-N02', 'Dent');
        SecondEntryNo := DamageMgt.RegisterDamage('HX054-N02', 'Scratch');
        Vehicle.Get('HX054-N02');
        Assert.AreEqual(2, Vehicle."Open Damages", 'Two open damages');

        DamageMgt.RepairDamage(FirstEntryNo);
        Vehicle.Get('HX054-N02');
        Assert.AreEqual(1, Vehicle."Open Damages", 'One open damage after the first repair');
        Assert.IsTrue(Vehicle.Blocked, 'Still blocked while a damage is open');
        Assert.IsFalse(FleetMgt.IsAvailable('HX054-N02'), 'Not available while a damage is open');

        DamageMgt.RepairDamage(SecondEntryNo);
        Vehicle.Get('HX054-N02');
        Assert.AreEqual(0, Vehicle."Open Damages", 'No open damage after the last repair');
        Assert.IsFalse(Vehicle.Blocked, 'Unblocked after the last repair');
        Assert.IsTrue(FleetMgt.IsAvailable('HX054-N02'), 'Repaired vehicle is available');
    end;
}
