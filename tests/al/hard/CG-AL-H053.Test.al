codeunit 80268 "CG-AL-H053 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure TestTotalC001()
    var
        Stats: Codeunit "CG H053 Stats";
    begin
        Assert.AreEqual(600, Stats.TotalForCustomer('C001'), 'C001 rows sum to 100+200+300=600.');
    end;

    [Test]
    procedure TestTotalC002()
    var
        Stats: Codeunit "CG H053 Stats";
    begin
        Assert.AreEqual(125, Stats.TotalForCustomer('C002'), 'C002 rows sum to 50+75=125.');
    end;

    [Test]
    procedure TestTotalC003()
    var
        Stats: Codeunit "CG H053 Stats";
    begin
        Assert.AreEqual(1000, Stats.TotalForCustomer('C003'), 'C003 has a single 1000 row.');
    end;

    [Test]
    procedure TestUnknownCustomerIsZero()
    var
        Stats: Codeunit "CG H053 Stats";
    begin
        Assert.AreEqual(0, Stats.TotalForCustomer('XXX'), 'No matching rows must yield 0.');
    end;
}
