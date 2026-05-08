codeunit 80035 "CG-AL-M035 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        Demo: Codeunit "CG HttpClient Cert Demo";

    [Test]
    procedure TestSetAndCaptureWithFalse()
    var
        Result: Boolean;
    begin
        // Compile_pass validates HttpClient.UseServerCertificateValidation method exists
        // and that SetAndCapture captures the return value (statement form fails compile
        // per microsoft/AL#7993). Runtime: confirm the call returns a Boolean.
        Result := Demo.SetAndCapture(false);
        Assert.IsFalse(Result <> false, 'SetAndCapture(false) should return false (the new current value)');
    end;

    [Test]
    procedure TestSetAndCaptureWithTrue()
    var
        Result: Boolean;
    begin
        Result := Demo.SetAndCapture(true);
        Assert.IsTrue(Result, 'SetAndCapture(true) should return true (the new current value)');
    end;
}
