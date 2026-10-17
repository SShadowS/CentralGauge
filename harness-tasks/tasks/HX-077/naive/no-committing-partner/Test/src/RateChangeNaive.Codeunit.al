codeunit 80127 "CGR Rate Change Naive"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure ChangeRepricesOpenLines()
    var
        Contract: Record "CGR Lease Contract";
        Line: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        RateChange: Codeunit "CGR Lease Rate Change";
        Partner: Codeunit "CGR Rate Change Partner";
        ContractNo: Code[20];
    begin
        PrepareNaiveTest();
        ContractNo := NewNaiveLease('HX077-N02');
        LeaseMgt.InvoiceLine(ContractNo, 10000);
        Partner.WatchLease(ContractNo);
        BindSubscription(Partner);

        Assert.AreEqual(5, RateChange.ChangeBaseRate(ContractNo, 150), 'Five lines repriced');

        Assert.AreEqual(100, Partner.ReceivedOldRate(), 'The partner receives the old rate');
        Assert.AreEqual(150, Partner.ReceivedNewRate(), 'The partner receives the new rate');
        Contract.Get(ContractNo);
        Assert.AreEqual(150, Contract."Base Rate", 'The lease gets the new base rate');
        Line.Get(ContractNo, 10000);
        Assert.AreEqual(106, Line.Amount, 'The invoiced line keeps its amount');
        Line.Get(ContractNo, 20000);
        Assert.AreEqual(159, Line.Amount, 'An open line gets the new rate');
    end;

    [Test]
    procedure RefusingPartnerStopsChange()
    var
        Contract: Record "CGR Lease Contract";
        Partner: Codeunit "CGR Rate Change Partner";
        Runner: Codeunit "CGR Rate Change Test Runner";
        ContractNo: Code[20];
    begin
        PrepareNaiveTest();
        ContractNo := NewNaiveLease('HX077-N03');
        Partner.WatchLease(ContractNo);
        Partner.RefuseWhenAsked();
        BindSubscription(Partner);
        Runner.SetRateChange(ContractNo, 150);

        Commit();
        Assert.IsFalse(Runner.Run(), 'The refusal makes the change fail');
        Assert.AreEqual(StrSubstNo('Partner refused the rate change of lease %1.', ContractNo), GetLastErrorText(), 'The partner error');
        Contract.Get(ContractNo);
        Assert.AreEqual(100, Contract."Base Rate", 'The base rate is unchanged');
    end;

    [Test]
    procedure ZeroRateIsRefused()
    var
        RateChange: Codeunit "CGR Lease Rate Change";
        ContractNo: Code[20];
    begin
        PrepareNaiveTest();
        ContractNo := NewNaiveLease('HX077-N04');

        asserterror RateChange.ChangeBaseRate(ContractNo, 0);
        Assert.AreEqual(StrSubstNo('Lease %1 needs a base rate above zero.', ContractNo), GetLastErrorText(), 'Zero is refused');
    end;

    local procedure PrepareNaiveTest()
    begin
        WorkDate(20270115D);
        Lib.SetV2Setup(0.01, '', 3);
    end;

    local procedure NewNaiveLease(VehicleNo: Code[20]): Code[20]
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := Lib.CreateLease(VehicleNo, 20270115D, 6, 100);
        LeaseMgt.CreateSchedule(ContractNo);
        exit(ContractNo);
    end;
}
