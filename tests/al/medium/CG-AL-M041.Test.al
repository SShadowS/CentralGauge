codeunit 80041 "CG-AL-M041 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure TestTotalAmountFlowFieldAggregatesChildAmounts()
    var
        Header: Record "CG FF Header";
        Line: Record "CG FF Line";
    begin
        Header.DeleteAll();
        Line.DeleteAll();

        Header.Init();
        Header."No." := 'H1';
        Header.Description := 'Header for FlowField sum test';
        Header.Insert();

        Line.Init();
        Line."Entry No." := 1;
        Line."Header No." := 'H1';
        Line.Amount := 100;
        Line.Insert();

        Line.Init();
        Line."Entry No." := 2;
        Line."Header No." := 'H1';
        Line.Amount := 250;
        Line.Insert();

        Line.Init();
        Line."Entry No." := 3;
        Line."Header No." := 'H1';
        Line.Amount := 50;
        Line.Insert();

        Header.Get('H1');
        Header.CalcFields("Total Amount");
        Assert.AreEqual(400, Header."Total Amount", 'Total Amount FlowField should sum the three child Line amounts (100 + 250 + 50)');

        Line.DeleteAll();
        Header.DeleteAll();
    end;

    [Test]
    procedure TestTotalAmountWithoutLinesIsZero()
    var
        Header: Record "CG FF Header";
        Line: Record "CG FF Line";
    begin
        Header.DeleteAll();
        Line.DeleteAll();

        Header.Init();
        Header."No." := 'H2';
        Header.Description := 'Header with no lines';
        Header.Insert();

        Header.Get('H2');
        Header.CalcFields("Total Amount");
        Assert.AreEqual(0, Header."Total Amount", 'Header with no child lines should yield Total Amount = 0');

        Header.DeleteAll();
    end;

    [Test]
    procedure TestTotalAmountIsolatedPerHeader()
    var
        Header: Record "CG FF Header";
        Line: Record "CG FF Line";
    begin
        Header.DeleteAll();
        Line.DeleteAll();

        Header.Init();
        Header."No." := 'HA';
        Header.Insert();

        Header.Init();
        Header."No." := 'HB';
        Header.Insert();

        Line.Init();
        Line."Entry No." := 1;
        Line."Header No." := 'HA';
        Line.Amount := 100;
        Line.Insert();

        Line.Init();
        Line."Entry No." := 2;
        Line."Header No." := 'HB';
        Line.Amount := 999;
        Line.Insert();

        Header.Get('HA');
        Header.CalcFields("Total Amount");
        Assert.AreEqual(100, Header."Total Amount", 'HA should aggregate only its own line (100), not HB''s line (999)');

        Header.Get('HB');
        Header.CalcFields("Total Amount");
        Assert.AreEqual(999, Header."Total Amount", 'HB should aggregate only its own line (999)');

        Line.DeleteAll();
        Header.DeleteAll();
    end;
}
