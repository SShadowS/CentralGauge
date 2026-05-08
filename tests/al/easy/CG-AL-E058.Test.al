codeunit 80058 "CG-AL-E058 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        Demo: Codeunit "CG Test Isolation Demo";

    [Test]
    procedure TestDemoCodeunitCompiles()
    begin
        // The demo codeunit declares the runtime-16.0 TestType + RequiredTestIsolation
        // properties; if either property name or enum value is wrong, this app fails
        // compilation and never reaches this assertion. Reaching it confirms compile_pass.
        Assert.IsTrue(Demo.SmokeCheck(), 'Demo test codeunit smoke check should return true');
    end;
}
