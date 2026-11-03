codeunit 79651 "CG Proof Seed Read Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure Gone()
    var
        Installed: Record "NAV App Installed App";
        AppId: Guid;
    begin
        Evaluate(AppId, 'c6a1e0f0-0000-4000-8000-000000000041');
        Installed.SetRange("App ID", AppId);
        Assert.IsTrue(Installed.IsEmpty(), 'the global app is still installed');
    end;
}
