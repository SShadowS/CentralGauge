codeunit 86122 "HX033 Shift Returns R3"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "HX033 Shift Library";

    [Test]
    procedure DamagedListOnlyDamaged()
    var
        DamageEntry: Record "CGR Damage Entry";
        Vehicle: Record "CGR Vehicle";
        Shift: Codeunit "CGR Shift Returns";
        Damaged: List of [Code[20]];
        Returned: List of [Code[20]];
    begin
        Lib.Prepare();
        Lib.AssertShiftStartsEmpty();
        Lib.InitVehicle('HX033-3A');
        Lib.InitVehicle('HX033-3B');

        Lib.RentAndReturn('HX033-C3A', 'HX033-3A', 'Dent');
        Lib.RentAndReturn('HX033-C3B', 'HX033-3B', '');

        Shift.DamagedVehicles(Damaged);
        Shift.ReturnedVehicles(Returned);
        Assert.AreEqual('HX033-3A|', Lib.ListText(Damaged), 'Only the vehicle returned with a damage description is in the damaged list');
        Assert.AreEqual('HX033-3A|HX033-3B|', Lib.ListText(Returned), 'Both returned vehicles are in the returned list');

        DamageEntry.SetRange("Vehicle No.", 'HX033-3A');
        Assert.IsFalse(DamageEntry.IsEmpty(), 'A damaged return still registers a damage entry in Fleet');
        Vehicle.Get('HX033-3A');
        Assert.IsTrue(Vehicle.Blocked, 'A damaged return still blocks the vehicle');
    end;
}
