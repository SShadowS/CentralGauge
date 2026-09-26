codeunit 84890 "CGR Hostile Leave State"
{
    // M1-30 hostile row: commits a vehicle outside test isolation so the next
    // execution could see it. mock-detect-state must not.
    Subtype = Test;
    TestPermissions = Disabled;
    RequiredTestIsolation = Disabled;

    var
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure LeaveVehicleBehind()
    begin
        Lib.CreateVehicle('HOSTILE-STATE', 1000, Enum::"CGR Maintenance Strategy"::Default);
        Commit();
    end;
}
