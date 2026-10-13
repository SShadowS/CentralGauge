codeunit 86131 "HX033 Shift Returns R11"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "HX033 Shift Library";

    [Test]
    procedure DamagedListContentReplaced()
    var
        Shift: Codeunit "CGR Shift Returns";
        VehicleNos: List of [Code[20]];
    begin
        Lib.Prepare();
        Lib.AssertShiftStartsEmpty();
        Lib.InitVehicle('HX033-11A');
        VehicleNos.Add('Z');
        Lib.RentAndReturn('HX033-C11A', 'HX033-11A', 'Dent');

        Shift.DamagedVehicles(VehicleNos);
        Assert.AreEqual('HX033-11A|', Lib.ListText(VehicleNos), 'DamagedVehicles replaces the content of the list it is given');
    end;
}
