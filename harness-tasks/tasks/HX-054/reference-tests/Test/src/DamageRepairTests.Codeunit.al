codeunit 80109 "CGR Damage Repair Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        StopTxt: Label 'HX054 repair returned without an error.', Locked = true;

    [Test]
    procedure RegisterDamageStoresEntryOnWorkDate()
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        DamageMgt: Codeunit "CGR Damage Mgt";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        LongDescription: Text[100];
        EntryNo: Integer;
    begin
        SetUp(20250115D);
        Lib.CreateVehicle('HX054-V01', 1000, Enum::"CGR Maintenance Strategy"::Default);
        LongDescription := CopyStr(PadStr('Long scratch along the passenger side, from the front wing to the rear ', 100, '.'), 1, 100);
        Assert.AreEqual(100, StrLen(LongDescription), 'Arrange: the description has 100 characters');

        EntryNo := DamageMgt.RegisterDamage('HX054-V01', LongDescription);

        Assert.IsTrue(DamageEntry.Get(EntryNo), 'RegisterDamage returns the new entry''s number');
        Assert.AreEqual('HX054-V01', DamageEntry."Vehicle No.", 'The entry is for the vehicle');
        Assert.AreEqual(LongDescription, DamageEntry.Description, 'The description is stored exactly as given');
        Assert.AreEqual(20250115D, DamageEntry."Reported On", 'Reported On is the work date');
        Assert.IsFalse(DamageEntry.Repaired, 'A new damage is not repaired');
        Vehicle.Get('HX054-V01');
        Assert.IsTrue(Vehicle.Blocked, 'A damaged vehicle is blocked');
        Assert.AreEqual(1, Vehicle."Open Damages", 'One open damage');
        Assert.IsFalse(FleetMgt.IsAvailable('HX054-V01'), 'A blocked vehicle is not available');
    end;

    [Test]
    procedure SecondDamageAddsOneOpenDamage()
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        DamageMgt: Codeunit "CGR Damage Mgt";
        FirstEntryNo: Integer;
        SecondEntryNo: Integer;
    begin
        SetUp(20250115D);
        Lib.CreateVehicle('HX054-V02', 1000, Enum::"CGR Maintenance Strategy"::Default);

        FirstEntryNo := DamageMgt.RegisterDamage('HX054-V02', 'Dent');
        Vehicle.Get('HX054-V02');
        Assert.AreEqual(1, Vehicle."Open Damages", 'One open damage after the first damage');
        SecondEntryNo := DamageMgt.RegisterDamage('HX054-V02', 'Scratch');

        Assert.AreNotEqual(FirstEntryNo, SecondEntryNo, 'Each damage gets its own entry');
        Vehicle.Get('HX054-V02');
        Assert.IsTrue(Vehicle.Blocked, 'The vehicle is blocked');
        Assert.AreEqual(2, Vehicle."Open Damages", 'Two open damages');
        DamageEntry.SetRange("Vehicle No.", 'HX054-V02');
        Assert.AreEqual(2, DamageEntry.Count(), 'Two damage entries');
    end;

    [Test]
    procedure RepairTwiceWhileAnotherOpenKeepsVehicleBlocked()
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        DamageMgt: Codeunit "CGR Damage Mgt";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        FirstEntryNo: Integer;
        SecondEntryNo: Integer;
    begin
        SetUp(20250115D);
        Lib.CreateVehicle('HX054-V03', 1000, Enum::"CGR Maintenance Strategy"::Default);
        FirstEntryNo := DamageMgt.RegisterDamage('HX054-V03', 'Dent');
        SecondEntryNo := DamageMgt.RegisterDamage('HX054-V03', 'Scratch');

        DamageMgt.RepairDamage(FirstEntryNo);
        Vehicle.Get('HX054-V03');
        Assert.AreEqual(1, Vehicle."Open Damages", 'Arrange: one open damage after the first repair');
        Assert.IsTrue(Vehicle.Blocked, 'Arrange: still blocked after the first repair');
        WorkDate(20250120D);

        DamageMgt.RepairDamage(FirstEntryNo);

        Vehicle.Get('HX054-V03');
        Assert.AreEqual(1, Vehicle."Open Damages", 'The second repair of the same entry changes nothing');
        Assert.IsTrue(Vehicle.Blocked, 'The vehicle stays blocked while a damage is open');
        Assert.IsFalse(FleetMgt.IsAvailable('HX054-V03'), 'A vehicle with an open damage is not available');
        DamageEntry.Get(FirstEntryNo);
        Assert.IsTrue(DamageEntry.Repaired, 'The repaired entry stays repaired');
        Assert.AreEqual(20250115D, DamageEntry."Reported On", 'The second repair keeps the report date');
        Assert.AreEqual('Dent', DamageEntry.Description, 'The second repair keeps the description');
        DamageEntry.Get(SecondEntryNo);
        Assert.IsFalse(DamageEntry.Repaired, 'The other damage is still open');
    end;

    [Test]
    procedure RepairOfRepairedEntryRaisesNoError()
    var
        DamageMgt: Codeunit "CGR Damage Mgt";
        FirstEntryNo: Integer;
    begin
        SetUp(20250115D);
        Lib.CreateVehicle('HX054-V04', 1000, Enum::"CGR Maintenance Strategy"::Default);
        FirstEntryNo := DamageMgt.RegisterDamage('HX054-V04', 'Dent');
        DamageMgt.RegisterDamage('HX054-V04', 'Scratch');
        DamageMgt.RepairDamage(FirstEntryNo);

        asserterror RepairThenStop(FirstEntryNo);

        Assert.ExpectedError(StopTxt);
    end;

    [Test]
    procedure RepairOfUnknownEntryFails()
    var
        DamageEntry: Record "CGR Damage Entry";
        DamageMgt: Codeunit "CGR Damage Mgt";
        UnknownEntryNo: Integer;
    begin
        SetUp(20250115D);
        Lib.CreateVehicle('HX054-V05', 1000, Enum::"CGR Maintenance Strategy"::Default);
        DamageMgt.RegisterDamage('HX054-V05', 'Dent');
        DamageEntry.FindLast();
        UnknownEntryNo := DamageEntry."Entry No." + 1;
        Assert.IsFalse(DamageEntry.Get(UnknownEntryNo), 'Arrange: the entry number does not exist');

        asserterror DamageMgt.RepairDamage(UnknownEntryNo);
    end;

    [Test]
    procedure RepairKeepsReportedOn()
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
        DamageMgt: Codeunit "CGR Damage Mgt";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        EntryNo: Integer;
    begin
        SetUp(20250115D);
        Lib.CreateVehicle('HX054-V06', 1000, Enum::"CGR Maintenance Strategy"::Default);
        EntryNo := DamageMgt.RegisterDamage('HX054-V06', 'Dent');
        DamageEntry.Get(EntryNo);
        Assert.AreEqual(20250115D, DamageEntry."Reported On", 'Arrange: reported on the first work date');
        Vehicle.Get('HX054-V06');
        Assert.IsTrue(Vehicle.Blocked, 'Arrange: the damaged vehicle is blocked');
        WorkDate(20250120D);

        DamageMgt.RepairDamage(EntryNo);

        DamageEntry.Get(EntryNo);
        Assert.IsTrue(DamageEntry.Repaired, 'The entry is repaired');
        Assert.AreEqual(20250115D, DamageEntry."Reported On", 'The repair keeps the report date');
        Vehicle.Get('HX054-V06');
        Assert.AreEqual(0, Vehicle."Open Damages", 'No open damage');
        Assert.IsFalse(Vehicle.Blocked, 'The vehicle is no longer blocked');
        Assert.IsTrue(FleetMgt.IsAvailable('HX054-V06'), 'The repaired vehicle is available');
    end;

    [Test]
    procedure RepairLastOpenDamageReleasesVehicle()
    var
        Vehicle: Record "CGR Vehicle";
        DamageMgt: Codeunit "CGR Damage Mgt";
        FleetMgt: Codeunit "CGR Fleet Mgt";
        FirstEntryNo: Integer;
        SecondEntryNo: Integer;
    begin
        SetUp(20250115D);
        Lib.CreateVehicle('HX054-V07', 1000, Enum::"CGR Maintenance Strategy"::Default);
        FirstEntryNo := DamageMgt.RegisterDamage('HX054-V07', 'Dent');
        SecondEntryNo := DamageMgt.RegisterDamage('HX054-V07', 'Scratch');

        DamageMgt.RepairDamage(SecondEntryNo);
        Vehicle.Get('HX054-V07');
        Assert.AreEqual(1, Vehicle."Open Damages", 'One open damage after the first repair');
        Assert.IsTrue(Vehicle.Blocked, 'Still blocked while a damage is open');

        DamageMgt.RepairDamage(FirstEntryNo);
        Vehicle.Get('HX054-V07');
        Assert.AreEqual(0, Vehicle."Open Damages", 'No open damage after the last repair');
        Assert.IsFalse(Vehicle.Blocked, 'Unblocked after the last repair');
        Assert.IsTrue(FleetMgt.IsAvailable('HX054-V07'), 'The repaired vehicle is available');
    end;

    local procedure SetUp(NewWorkDate: Date)
    begin
        WorkDate(NewWorkDate);
        Lib.SetPricing(0, 1000, 0);
    end;

    local procedure RepairThenStop(EntryNo: Integer)
    var
        DamageMgt: Codeunit "CGR Damage Mgt";
    begin
        DamageMgt.RepairDamage(EntryNo);
        Error(StopTxt);
    end;
}
