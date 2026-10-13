codeunit 86128 "HX033 Shift Returns R9"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "HX033 Shift Library";

    [Test]
    procedure DamagedListIsACopy()
    var
        Shift: Codeunit "CGR Shift Returns";
        CallerList: List of [Code[20]];
        FreshList: List of [Code[20]];
    begin
        Lib.Prepare();
        Lib.AssertShiftStartsEmpty();
        Lib.InitVehicle('HX033-9A');
        Lib.RentAndReturn('HX033-C9A', 'HX033-9A', 'Dent');

        Shift.DamagedVehicles(CallerList);
        CallerList.Add('X');

        Shift.DamagedVehicles(FreshList);
        Assert.AreEqual('HX033-9A|', Lib.ListText(FreshList), 'Changing the damaged list a caller got does not change the shift');
    end;
}
