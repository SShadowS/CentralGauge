codeunit 84966 "CG Proof Seed Write Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure Seed()
    var
        Installed: Record "NAV App Installed App";
        AppId: Guid;
    begin
        Evaluate(AppId, 'c6a1e0f0-0000-4000-8000-000000000041');
        Installed.SetRange("App ID", AppId);
        Assert.IsFalse(Installed.IsEmpty(), 'the global app is installed');
    end;
}
