codeunit 84961 "CG Proof Seed Read Test"
{
    // H-35c rerun 1: the seeding app (c6a1e0f0-...-0011) is left installed by the write, so its Module-scoped
    // IsolatedStorage survives the ordinary cleanup. Only its own code can read that scope, reached here without a
    // dependency through Codeunit.Run(74901), whose OnRun errors while the seed is present.
    // Gone iff: the app is installed and the seed is absent; or the app is neither installed nor published (the golden
    // restore removed the app and every row it owned). Published but not installed is NOT gone: an uninstall alone can
    // keep the app's data.
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure Gone()
    var
        Installed: Record "NAV App Installed App";
        Published: Record "Published Application";
        AppId: Guid;
        SeedGone: Boolean;
    begin
        Evaluate(AppId, 'c6a1e0f0-0000-4000-8000-000000000011');
        Installed.SetRange("App ID", AppId);
        Published.SetRange(ID, AppId);
        if not Installed.IsEmpty() then
            SeedGone := Codeunit.Run(74901)
        else
            SeedGone := Published.IsEmpty();
        Assert.IsTrue(SeedGone, 'the seeded state is still there');
    end;
}
