codeunit 80124 "CGR Rate Change Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        CommitProhibitedTxt: Label 'Commit is prohibited in the current scope. The operation cannot continue. Contact your system administrator.', Locked = true;

    [Test]
    procedure ChangeRepricesLinesNotInvoiced()
    var
        Contract: Record "CGR Lease Contract";
        Line: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        RateChange: Codeunit "CGR Lease Rate Change";
        ContractNo: Code[20];
    begin
        PrepareRateTest();
        ContractNo := NewScheduledLease('HX077-V01', 6, 100);
        LeaseMgt.InvoiceLine(ContractNo, 10000);
        AssertEveryLineAmount(ContractNo, 6, 106);

        Assert.AreEqual(5, RateChange.ChangeBaseRate(ContractNo, 150), 'Five lines are not invoiced and are repriced');

        Contract.Get(ContractNo);
        Assert.AreEqual(150, Contract."Base Rate", 'The lease gets the new base rate');
        Assert.AreEqual(159, LeaseMgt.MonthlyRate(150, 6), 'Arrange: the six-month rate of 150 is 159.00');
        AssertLineAmount(ContractNo, 20000, 159);
        AssertLineAmount(ContractNo, 30000, 159);
        AssertLineAmount(ContractNo, 40000, 159);
        AssertLineAmount(ContractNo, 50000, 159);
        AssertLineAmount(ContractNo, 60000, 159);
        Line.Get(ContractNo, 10000);
        Assert.IsTrue(Line.Invoiced, 'Line 10000 stays invoiced');
        Assert.AreEqual(106, Line.Amount, 'The invoiced line keeps its amount');
    end;

    [Test]
    procedure ChangeKeepsTwoInvoicedLines()
    var
        Contract: Record "CGR Lease Contract";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        RateChange: Codeunit "CGR Lease Rate Change";
        ContractNo: Code[20];
    begin
        PrepareRateTest();
        ContractNo := NewScheduledLease('HX077-V02', 4, 200);
        LeaseMgt.InvoiceLine(ContractNo, 10000);
        LeaseMgt.InvoiceLine(ContractNo, 20000);
        AssertEveryLineAmount(ContractNo, 4, 208);

        Assert.AreEqual(2, RateChange.ChangeBaseRate(ContractNo, 50), 'Two lines are not invoiced and are repriced');

        Contract.Get(ContractNo);
        Assert.AreEqual(50, Contract."Base Rate", 'The lease gets the lower base rate');
        Assert.AreEqual(52, LeaseMgt.MonthlyRate(50, 4), 'Arrange: the four-month rate of 50 is 52.00');
        AssertLineAmount(ContractNo, 10000, 208);
        AssertLineAmount(ContractNo, 20000, 208);
        AssertLineAmount(ContractNo, 30000, 52);
        AssertLineAmount(ContractNo, 40000, 52);
    end;

    [Test]
    procedure ChangeToSmallestRateRepricesAll()
    var
        Contract: Record "CGR Lease Contract";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        RateChange: Codeunit "CGR Lease Rate Change";
        ContractNo: Code[20];
    begin
        PrepareRateTest();
        ContractNo := NewScheduledLease('HX077-V03', 3, 100);
        AssertEveryLineAmount(ContractNo, 3, 103);

        Assert.AreEqual(3, RateChange.ChangeBaseRate(ContractNo, 0.01), 'Every line is repriced when none is invoiced');

        Contract.Get(ContractNo);
        Assert.AreEqual(0.01, Contract."Base Rate", 'A base rate of 0.01 is above zero and is stored');
        Assert.AreEqual(0.01, LeaseMgt.MonthlyRate(0.01, 3), 'Arrange: the three-month rate of 0.01 is 0.01');
        AssertEveryLineAmount(ContractNo, 3, 0.01);
    end;

    [Test]
    procedure PartnerAskedWithOldRateBeforeChange()
    var
        Contract: Record "CGR Lease Contract";
        Entry: Record "CGR Outbox Entry";
        Partner: Codeunit "CGR Rate Change Partner";
        RateChange: Codeunit "CGR Lease Rate Change";
        ContractNo: Code[20];
    begin
        PrepareRateTest();
        Lib.ClearOutbox('HX077-M04');
        ContractNo := NewScheduledLease('HX077-V04', 6, 100);
        Partner.WatchLease(ContractNo);
        Partner.QueueMarkerWhenAsked('HX077-M04', false);
        BindSubscription(Partner);

        RateChange.ChangeBaseRate(ContractNo, 150);

        Assert.AreEqual(1, Partner.TimesAsked(), 'The partner is asked once');
        Assert.AreEqual(ContractNo, Partner.ReceivedContractNo(), 'The partner receives the lease');
        Assert.AreEqual(100, Partner.ReceivedOldRate(), 'The partner receives the old base rate');
        Assert.AreEqual(150, Partner.ReceivedNewRate(), 'The partner receives the new base rate');
        Assert.AreEqual(100, Partner.StoredRateWhenAsked(), 'The lease still has its old base rate when the partner is asked');
        Contract.Get(ContractNo);
        Assert.AreEqual(150, Contract."Base Rate", 'The change is stored after the partner agreed');
        Entry.SetRange("Vehicle No.", 'HX077-M04');
        Assert.AreEqual(1, Entry.Count(), 'The partner work of an accepted change is kept');
    end;

    [Test]
    procedure PartnerRefusalKeepsLease()
    var
        Contract: Record "CGR Lease Contract";
        Partner: Codeunit "CGR Rate Change Partner";
        Runner: Codeunit "CGR Rate Change Test Runner";
        ContractNo: Code[20];
        Ok: Boolean;
    begin
        PrepareRateTest();
        ContractNo := NewScheduledLease('HX077-V05', 6, 100);
        AssertEveryLineAmount(ContractNo, 6, 106);
        Partner.WatchLease(ContractNo);
        Partner.RefuseWhenAsked();
        BindSubscription(Partner);
        Runner.SetRateChange(ContractNo, 150);

        Commit();
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'A refusing partner makes the change fail');
        Assert.AreEqual(StrSubstNo('Partner refused the rate change of lease %1.', ContractNo), GetLastErrorText(), 'The change fails with the partner error');
        Assert.AreEqual(1, Partner.TimesAsked(), 'The partner was asked');
        Contract.Get(ContractNo);
        Assert.AreEqual(100, Contract."Base Rate", 'A refused change keeps the old base rate');
        AssertEveryLineAmount(ContractNo, 6, 106);
    end;

    [Test]
    procedure CommittingPartnerFailsAndKeepsNothing()
    var
        Contract: Record "CGR Lease Contract";
        Entry: Record "CGR Outbox Entry";
        Partner: Codeunit "CGR Rate Change Partner";
        Runner: Codeunit "CGR Rate Change Test Runner";
        AcceptedNo: Code[20];
        CommittingNo: Code[20];
        Ok: Boolean;
    begin
        PrepareRateTest();
        Lib.ClearOutbox('HX077-M06');
        Lib.ClearOutbox('HX077-M07');
        AcceptedNo := NewScheduledLease('HX077-V06', 6, 100);
        CommittingNo := NewScheduledLease('HX077-V07', 6, 100);
        AssertEveryLineAmount(CommittingNo, 6, 106);
        BindSubscription(Partner);

        Partner.WatchLease(AcceptedNo);
        Partner.QueueMarkerWhenAsked('HX077-M06', false);
        Runner.SetRateChange(AcceptedNo, 150);
        Commit();
        Ok := Runner.Run();
        Assert.IsTrue(Ok, 'Control: a partner that does not commit lets the change succeed');
        Entry.SetRange("Vehicle No.", 'HX077-M06');
        Assert.AreEqual(1, Entry.Count(), 'Control: the marker of the accepted change is kept');
        Contract.Get(AcceptedNo);
        Assert.AreEqual(150, Contract."Base Rate", 'Control: the accepted change is stored');

        Partner.WatchLease(CommittingNo);
        Partner.QueueMarkerWhenAsked('HX077-M07', true);
        Runner.SetRateChange(CommittingNo, 150);
        Commit();
        Ok := Runner.Run();
        Assert.IsFalse(Ok, 'A partner that commits makes the change fail');
        Assert.AreEqual(CommitProhibitedTxt, GetLastErrorText(), 'The change fails with the platform error');
        Assert.AreEqual(1, Partner.TimesAsked(), 'The committing partner was asked');
        Entry.SetRange("Vehicle No.", 'HX077-M07');
        Assert.IsTrue(Entry.IsEmpty(), 'The committing partner work is not kept');
        Contract.Get(CommittingNo);
        Assert.AreEqual(100, Contract."Base Rate", 'The failed change keeps the old base rate');
        AssertEveryLineAmount(CommittingNo, 6, 106);
    end;

    [Test]
    procedure ZeroRateRefused()
    var
        RateChange: Codeunit "CGR Lease Rate Change";
        ContractNo: Code[20];
    begin
        PrepareRateTest();
        ContractNo := NewScheduledLease('HX077-V08', 6, 100);

        asserterror RateChange.ChangeBaseRate(ContractNo, 0);
        Assert.AreEqual(StrSubstNo('Lease %1 needs a base rate above zero.', ContractNo), GetLastErrorText(), 'A base rate of 0 is refused');
    end;

    [Test]
    procedure NegativeRateRefused()
    var
        RateChange: Codeunit "CGR Lease Rate Change";
        ContractNo: Code[20];
    begin
        PrepareRateTest();
        ContractNo := NewScheduledLease('HX077-V09', 6, 100);

        asserterror RateChange.ChangeBaseRate(ContractNo, -1);
        Assert.AreEqual(StrSubstNo('Lease %1 needs a base rate above zero.', ContractNo), GetLastErrorText(), 'A negative base rate is refused');
    end;

    [Test]
    procedure UnknownLeaseFails()
    var
        Contract: Record "CGR Lease Contract";
        RateChange: Codeunit "CGR Lease Rate Change";
    begin
        PrepareRateTest();
        Assert.IsFalse(Contract.Get('HX077-NOLEASE'), 'Arrange: the lease does not exist');

        asserterror RateChange.ChangeBaseRate('HX077-NOLEASE', 150);
    end;

    local procedure PrepareRateTest()
    begin
        WorkDate(20270115D);
        Lib.SetV2Setup(0.01, '', 3);
    end;

    local procedure NewScheduledLease(VehicleNo: Code[20]; Months: Integer; BaseRate: Decimal): Code[20]
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
        ContractNo: Code[20];
    begin
        ContractNo := Lib.CreateLease(VehicleNo, 20270115D, Months, BaseRate);
        LeaseMgt.CreateSchedule(ContractNo);
        exit(ContractNo);
    end;

    local procedure AssertLineAmount(ContractNo: Code[20]; LineNo: Integer; Expected: Decimal)
    var
        Line: Record "CGR Lease Schedule Line";
    begin
        Line.Get(ContractNo, LineNo);
        Assert.AreEqual(Expected, Line.Amount, StrSubstNo('Amount of schedule line %1', LineNo));
    end;

    local procedure AssertEveryLineAmount(ContractNo: Code[20]; LineCount: Integer; Expected: Decimal)
    var
        Line: Record "CGR Lease Schedule Line";
    begin
        Line.SetRange("Contract No.", ContractNo);
        Assert.AreEqual(LineCount, Line.Count(), 'Number of schedule lines');
        Line.SetFilter(Amount, '<>%1', Expected);
        Assert.IsTrue(Line.IsEmpty(), StrSubstNo('Every schedule line has the amount %1', Expected));
    end;
}
