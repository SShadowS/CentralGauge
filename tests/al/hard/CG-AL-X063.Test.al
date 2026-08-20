codeunit 88816 "CG-AL-X063 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure Seed()
    var
        Wide: Record "CG X063 Wide";
        Narrow: Record "CG X063 Narrow";
    begin
        Wide.DeleteAll();
        Narrow.DeleteAll();

        Wide.Init();
        Wide."Entry No." := 1;
        Wide."Label" := 'WIDE-ONE';
        Wide.Insert();

        Narrow.Init();
        Narrow."Entry No." := 1;
        Narrow.Insert();
    end;

    [Test]
    procedure ReturnsFieldTwoFromTheWideTable()
    var
        Describer: Codeunit "CG X063 Describer";
    begin
        Seed();
        Assert.AreEqual('WIDE-ONE', Describer.DescribeOf(Database::"CG X063 Wide", 1),
            'The wide table has a field 2 to return');
    end;

    [Test]
    procedure ReturnsEmptyForATableWithoutFieldTwo()
    var
        Describer: Codeunit "CG X063 Describer";
    begin
        Seed();
        Assert.AreEqual('', Describer.DescribeOf(Database::"CG X063 Narrow", 1),
            'The narrow table has no field 2, so the result is empty and no error is raised');
    end;

    [Test]
    procedure ReturnsEmptyWhenTheRowIsMissing()
    var
        Describer: Codeunit "CG X063 Describer";
    begin
        Seed();
        Assert.AreEqual('', Describer.DescribeOf(Database::"CG X063 Wide", 99),
            'A missing row yields an empty string');
        Assert.AreEqual('', Describer.DescribeOf(Database::"CG X063 Narrow", 99),
            'A missing row in the narrow table also yields an empty string');
    end;
}
