namespace CGTestM031;

using CGFqnDemo;

codeunit 80031 "CG-AL-M031 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        Runner: Codeunit CGFqnRunner;

    [Test]
    procedure TestRunWorkerByFqnReturnsTrue()
    begin
        Assert.IsTrue(Runner.RunWorkerByFqn(), 'Codeunit.Run with namespace-qualified FQN string should return true');
    end;

    [Test]
    procedure TestOpenArchiveTableByFqnReturnsCorrectId()
    begin
        Assert.AreEqual(70037, Runner.OpenArchiveTableByFqn(), 'RecordRef.Open with namespace-qualified FQN string should resolve to table 70037');
    end;
}
