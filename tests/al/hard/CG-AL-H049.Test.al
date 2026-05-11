codeunit 80264 "CG-AL-H049 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure TestTotalForDoc1()
    var
        Totals: Codeunit "CG H049 Sales Total";
    begin
        Assert.AreEqual(60, Totals.TotalForDoc('D1'), 'D1 has rows with amounts 10+20+30=60.');
    end;

    [Test]
    procedure TestTotalForDoc2()
    var
        Totals: Codeunit "CG H049 Sales Total";
    begin
        Assert.AreEqual(300, Totals.TotalForDoc('D2'), 'D2 has rows with amounts 100+200=300.');
    end;

    [Test]
    procedure TestTotalForUnknownDocIsZero()
    var
        Totals: Codeunit "CG H049 Sales Total";
    begin
        Assert.AreEqual(0, Totals.TotalForDoc('XXX'), 'No matching rows must yield 0, not error.');
    end;
}
