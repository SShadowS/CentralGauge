codeunit 86380 "HX046 Lease Extension Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure ExtensionAfterShortMonthKeepsDay()
    begin
        Prepare();
        InitLease('HX46-1', 20270131D, 3);

        HX46Extend('HX46-1', 3);
        Assert.AreEqual(6, LineCount('HX46-1'), 'A 3-month lease extended by 3 months has 6 schedule lines');
        AssertDue('HX46-1', 40000, 20270430D);
        AssertDue('HX46-1', 50000, 20270531D);
        AssertDue('HX46-1', 60000, 20270630D);
    end;

    [Test]
    procedure ThirtiethAfterFebruary()
    begin
        Prepare();
        InitLease('HX46-2', 20261130D, 3);

        HX46Extend('HX46-2', 3);
        Assert.AreEqual(6, LineCount('HX46-2'), 'A 3-month lease extended by 3 months has 6 schedule lines');
        AssertDue('HX46-2', 40000, 20270228D);
        AssertDue('HX46-2', 50000, 20270330D);
        AssertDue('HX46-2', 60000, 20270430D);
    end;

    [Test]
    procedure MidMonthStartUnchanged()
    begin
        Prepare();
        InitLease('HX46-3', 20270115D, 2);

        HX46Extend('HX46-3', 2);
        Assert.AreEqual(4, LineCount('HX46-3'), 'A 2-month lease extended by 2 months has 4 schedule lines');
        AssertDue('HX46-3', 30000, 20270315D);
        AssertDue('HX46-3', 40000, 20270415D);
    end;

    [Test]
    procedure LeapYearFebruary()
    begin
        Prepare();
        InitLease('HX46-4', 20271231D, 2);

        HX46Extend('HX46-4', 2);
        Assert.AreEqual(4, LineCount('HX46-4'), 'A 2-month lease extended by 2 months has 4 schedule lines');
        AssertDue('HX46-4', 30000, 20280229D);
        AssertDue('HX46-4', 40000, 20280331D);
    end;

    [Test]
    procedure ExtendTwiceKeepsDay()
    begin
        Prepare();
        InitLease('HX46-5', 20270131D, 3);

        HX46Extend('HX46-5', 1);
        HX46Extend('HX46-5', 1);
        Assert.AreEqual(5, LineCount('HX46-5'), 'A 3-month lease extended twice by 1 month has 5 schedule lines');
        AssertDue('HX46-5', 40000, 20270430D);
        AssertDue('HX46-5', 50000, 20270531D);
    end;

    [Test]
    procedure MonthsAndLinesUpdated()
    var
        Contract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
        i: Integer;
    begin
        Prepare();
        InitLease('HX46-6', 20270115D, 2);

        HX46Extend('HX46-6', 2);
        Contract.Get('HX46-6');
        Assert.AreEqual(4, Contract.Months, 'Months of a 2-month lease extended by 2 months');
        Assert.AreEqual(4, LineCount('HX46-6'), 'A 2-month lease extended by 2 months has 4 schedule lines');
        for i := 1 to 4 do
            Assert.IsTrue(ScheduleLine.Get('HX46-6', i * 10000), StrSubstNo('Schedule line %1 exists', i * 10000));
        ScheduleLine.Get('HX46-6', 10000);
        Assert.AreEqual(20270115D, ScheduleLine."Due Date", 'Original line 10000 keeps its due date');
        Assert.AreEqual(102, ScheduleLine.Amount, 'Original line 10000 keeps its amount');
        ScheduleLine.Get('HX46-6', 20000);
        Assert.AreEqual(20270215D, ScheduleLine."Due Date", 'Original line 20000 keeps its due date');
        Assert.AreEqual(102, ScheduleLine.Amount, 'Original line 20000 keeps its amount');
    end;

    [Test]
    procedure NonPositiveExtensionRefused()
    var
        Contract: Record "CGR Lease Contract";
        Runner: Codeunit "HX046 Extend Runner";
        Ok: Boolean;
    begin
        Prepare();
        InitLease('HX46-7', 20270115D, 2);
        Commit();

        Runner.SetExtension('HX46-7', 0);
        Ok := Runner.Run();
        Assert.IsFalse(Ok, 'Extending a lease by 0 months is refused');
        Assert.AreEqual('Lease HX46-7 can only be extended by at least one month.', GetLastErrorText(), 'The refusal names the lease');
        Assert.AreEqual(2, LineCount('HX46-7'), 'A refused extension adds no schedule line');
        Contract.Get('HX46-7');
        Assert.AreEqual(2, Contract.Months, 'A refused extension keeps the lease''s Months');
    end;

    [Test]
    procedure ExtensionAmountsAsToday()
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        Prepare();
        InitLease('HX46-8', 20270115D, 2);

        HX46Extend('HX46-8', 1);
        ScheduleLine.Get('HX46-8', 30000);
        Assert.AreEqual(103.00, ScheduleLine.Amount, 'The added line is priced with the rate of the extended lease: 100 x 1.03');
    end;

    [Test]
    procedure MissingLeaseRaises()
    var
        Runner: Codeunit "HX046 Extend Runner";
        Ok: Boolean;
    begin
        Prepare();
        RemoveLease('HX46-NONE');
        Commit();

        Runner.SetExtension('HX46-NONE', 1);
        Ok := Runner.Run();
        Assert.IsFalse(Ok, 'Extending a lease that does not exist fails');
        Assert.AreEqual('The CGR Lease Contract does not exist. Identification fields and values: No.=''HX46-NONE''', GetLastErrorText(), 'The not-found error reaches the caller');
        Assert.AreEqual(0, LineCount('HX46-NONE'), 'A failed extension adds no schedule line');
    end;

    local procedure HX46Extend(LeaseNo: Code[20]; ExtraMonths: Integer)
    var
        Runner: Codeunit "HX046 Extend Runner";
        Ok: Boolean;
    begin
        Commit();
        Runner.SetExtension(LeaseNo, ExtraMonths);
        Ok := Runner.Run();
        Assert.IsTrue(Ok, StrSubstNo('Extending %1 by %2 months succeeds: %3', LeaseNo, ExtraMonths, GetLastErrorText()));
    end;

    local procedure AssertDue(LeaseNo: Code[20]; LineNo: Integer; Expected: Date)
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        Assert.IsTrue(ScheduleLine.Get(LeaseNo, LineNo), StrSubstNo('Schedule line %1 of %2 exists', LineNo, LeaseNo));
        Assert.AreEqual(Expected, ScheduleLine."Due Date", StrSubstNo('Due date of line %1 of %2: expected %3, got %4', LineNo, LeaseNo, Format(Expected, 0, 9), Format(ScheduleLine."Due Date", 0, 9)));
    end;

    local procedure LineCount(LeaseNo: Code[20]): Integer
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        ScheduleLine.SetRange("Contract No.", LeaseNo);
        exit(ScheduleLine.Count());
    end;

    local procedure Prepare()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := 0.01;
        Setup.Modify();
        SessionContext.Reset();
    end;

    local procedure RemoveLease(LeaseNo: Code[20])
    var
        Contract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        ScheduleLine.SetRange("Contract No.", LeaseNo);
        ScheduleLine.DeleteAll();
        if Contract.Get(LeaseNo) then
            Contract.Delete();
    end;

    local procedure InitLease(LeaseNo: Code[20]; StartDate: Date; Months: Integer)
    var
        Contract: Record "CGR Lease Contract";
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        RemoveLease(LeaseNo);
        Contract.Init();
        Contract."No." := LeaseNo;
        Contract."Vehicle No." := 'HX046-V';
        Contract."Customer Name" := 'HX046 Customer';
        Contract."Start Date" := StartDate;
        Contract.Months := Months;
        Contract."Base Rate" := 100;
        Contract.Insert();
        LeaseMgt.CreateSchedule(LeaseNo);
    end;
}
