codeunit 86120 "HX033 Shift Returns R1"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "HX033 Shift Library";

    [Test]
    procedure ReturnsListedInOrder()
    var
        Shift: Codeunit "CGR Shift Returns";
        VehicleNos: List of [Code[20]];
    begin
        Lib.Prepare();
        Lib.InitVehicle('HX033-1A');
        Lib.InitVehicle('HX033-1B');

        Lib.RentAndReturn('HX033-C1B', 'HX033-1B', '');
        Lib.RentAndReturn('HX033-C1A', 'HX033-1A', '');

        Shift.ReturnedVehicles(VehicleNos);
        Assert.AreEqual('HX033-1B|HX033-1A|', Lib.ListText(VehicleNos), 'Returned vehicles are listed in the order they came back');
    end;
}
