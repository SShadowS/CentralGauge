codeunit 84991 "CGR Hostile Detect State"
{
    // M1-30 hostile row: fails if a previous execution's committed state survived.
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure NoVehicleLeftBehind()
    var
        Vehicle: Record "CGR Vehicle";
    begin
        Assert.IsFalse(Vehicle.Get('HOSTILE-STATE'), 'a previous execution left state behind');
    end;
}
