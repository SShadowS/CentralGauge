codeunit 86124 "HX033 Shift Returns R5"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "HX033 Shift Library";

    [Test]
    procedure EarlierListUnchangedByLaterReturns()
    var
        Shift: Codeunit "CGR Shift Returns";
        EarlierList: List of [Code[20]];
    begin
        Lib.Prepare();
        Lib.AssertShiftStartsEmpty();
        Lib.InitVehicle('HX033-5A');
        Lib.InitVehicle('HX033-5B');
        Lib.RentAndReturn('HX033-C5A', 'HX033-5A', '');

        Shift.ReturnedVehicles(EarlierList);
        Lib.RentAndReturn('HX033-C5B', 'HX033-5B', '');

        Assert.AreEqual('HX033-5A|', Lib.ListText(EarlierList), 'A later return does not appear in a list filled earlier');
    end;
}
