codeunit 86125 "HX033 Shift Returns R6"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "HX033 Shift Library";

    [Test]
    procedure ListContentReplaced()
    var
        Shift: Codeunit "CGR Shift Returns";
        VehicleNos: List of [Code[20]];
    begin
        Lib.Prepare();
        Lib.AssertShiftStartsEmpty();
        Lib.InitVehicle('HX033-6A');
        VehicleNos.Add('Z');
        Lib.RentAndReturn('HX033-C6A', 'HX033-6A', '');

        Shift.ReturnedVehicles(VehicleNos);
        Assert.AreEqual('HX033-6A|', Lib.ListText(VehicleNos), 'ReturnedVehicles replaces the content of the list it is given');
    end;
}
