codeunit 80020 "CG-AL-H019 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        InternalService: Codeunit "CG Internal Service";

    [Test]
    procedure TestGetPublicData_ReturnsValue()
    var
        Result: Text;
    begin
        Result := InternalService.GetPublicData();

        Assert.AreNotEqual('', Result, 'GetPublicData should return a value');
    end;

    [Test]
    procedure TestProcessSensitiveData_ProcessesInput()
    var
        Result: Text;
    begin
        // NonDebuggable procedure should still be callable
        Result := InternalService.ProcessSensitiveData('input data');

        Assert.AreNotEqual('', Result, 'Should process and return data');
    end;

    [Test]
    procedure TestTryProcessData_ReportsSuccess()
    var
        Success: Boolean;
    begin
        // Replaces TestTryProcessData_Success and TestTryProcessData_NoException,
        // which both called this and then asserted Assert.IsTrue(true, ...) - so a
        // TryFunction that reported FAILURE satisfied them both.
        Success := InternalService.TryProcessData();

        // Spec item 3: 'Returns true on success'. Nothing is asserted about how the
        // helper is written or what it returns.
        Assert.IsTrue(Success, 'The processing attempt was reported as unsuccessful');
    end;

    [Test]
    procedure TestCodeunitAccessible()
    var
        Result: Text;
    begin
        // Being in the same app, Internal access works - the compile proves that
        // much on its own. Calling through and asserting on the answer is what
        // makes the test observe anything at runtime; it previously asserted
        // Assert.IsTrue(true, ...).
        Result := InternalService.GetPublicData();

        Assert.AreNotEqual('', Result, 'An internal codeunit reached from inside the same app should still answer');
    end;
}
