codeunit 80130 "CGR Damage Overview Naive"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure DamagedVehicleIsListed()
    var
        OverviewLine: Record "CGR Damage Overview Line";
        DamageMgt: Codeunit "CGR Damage Mgt";
        DamageOverview: Codeunit "CGR Damage Overview";
    begin
        WorkDate(20270310D);
        Lib.CreateVehicle('HX076N1-V', 1000, Enum::"CGR Maintenance Strategy"::Default);
        DamageMgt.RegisterDamage('HX076N1-V', 'Dent');

        Assert.AreEqual(1, DamageOverview.FillDamageOverview('HX076N1-V', false, OverviewLine), 'One line');
        Assert.IsTrue(OverviewLine.Get('HX076N1-V'), 'The damaged vehicle is listed');
        Assert.AreEqual(1, OverviewLine."Open Damages", 'One open damage');
    end;
}
