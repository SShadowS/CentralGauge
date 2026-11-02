codeunit 87300 "HX092 Billing Match Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure Scenario01()
    var
        C: Code[20];
    begin
        C := 'HX092-01';
        HX092Reset(C, 92001, 0);
        HX092Billing(92001, 10);
        HX092Day(C, 10, 4);
        HX092Day(C, 20, 4);
        HX092Day(C, 30, 4);

        HX092Match(92001, C, 10, 30);

        HX092AssertLine(C, 10, 4, 92001, 'S1 line 10');
        HX092AssertLine(C, 20, 4, 92001, 'S1 line 20');
        HX092AssertLine(C, 30, 4, 0, 'S1 line 30');
        HX092AssertOpen(92001, 2, 'S1');
        HX092Reset(C, 92001, 0);
    end;

    [Test]
    procedure Scenario02()
    var
        C: Code[20];
    begin
        C := 'HX092-02';
        HX092Reset(C, 92002, 0);
        HX092Billing(92002, 10);
        HX092Day(C, 10, 4);
        HX092Day(C, 20, 7);
        HX092Day(C, 30, 2);

        HX092Match(92002, C, 10, 30);

        HX092AssertLine(C, 10, 4, 92002, 'S2 line 10');
        HX092AssertLine(C, 20, 7, 0, 'S2 line 20');
        HX092AssertLine(C, 30, 2, 92002, 'S2 line 30');
        HX092AssertOpen(92002, 4, 'S2');
        HX092Reset(C, 92002, 0);
    end;

    [Test]
    procedure Scenario03()
    var
        C: Code[20];
    begin
        C := 'HX092-03';
        HX092Reset(C, 92003, 0);
        HX092Billing(92003, 10);
        HX092Day(C, 10, 3);
        HX092Day(C, 20, 3);
        HX092Day(C, 30, 3);

        HX092Match(92003, C, 10, 30);

        HX092AssertLine(C, 10, 3, 92003, 'S3 line 10');
        HX092AssertLine(C, 20, 3, 92003, 'S3 line 20');
        HX092AssertLine(C, 30, 3, 92003, 'S3 line 30');
        HX092AssertOpen(92003, 1, 'S3');
        HX092Reset(C, 92003, 0);
    end;

    [Test]
    procedure Scenario04()
    var
        C: Code[20];
    begin
        C := 'HX092-04';
        HX092Reset(C, 92004, 0);
        HX092Billing(92004, 10);
        HX092Day(C, 10, 5);
        HX092Day(C, 20, 5);

        HX092Match(92004, C, 10, 20);

        HX092AssertLine(C, 10, 5, 92004, 'S4 line 10');
        HX092AssertLine(C, 20, 5, 92004, 'S4 line 20');
        HX092AssertOpen(92004, 0, 'S4');
        HX092Reset(C, 92004, 0);
    end;

    [Test]
    procedure Scenario05()
    var
        C: Code[20];
    begin
        C := 'HX092-05';
        HX092Reset(C, 92005, 0);
        HX092Billing(92005, 10);
        HX092Day(C, 10, 8);
        HX092Day(C, 20, 2);
        HX092Match(92005, C, 10, 10);
        HX092AssertLine(C, 10, 8, 92005, 'S5 setup line 10');

        HX092Match(92005, C, 10, 20);

        HX092AssertLine(C, 10, 8, 92005, 'S5 line 10');
        HX092AssertLine(C, 20, 2, 92005, 'S5 line 20');
        HX092AssertOpen(92005, 0, 'S5');
        HX092Reset(C, 92005, 0);
    end;

    [Test]
    procedure Scenario06()
    var
        C: Code[20];
    begin
        C := 'HX092-06';
        HX092Reset(C, 92006, 0);
        HX092Billing(92006, 10);
        HX092Day(C, 10, 2);
        HX092Day(C, 20, 3);
        HX092Substitute(HX092Vehicle(C, 10));

        HX092Match(92006, C, 10, 20);

        HX092AssertLine(C, 10, 2, 0, 'S6 substituted line 10');
        HX092AssertLine(C, 20, 3, 92006, 'S6 line 20');
        HX092AssertOpen(92006, 7, 'S6');
        HX092Reset(C, 92006, 0);
    end;

    [Test]
    procedure Scenario07()
    var
        C: Code[20];
    begin
        C := 'HX092-07';
        HX092Reset(C, 92007, 0);
        HX092Billing(92007, 10);
        HX092Day(C, 10, 12);

        HX092Match(92007, C, 10, 10);

        HX092AssertLine(C, 10, 10, 92007, 'S7 line 10');
        HX092AssertOpen(92007, 0, 'S7');
        HX092Reset(C, 92007, 0);
    end;

    [Test]
    procedure Scenario08()
    var
        C: Code[20];
    begin
        C := 'HX092-08';
        HX092Reset(C, 92008, 0);
        HX092Billing(92008, 10);
        HX092Day(C, 10, 4);
        HX092Substitute(HX092Vehicle(C, 10));

        HX092Match(92008, C, 10, 10);

        HX092AssertLine(C, 10, 4, 92008, 'S8 substituted single line 10');
        HX092AssertOpen(92008, 6, 'S8');
        HX092Reset(C, 92008, 0);
    end;

    [Test]
    procedure Scenario09()
    var
        C: Code[20];
    begin
        C := 'HX092-09';
        HX092Reset(C, 92091, 92092);
        HX092Billing(92091, 10);
        HX092Billing(92092, 5);
        HX092Day(C, 10, 4);
        HX092Day(C, 20, 4);
        HX092Day(C, 30, 3);
        HX092Day(C, 40, 3);

        HX092Match(92091, C, 10, 20);
        HX092Match(92092, C, 30, 40);

        HX092AssertLine(C, 10, 4, 92091, 'S9 line 10');
        HX092AssertLine(C, 20, 4, 92091, 'S9 line 20');
        HX092AssertLine(C, 30, 3, 92092, 'S9 line 30');
        HX092AssertLine(C, 40, 3, 0, 'S9 line 40');
        HX092AssertOpen(92091, 2, 'S9 billing 1');
        HX092AssertOpen(92092, 2, 'S9 billing 2');
        HX092Reset(C, 92091, 92092);
    end;

    local procedure HX092Reset(ContractNo: Code[20]; BillingNo1: Integer; BillingNo2: Integer)
    var
        BillingLine: Record "CGR Billing Line";
        DayLine: Record "CGR Contract Day Line";
        Substitution: Record "CGR Vehicle Substitution";
    begin
        DayLine.SetRange("Contract No.", ContractNo);
        DayLine.DeleteAll();
        if BillingLine.Get(BillingNo1) then
            BillingLine.Delete();
        if (BillingNo2 <> 0) and BillingLine.Get(BillingNo2) then
            BillingLine.Delete();
        Substitution.SetFilter("Vehicle No.", ContractNo + '*');
        Substitution.DeleteAll();
    end;

    local procedure HX092Billing(LineNo: Integer; Days: Decimal)
    var
        BillingLine: Record "CGR Billing Line";
    begin
        BillingLine.Init();
        BillingLine."Line No." := LineNo;
        BillingLine."Customer Name" := 'Corporate customer';
        BillingLine.Days := Days;
        BillingLine.Insert();
    end;

    local procedure HX092Vehicle(ContractNo: Code[20]; LineNo: Integer): Code[20]
    begin
        exit(CopyStr(ContractNo + '-' + Format(LineNo), 1, 20));
    end;

    local procedure HX092Day(ContractNo: Code[20]; LineNo: Integer; Days: Decimal)
    var
        DayLine: Record "CGR Contract Day Line";
    begin
        DayLine.Init();
        DayLine."Contract No." := ContractNo;
        DayLine."Line No." := LineNo;
        DayLine."Vehicle No." := HX092Vehicle(ContractNo, LineNo);
        DayLine.Days := Days;
        DayLine.Insert();
    end;

    local procedure HX092Substitute(VehicleNo: Code[20])
    var
        Substitution: Record "CGR Vehicle Substitution";
    begin
        Substitution.Init();
        Substitution."Vehicle No." := VehicleNo;
        Substitution."Substitute Vehicle No." := CopyStr(VehicleNo + 'S', 1, 20);
        Substitution.Insert();
    end;

    local procedure HX092Match(BillingLineNo: Integer; ContractNo: Code[20]; FromLine: Integer; ToLine: Integer)
    var
        DayLines: Record "CGR Contract Day Line";
        BillingMatch: Codeunit "CGR Billing Match";
    begin
        DayLines.SetRange("Contract No.", ContractNo);
        DayLines.SetRange("Line No.", FromLine, ToLine);
        BillingMatch.MatchLines(BillingLineNo, DayLines);
    end;

    local procedure HX092AssertLine(ContractNo: Code[20]; LineNo: Integer; ExpectedMatched: Decimal; ExpectedBillingNo: Integer; Msg: Text)
    var
        DayLine: Record "CGR Contract Day Line";
    begin
        Assert.IsTrue(DayLine.Get(ContractNo, LineNo), Msg + ': day line is stored');
        Assert.AreEqual(ExpectedMatched, DayLine."Matched Days", Msg + ': Matched Days');
        Assert.AreEqual(ExpectedBillingNo, DayLine."Billing Line No.", Msg + ': Billing Line No.');
    end;

    local procedure HX092AssertOpen(BillingLineNo: Integer; Expected: Decimal; Msg: Text)
    var
        BillingMatch: Codeunit "CGR Billing Match";
    begin
        Assert.AreEqual(Expected, BillingMatch.OpenDays(BillingLineNo), Msg + ': open days on the billing line');
    end;
}
