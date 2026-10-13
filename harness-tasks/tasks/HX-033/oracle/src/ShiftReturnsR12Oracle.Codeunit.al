codeunit 86132 "HX033 Shift Returns R12"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "HX033 Shift Library";

    [Test]
    procedure FailedReturnNotListed()
    var
        Shift: Codeunit "CGR Shift Returns";
        Runner: Codeunit "HX033 Return Runner";
        Returned: List of [Code[20]];
        Damaged: List of [Code[20]];
        Ok: Boolean;
    begin
        Lib.Prepare();
        Lib.AssertShiftStartsEmpty();
        Lib.InitVehicle('HX033-12A');
        Lib.RentOut('HX033-C12A', 'HX033-12A');
        Commit();

        Runner.SetReturn('HX033-C12A', 999, 'Dent');
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'A return below the start km fails');
        Assert.AreEqual('Return km 999 is below the start km 1000.', GetLastErrorText(), 'The return fails with the km error');
        Shift.ReturnedVehicles(Returned);
        Shift.DamagedVehicles(Damaged);
        Assert.AreEqual('', Lib.ListText(Returned), 'A return that failed is not in the returned list');
        Assert.AreEqual('', Lib.ListText(Damaged), 'A return that failed is not in the damaged list');
    end;
}
