codeunit 86123 "HX033 Shift Returns R4"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "HX033 Shift Library";

    [Test]
    procedure CallerEditsDoNotChangeShift()
    var
        Shift: Codeunit "CGR Shift Returns";
        CallerList: List of [Code[20]];
        FreshList: List of [Code[20]];
    begin
        Lib.Prepare();
        Lib.InitVehicle('HX033-4A');
        Lib.InitVehicle('HX033-4B');
        Lib.RentAndReturn('HX033-C4A', 'HX033-4A', '');
        Lib.RentAndReturn('HX033-C4B', 'HX033-4B', '');

        Shift.ReturnedVehicles(CallerList);
        CallerList.Add('X');
        CallerList.RemoveAt(1);

        Shift.ReturnedVehicles(FreshList);
        Assert.AreEqual('HX033-4A|HX033-4B|', Lib.ListText(FreshList), 'Changing the list a caller got does not change the shift');
    end;
}
