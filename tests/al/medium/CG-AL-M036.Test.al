codeunit 80036 "CG-AL-M036 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        Demo: Codeunit "CG WriteWithSecrets Demo";

    [Test]
    procedure TestWriteSecretsViaDictReturnsTrue()
    begin
        Assert.IsTrue(Demo.WriteSecretsViaDict(), 'Dictionary-overload WriteWithSecretsTo should return true on success');
    end;

    [Test]
    procedure TestWriteSecretsViaPathReturnsTrue()
    begin
        Assert.IsTrue(Demo.WriteSecretsViaPath(), 'Path-overload WriteWithSecretsTo should return true on success');
    end;
}
