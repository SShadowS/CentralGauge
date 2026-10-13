codeunit 86134 "HX033 Shift Returns R13"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "HX033 Shift Library";

    [Test]
    procedure EarlierDamagedListUnchanged()
    var
        Shift: Codeunit "CGR Shift Returns";
        EarlierList: List of [Code[20]];
        FreshList: List of [Code[20]];
    begin
        Lib.Prepare();
        Lib.AssertShiftStartsEmpty();
        Lib.InitVehicle('HX033-13A');
        Lib.InitVehicle('HX033-13B');
        Lib.RentAndReturn('HX033-C13A', 'HX033-13A', 'Dent');

        Shift.DamagedVehicles(EarlierList);
        Lib.RentAndReturn('HX033-C13B', 'HX033-13B', 'Scratch');

        Shift.DamagedVehicles(FreshList);
        Assert.AreEqual('HX033-13A|HX033-13B|', Lib.ListText(FreshList), 'Precondition: the later damaged return is in the shift');
        Assert.AreEqual('HX033-13A|', Lib.ListText(EarlierList), 'A later damaged return does not appear in a damaged list filled earlier');
    end;
}
