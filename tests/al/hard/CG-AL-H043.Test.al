codeunit 80258 "CG-AL-H043 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure TestSameHostBasic()
    var
        Guard: Codeunit "CG H043 Url Guard";
    begin
        Assert.IsTrue(
            Guard.SameHost('https://api.contoso.com/v1/orders', 'https://api.contoso.com'),
            'Same host with different path must be allowed.');
    end;

    [Test]
    procedure TestDifferentHostHomograph()
    var
        Guard: Codeunit "CG H043 Url Guard";
    begin
        Assert.IsFalse(
            Guard.SameHost('https://api.contoso.com.evil.com/v1', 'https://api.contoso.com'),
            'Suffix-spoof host (api.contoso.com.evil.com) must be rejected.');
    end;

    [Test]
    procedure TestSameHostDifferentPort()
    var
        Guard: Codeunit "CG H043 Url Guard";
    begin
        // Host equality must hold even when ServiceUrl carries a non-default port and BaseUrl does not.
        // This is exactly where a "is-base-of" prefix check fails: the ports differ, so a strict prefix
        // comparison would reject this same-host pair. The host-equality helper must accept it.
        Assert.IsTrue(
            Guard.SameHost('https://api.contoso.com:9000/v1/orders', 'https://api.contoso.com'),
            'Same host on non-default port must still be allowed.');
    end;

    [Test]
    procedure TestSameHostDeeperPath()
    var
        Guard: Codeunit "CG H043 Url Guard";
    begin
        Assert.IsTrue(
            Guard.SameHost('https://api.contoso.com/v2/items/42', 'https://api.contoso.com/v1'),
            'Same host with unrelated path segments must still be allowed (host equality, not path prefix).');
    end;

    [Test]
    procedure TestCompletelyDifferentHost()
    var
        Guard: Codeunit "CG H043 Url Guard";
    begin
        Assert.IsFalse(
            Guard.SameHost('https://attacker.example.net/x', 'https://api.contoso.com'),
            'Unrelated host must be rejected.');
    end;
}
