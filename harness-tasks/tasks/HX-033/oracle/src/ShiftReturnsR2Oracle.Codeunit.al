codeunit 86121 "HX033 Shift Returns R2"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "HX033 Shift Library";

    [Test]
    procedure VehicleListedOnce()
    var
        Shift: Codeunit "CGR Shift Returns";
        VehicleNos: List of [Code[20]];
    begin
        Lib.Prepare();
        Lib.InitVehicle('HX033-2A');
        Lib.InitVehicle('HX033-2C');

        Lib.RentAndReturn('HX033-C2A1', 'HX033-2A', '');
        Lib.RentAndReturn('HX033-C2C', 'HX033-2C', '');
        Lib.RentAndReturn('HX033-C2A2', 'HX033-2A', '');

        Shift.ReturnedVehicles(VehicleNos);
        Assert.AreEqual('HX033-2A|HX033-2C|', Lib.ListText(VehicleNos), 'A vehicle returned twice is listed once, at its first return');
    end;
}
