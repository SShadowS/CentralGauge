codeunit 80079 "CGR Lease Invoice Naive Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure InvoicesLinesDueUpToDate()
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        ScheduleLine: Record "CGR Lease Schedule Line";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20270301D, 20270531D);
        CreateLeaseWithSchedule('T-LIN-L01', 20270301D, 3, 100);

        Assert.AreEqual(2, LeaseInvoicing.InvoiceDueLines('T-LIN-L01', 20270415D), 'March and April are due');
        InvoiceLine.SetRange("Contract No.", 'T-LIN-L01');
        Assert.AreEqual(2, InvoiceLine.Count(), 'Two invoice lines');
        InvoiceLine.Get('T-LIN-L01', 10000);
        Assert.AreEqual(20270301D, InvoiceLine."Invoice Date", 'A working due date is the invoice date');
        Assert.AreEqual(103.00, InvoiceLine.Amount, 'Installment amount');
        Assert.AreEqual('T-LIN-V01', InvoiceLine."Vehicle No.", 'Vehicle from the lease');
        Assert.AreEqual('Test Customer', InvoiceLine."Customer Name", 'Customer from the lease');
        ScheduleLine.Get('T-LIN-L01', 20000);
        Assert.IsTrue(ScheduleLine.Invoiced, 'April schedule line invoiced');
        ScheduleLine.Get('T-LIN-L01', 30000);
        Assert.IsFalse(ScheduleLine.Invoiced, 'May schedule line not yet invoiced');

        Assert.AreEqual(0, LeaseInvoicing.InvoiceDueLines('T-LIN-L01', 20270415D), 'Invoiced lines are not invoiced again');
    end;

    [Test]
    procedure NonWorkingDueDateMovesToNextWorkingDay()
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20270301D, 20270531D);
        Lib.AddNonWorkingDay(20270503D);
        CreateLeaseWithSchedule('T-LIN-L02', 20270301D, 3, 100);

        Assert.AreEqual(3, LeaseInvoicing.InvoiceDueLines('T-LIN-L02', 20270531D), 'All three lines are due');
        InvoiceLine.Get('T-LIN-L02', 30000);
        Assert.AreEqual(20270501D, InvoiceLine."Due Date", 'Due on Saturday 1 May');
        Assert.AreEqual(20270504D, InvoiceLine."Invoice Date", 'Weekend and Monday holiday skipped');
    end;

    [Test]
    procedure InvoiceAmountUsesSetupPrecision()
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(1, '', 3);
        Lib.ClearNonWorkingDays(20270301D, 20270531D);
        CreateLeaseWithSchedule('T-LIN-L03', 20270301D, 3, 101);

        LeaseInvoicing.InvoiceDueLines('T-LIN-L03', 20270301D);
        InvoiceLine.Get('T-LIN-L03', 10000);
        Assert.AreEqual(104.00, InvoiceLine.Amount, '104.03 rounded to whole units');
    end;

    [Test]
    procedure HandledLinesAreNotInserted()
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        ScheduleLine: Record "CGR Lease Schedule Line";
        Subscribers: Codeunit "CGR Test Library";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20270301D, 20270531D);
        CreateLeaseWithSchedule('T-LIN-L04', 20270301D, 3, 100);
        Subscribers.HandleLeaseInvoiceLines(true);
        BindSubscription(Subscribers);

        Assert.AreEqual(2, LeaseInvoicing.InvoiceDueLines('T-LIN-L04', 20270415D), 'Handled lines still count as invoiced');
        UnbindSubscription(Subscribers);
        InvoiceLine.SetRange("Contract No.", 'T-LIN-L04');
        Assert.AreEqual(0, InvoiceLine.Count(), 'A handled line is not inserted');
        ScheduleLine.SetRange("Contract No.", 'T-LIN-L04');
        ScheduleLine.SetRange(Invoiced, true);
        Assert.AreEqual(2, ScheduleLine.Count(), 'Handled schedule lines are marked invoiced');
        Assert.AreEqual(0, Subscribers.LeaseInvoiceLinesSeen(), 'No after event for a handled line');
    end;

    [Test]
    procedure AfterEventSeesEveryCreatedLine()
    var
        Subscribers: Codeunit "CGR Test Library";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20270301D, 20270531D);
        CreateLeaseWithSchedule('T-LIN-L05', 20270301D, 3, 100);
        Subscribers.HandleLeaseInvoiceLines(false);
        BindSubscription(Subscribers);

        Assert.AreEqual(3, LeaseInvoicing.InvoiceDueLines('T-LIN-L05', 20270531D), 'Three lines invoiced');
        UnbindSubscription(Subscribers);
        Assert.AreEqual(3, Subscribers.LeaseInvoiceLinesSeen(), 'One after event per created line');
    end;

    [Test]
    procedure ArchiveFindsInvoiceLine()
    var
        Spy: Codeunit "CGR Lease Invoice Naive Spy";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20270301D, 20270531D);
        CreateLeaseWithSchedule('T-LIN-L06', 20270301D, 3, 100);
        BindSubscription(Spy);

        Assert.AreEqual(3, LeaseInvoicing.InvoiceDueLines('T-LIN-L06', 20270531D), 'Three lines invoiced');
        UnbindSubscription(Spy);
        Assert.AreEqual(3, Spy.ArchivedLineCount(), 'Every invoice line can be read in the after event');
    end;

    local procedure CreateLeaseWithSchedule(LeaseNo: Code[20]; StartDate: Date; Months: Integer; BaseRate: Decimal)
    var
        Contract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
        InvoiceLine: Record "CGR Lease Invoice Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        InvoiceLine.SetRange("Contract No.", LeaseNo);
        InvoiceLine.DeleteAll();
        ScheduleLine.SetRange("Contract No.", LeaseNo);
        ScheduleLine.DeleteAll();
        if Contract.Get(LeaseNo) then
            Contract.Delete();
        Contract.Init();
        Contract."No." := LeaseNo;
        Contract."Vehicle No." := 'T-LIN-V' + CopyStr(LeaseNo, 8);
        Contract."Customer Name" := 'Test Customer';
        Contract."Start Date" := StartDate;
        Contract.Months := Months;
        Contract."Base Rate" := BaseRate;
        Contract.Insert();
        LeaseMgt.CreateSchedule(LeaseNo);
    end;
}
