codeunit 86130 "HX033 Shift Returns R10"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "HX033 Shift Library";

    [Test]
    procedure DamagedListedOnceInOrder()
    var
        Shift: Codeunit "CGR Shift Returns";
        Damaged: List of [Code[20]];
    begin
        Lib.Prepare();
        Lib.AssertShiftStartsEmpty();
        Lib.InitVehicle('HX033-10A');
        Lib.InitVehicle('HX033-10B');
        Lib.InitVehicle('HX033-10C');

        Lib.RentAndReturn('HX033-C10A1', 'HX033-10A', 'Dent');
        Lib.RentAndReturn('HX033-C10B', 'HX033-10B', 'Scratch');
        Lib.RepairOpenDamages('HX033-10A');
        Lib.RentAndReturn('HX033-C10A2', 'HX033-10A', 'Dent');
        Lib.RentAndReturn('HX033-C10C1', 'HX033-10C', '');
        Lib.RentAndReturn('HX033-C10C2', 'HX033-10C', 'Scratch');

        Shift.DamagedVehicles(Damaged);
        Assert.AreEqual('HX033-10A|HX033-10B|HX033-10C|', Lib.ListText(Damaged), 'Damaged vehicles are listed once, in the order of their first damaged return, also after a clean return');
    end;
}
