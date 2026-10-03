codeunit 85680 "HX011 Lease Rounding Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure InstallmentsUseSetupPrecision()
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        InitHX11(0.05);
        NewHX11Lease('HX11-A', 3, 100.01);

        LeaseMgt.CreateSchedule('HX11-A');
        AssertSchedule('HX11-A', 103.00, 103.00, 103.05);
    end;

    [Test]
    procedure InstallmentsRoundUpToPrecision()
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        InitHX11(0.05);
        NewHX11Lease('HX11-B', 3, 100.03);

        LeaseMgt.CreateSchedule('HX11-B');
        AssertSchedule('HX11-B', 103.05, 103.05, 103.00);
    end;

    [Test]
    procedure InvoiceLinesAddUpToRoundedTotal()
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
        Total: Decimal;
    begin
        InitHX11(0.05);
        NewHX11Lease('HX11-C', 3, 100.01);
        LeaseMgt.CreateSchedule('HX11-C');

        Assert.AreEqual(3, LeaseInvoicing.InvoiceDueLines('HX11-C', 20270501D), 'All three installments are due');
        AssertInvoiceLine('HX11-C', 10000, 103.00);
        AssertInvoiceLine('HX11-C', 20000, 103.00);
        AssertInvoiceLine('HX11-C', 30000, 103.05);
        InvoiceLine.SetRange("Contract No.", 'HX11-C');
        Assert.AreEqual(3, InvoiceLine.Count(), 'One invoice line per installment');
        InvoiceLine.FindSet();
        repeat
            Total += InvoiceLine.Amount;
        until InvoiceLine.Next() = 0;
        Assert.AreEqual(309.05, Total, 'The invoice lines add up to the rounded lease total');
    end;

    [Test]
    procedure InvoiceBillsScheduledAmount()
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        InitHX11(0.01);
        NewHX11Lease('HX11-D', 3, 100.01);
        LeaseMgt.CreateSchedule('HX11-D');
        AssertSchedule('HX11-D', 103.01, 103.01, 103.01);

        InitHX11(1);
        LeaseInvoicing.InvoiceDueLines('HX11-D', 20270501D);
        AssertInvoiceLine('HX11-D', 10000, 103.01);
        AssertInvoiceLine('HX11-D', 20000, 103.01);
        AssertInvoiceLine('HX11-D', 30000, 103.01);
    end;

    [Test]
    procedure MonthlyRateUsesSetupPrecision()
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        InitHX11(1);

        Assert.AreEqual(104.00, LeaseMgt.MonthlyRate(101, 3), '104.03 is rounded to whole units');

        InitHX11(0.05);
        Assert.AreEqual(104.05, LeaseMgt.MonthlyRate(101, 3), 'The rate uses the precision in effect when it is computed');
    end;

    [Test]
    procedure ZeroPrecisionKeepsCents()
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        InitHX11(0);
        NewHX11Lease('HX11-F', 3, 100.01);

        LeaseMgt.CreateSchedule('HX11-F');
        AssertSchedule('HX11-F', 103.01, 103.01, 103.01);
        LeaseInvoicing.InvoiceDueLines('HX11-F', 20270301D);
        AssertInvoiceLine('HX11-F', 10000, 103.01);
        Assert.AreEqual(103.01, LeaseMgt.MonthlyRate(100.01, 3), 'Without a precision the monthly rate is rounded to cents');
    end;

    [Test]
    procedure WholeUnitScheduleInvoices()
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        InitHX11(1);
        NewHX11Lease('HX11-G', 3, 101);

        LeaseMgt.CreateSchedule('HX11-G');
        AssertSchedule('HX11-G', 104, 104, 104);
        LeaseInvoicing.InvoiceDueLines('HX11-G', 20270501D);
        AssertInvoiceLine('HX11-G', 10000, 104);
        AssertInvoiceLine('HX11-G', 20000, 104);
        AssertInvoiceLine('HX11-G', 30000, 104);
    end;

    [Test]
    procedure RescheduleUsesCurrentPrecision()
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        InitHX11(0.01);
        NewHX11Lease('HX11-H', 3, 100.01);
        LeaseMgt.CreateSchedule('HX11-H');

        InitHX11(0.05);
        LeaseMgt.CreateSchedule('HX11-H');
        AssertSchedule('HX11-H', 103.00, 103.00, 103.05);
    end;

    local procedure InitHX11(RoundingPrecision: Decimal)
    var
        Setup: Record "CGR Setup";
        NonWorkingDay: Record "CGR Non-Working Day";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := RoundingPrecision;
        Setup.Modify();
        SessionContext.Reset();
        NonWorkingDay.SetRange("Non-Working Date", 20270301D, 20270531D);
        NonWorkingDay.DeleteAll();
    end;

    local procedure NewHX11Lease(LeaseNo: Code[20]; Months: Integer; BaseRate: Decimal)
    var
        Contract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
        InvoiceLine: Record "CGR Lease Invoice Line";
    begin
        InvoiceLine.SetRange("Contract No.", LeaseNo);
        InvoiceLine.DeleteAll();
        ScheduleLine.SetRange("Contract No.", LeaseNo);
        ScheduleLine.DeleteAll();
        if Contract.Get(LeaseNo) then
            Contract.Delete();
        Contract.Init();
        Contract."No." := LeaseNo;
        Contract."Vehicle No." := LeaseNo;
        Contract."Customer Name" := 'HX011 Customer';
        Contract."Start Date" := 20270301D;
        Contract.Months := Months;
        Contract."Base Rate" := BaseRate;
        Contract.Insert();
    end;

    local procedure AssertSchedule(LeaseNo: Code[20]; First: Decimal; Second: Decimal; Third: Decimal)
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        ScheduleLine.SetRange("Contract No.", LeaseNo);
        Assert.AreEqual(3, ScheduleLine.Count(), StrSubstNo('Lease %1 has one schedule line per month', LeaseNo));
        ScheduleLine.Get(LeaseNo, 10000);
        Assert.AreEqual(First, ScheduleLine.Amount, StrSubstNo('Lease %1, schedule line 10000: first installment', LeaseNo));
        ScheduleLine.Get(LeaseNo, 20000);
        Assert.AreEqual(Second, ScheduleLine.Amount, StrSubstNo('Lease %1, schedule line 20000: second installment', LeaseNo));
        ScheduleLine.Get(LeaseNo, 30000);
        Assert.AreEqual(Third, ScheduleLine.Amount, StrSubstNo('Lease %1, schedule line 30000: last installment takes the remainder', LeaseNo));
    end;

    local procedure AssertInvoiceLine(LeaseNo: Code[20]; ScheduleLineNo: Integer; Expected: Decimal)
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
    begin
        InvoiceLine.Get(LeaseNo, ScheduleLineNo);
        Assert.AreEqual(Expected, InvoiceLine.Amount, StrSubstNo('Lease %1, invoice line %2 bills its installment', LeaseNo, ScheduleLineNo));
    end;
}
