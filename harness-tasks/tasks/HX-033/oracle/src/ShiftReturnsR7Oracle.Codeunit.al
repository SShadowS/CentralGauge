codeunit 86126 "HX033 Shift Returns R7"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "HX033 Shift Library";

    [Test]
    procedure SharedAcrossInstances()
    var
        ShiftA: Codeunit "CGR Shift Returns";
        ShiftB: Codeunit "CGR Shift Returns";
        ListA: List of [Code[20]];
        ListB: List of [Code[20]];
    begin
        Lib.Prepare();
        Lib.AssertShiftStartsEmpty();
        Lib.InitVehicle('HX033-7A');
        Lib.RentAndReturn('HX033-C7A', 'HX033-7A', '');

        ShiftA.ReturnedVehicles(ListA);
        ShiftB.ReturnedVehicles(ListB);
        Assert.AreEqual('HX033-7A|', Lib.ListText(ListA), 'The first variable reports the vehicle returned through Rental Mgt');
        Assert.AreEqual('HX033-7A|', Lib.ListText(ListB), 'The second variable reports the same list');
    end;
}
