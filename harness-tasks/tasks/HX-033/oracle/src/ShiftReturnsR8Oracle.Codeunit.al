codeunit 86127 "HX033 Shift Returns R8"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "HX033 Shift Library";

    [Test]
    procedure ClearShiftEmptiesBoth()
    var
        ShiftA: Codeunit "CGR Shift Returns";
        ShiftB: Codeunit "CGR Shift Returns";
        ReturnedBefore: List of [Code[20]];
        DamagedBefore: List of [Code[20]];
        ReturnedAfter: List of [Code[20]];
        DamagedAfter: List of [Code[20]];
    begin
        Lib.Prepare();
        Lib.InitVehicle('HX033-8A');
        Lib.RentAndReturn('HX033-C8A', 'HX033-8A', 'Dent');
        ShiftA.ReturnedVehicles(ReturnedBefore);
        ShiftA.DamagedVehicles(DamagedBefore);
        Assert.AreEqual('HX033-8A|', Lib.ListText(ReturnedBefore), 'Precondition: the returned list holds the vehicle');
        Assert.AreEqual('HX033-8A|', Lib.ListText(DamagedBefore), 'Precondition: the damaged list holds the vehicle');

        ShiftB.ClearShift();

        ShiftA.ReturnedVehicles(ReturnedAfter);
        ShiftA.DamagedVehicles(DamagedAfter);
        Assert.AreEqual(0, ReturnedAfter.Count(), 'ClearShift empties the returned list');
        Assert.AreEqual(0, DamagedAfter.Count(), 'ClearShift empties the damaged list');
    end;
}
