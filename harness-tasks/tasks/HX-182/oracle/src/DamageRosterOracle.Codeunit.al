codeunit 88690 "HX182 Damage Roster Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure InPeriodDamagesCounted()
    var
        Buffer: Record "CGR Damage Roster Buffer" temporary;
        Roster: Codeunit "CGR Damage Roster";
    begin
        Prepare();
        InitDamagedBothSides('HX182-1A');

        Roster.FillPeriodRoster(20270301D, 20270331D, Buffer);
        AssertRow(Buffer, 'HX182-1A', 2);
    end;

    [Test]
    procedure PeriodBoundsIncluded()
    var
        Buffer: Record "CGR Damage Roster Buffer" temporary;
        Roster: Codeunit "CGR Damage Roster";
    begin
        Prepare();
        InitVehicle('HX182-2A');
        AddDamage('HX182-2A', 20270228D);
        AddDamage('HX182-2A', 20270301D);
        AddDamage('HX182-2A', 20270331D);
        AddDamage('HX182-2A', 20270401D);

        Roster.FillPeriodRoster(20270301D, 20270331D, Buffer);
        AssertRow(Buffer, 'HX182-2A', 2);
    end;

    [Test]
    procedure VehicleWithoutDamageListed()
    var
        Buffer: Record "CGR Damage Roster Buffer" temporary;
        Roster: Codeunit "CGR Damage Roster";
    begin
        Prepare();
        InitVehicle('HX182-3A');

        Roster.FillPeriodRoster(20270301D, 20270331D, Buffer);
        AssertRow(Buffer, 'HX182-3A', 0);
    end;

    [Test]
    procedure DamagedOutsidePeriodListedAtZero()
    var
        Buffer: Record "CGR Damage Roster Buffer" temporary;
        Roster: Codeunit "CGR Damage Roster";
    begin
        Prepare();
        InitDamagedOutside('HX182-4A');

        Roster.FillPeriodRoster(20270301D, 20270331D, Buffer);
        AssertRow(Buffer, 'HX182-4A', 0);
    end;

    [Test]
    procedure WholeFleetOneFill()
    var
        Buffer: Record "CGR Damage Roster Buffer" temporary;
        Roster: Codeunit "CGR Damage Roster";
    begin
        Prepare();
        InitDamagedBothSides('HX182-5A');
        InitVehicle('HX182-5B');
        InitDamagedOutside('HX182-5C');

        Roster.FillPeriodRoster(20270301D, 20270331D, Buffer);
        Buffer.SetFilter("Vehicle No.", 'HX182-5*');
        Assert.AreEqual(3, Buffer.Count(), 'One row per vehicle');
        Buffer.Reset();
        AssertRow(Buffer, 'HX182-5A', 2);
        AssertRow(Buffer, 'HX182-5B', 0);
        AssertRow(Buffer, 'HX182-5C', 0);
    end;

    [Test]
    procedure SecondFillReplacesFirst()
    var
        Buffer: Record "CGR Damage Roster Buffer" temporary;
        Roster: Codeunit "CGR Damage Roster";
    begin
        Prepare();
        InitDamagedBothSides('HX182-6A');
        InitVehicle('HX182-6B');
        InitDamagedOutside('HX182-6C');
        Buffer.Init();
        Buffer."Vehicle No." := 'HX182-6OLD';
        Buffer."Damages Reported" := 7;
        Buffer.Insert();

        Roster.FillPeriodRoster(20270301D, 20270331D, Buffer);
        Roster.FillPeriodRoster(20261201D, 20261231D, Buffer);
        Assert.IsFalse(Buffer.Get('HX182-6OLD'), 'A row that is not of the latest fill is gone');
        Buffer.SetFilter("Vehicle No.", 'HX182-6*');
        Assert.AreEqual(3, Buffer.Count(), 'The buffer holds the rows of the December fill only');
        Buffer.Reset();
        AssertRow(Buffer, 'HX182-6A', 1);
        AssertRow(Buffer, 'HX182-6B', 0);
        AssertRow(Buffer, 'HX182-6C', 1);
    end;

    [Test]
    procedure AllTimeRosterUnchanged()
    var
        Buffer: Record "CGR Damage Roster Buffer" temporary;
        Roster: Codeunit "CGR Damage Roster";
    begin
        Prepare();
        InitDamagedBothSides('HX182-7A');
        InitVehicle('HX182-7B');
        InitDamagedOutside('HX182-7C');

        Roster.FillRoster(Buffer);
        Buffer.SetFilter("Vehicle No.", 'HX182-7*');
        Assert.AreEqual(3, Buffer.Count(), 'The all-time roster lists every vehicle');
        Buffer.Reset();
        AssertRow(Buffer, 'HX182-7A', 4);
        AssertRow(Buffer, 'HX182-7B', 0);
        AssertRow(Buffer, 'HX182-7C', 2);
    end;

    local procedure AssertRow(var Buffer: Record "CGR Damage Roster Buffer" temporary; VehicleNo: Code[20]; Expected: Integer)
    begin
        Assert.IsTrue(Buffer.Get(VehicleNo), StrSubstNo('The roster has a row for %1', VehicleNo));
        Assert.AreEqual(Expected, Buffer."Damages Reported", StrSubstNo('Damages Reported of %1', VehicleNo));
    end;

    local procedure Prepare()
    begin
        WorkDate(20270315D);
    end;

    local procedure InitDamagedBothSides(VehicleNo: Code[20])
    begin
        InitVehicle(VehicleNo);
        AddDamage(VehicleNo, 20270305D);
        AddDamage(VehicleNo, 20270320D);
        AddDamage(VehicleNo, 20261210D);
        AddDamage(VehicleNo, 20270402D);
    end;

    local procedure InitDamagedOutside(VehicleNo: Code[20])
    begin
        InitVehicle(VehicleNo);
        AddDamage(VehicleNo, 20261215D);
        AddDamage(VehicleNo, 20270410D);
    end;

    local procedure InitVehicle(VehicleNo: Code[20])
    var
        Vehicle: Record "CGR Vehicle";
        DamageEntry: Record "CGR Damage Entry";
    begin
        DamageEntry.SetRange("Vehicle No.", VehicleNo);
        DamageEntry.DeleteAll();
        if Vehicle.Get(VehicleNo) then
            Vehicle.Delete();
        Vehicle.Init();
        Vehicle."No." := VehicleNo;
        Vehicle.Insert();
    end;

    local procedure AddDamage(VehicleNo: Code[20]; ReportedOn: Date)
    var
        DamageEntry: Record "CGR Damage Entry";
    begin
        DamageEntry.Init();
        DamageEntry."Vehicle No." := VehicleNo;
        DamageEntry.Description := 'HX182 damage';
        DamageEntry."Reported On" := ReportedOn;
        DamageEntry.Insert();
    end;
}
