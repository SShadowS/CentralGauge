codeunit 80130 "CGR Damage Overview Naive"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure OpenDamagesAndOldestDate()
    var
        OverviewLine: Record "CGR Damage Overview Line";
        DamageOverview: Codeunit "CGR Damage Overview";
    begin
        HX76NaiveFleet();
        OverviewLine.Init();
        OverviewLine."Vehicle No." := 'HX076N2-OLD';
        OverviewLine.Insert();

        Assert.AreEqual(1, DamageOverview.FillDamageOverview('HX076N2-*', false, OverviewLine), 'Only the damaged vehicle');
        Assert.AreEqual(1, OverviewLine.Count(), 'One line');
        Assert.IsFalse(OverviewLine.Get('HX076N2-OLD'), 'The earlier line is gone');
        Assert.IsTrue(OverviewLine.Get('HX076N2-A'), 'The damaged vehicle is listed');
        Assert.AreEqual(2, OverviewLine."Open Damages", 'Two open damages');
        Assert.AreEqual(20270210D, OverviewLine."Oldest Open Damage", 'Oldest open damage');
    end;

    [Test]
    procedure CleanVehicleOnRequest()
    var
        OverviewLine: Record "CGR Damage Overview Line";
        DamageOverview: Codeunit "CGR Damage Overview";
    begin
        HX76NaiveFleet();

        Assert.AreEqual(2, DamageOverview.FillDamageOverview('HX076N2-*', true, OverviewLine), 'Both vehicles');
        Assert.IsTrue(OverviewLine.Get('HX076N2-B'), 'The clean vehicle is listed');
        Assert.AreEqual(0, OverviewLine."Open Damages", 'No open damage');
        Assert.AreEqual(0D, OverviewLine."Oldest Open Damage", 'No date');
    end;

    local procedure HX76NaiveFleet()
    var
        DamageMgt: Codeunit "CGR Damage Mgt";
        RepairedEntryNo: Integer;
    begin
        Lib.CreateVehicle('HX076N2-A', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.CreateVehicle('HX076N2-B', 1000, Enum::"CGR Maintenance Strategy"::Default);
        WorkDate(20270201D);
        RepairedEntryNo := DamageMgt.RegisterDamage('HX076N2-A', 'Dent');
        DamageMgt.RepairDamage(RepairedEntryNo);
        WorkDate(20270210D);
        DamageMgt.RegisterDamage('HX076N2-A', 'Scratch');
        WorkDate(20270220D);
        DamageMgt.RegisterDamage('HX076N2-A', 'Mirror');
        WorkDate(20270310D);
    end;
}
