codeunit 80056 "CGR Lease Invoicing Tests"
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
        LeaseMgt: Codeunit "CGR Lease Mgt";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
        LeaseNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20270301D, 20270531D);
        LeaseNo := Lib.CreateLease('T-LI-001', 20270301D, 3, 100);
        LeaseMgt.CreateSchedule(LeaseNo);

        Assert.AreEqual(2, LeaseInvoicing.InvoiceDueLines(LeaseNo, 20270415D), 'March and April are due');
        InvoiceLine.SetRange("Contract No.", LeaseNo);
        Assert.AreEqual(2, InvoiceLine.Count(), 'Two invoice lines');
        InvoiceLine.Get(LeaseNo, 10000);
        Assert.AreEqual(20270301D, InvoiceLine."Invoice Date", 'A working due date is the invoice date');
        Assert.AreEqual(103.00, InvoiceLine.Amount, 'Installment amount');
        Assert.AreEqual('T-LI-001', InvoiceLine."Vehicle No.", 'Vehicle from the lease');
        Assert.AreEqual('Test Customer', InvoiceLine."Customer Name", 'Customer from the lease');
        ScheduleLine.Get(LeaseNo, 20000);
        Assert.IsTrue(ScheduleLine.Invoiced, 'April schedule line invoiced');
        ScheduleLine.Get(LeaseNo, 30000);
        Assert.IsFalse(ScheduleLine.Invoiced, 'May schedule line not yet invoiced');

        Assert.AreEqual(0, LeaseInvoicing.InvoiceDueLines(LeaseNo, 20270415D), 'Invoiced lines are not invoiced again');
    end;

    [Test]
    procedure NonWorkingDueDateMovesToNextWorkingDay()
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
        LeaseNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20270301D, 20270531D);
        Lib.AddNonWorkingDay(20270503D);
        LeaseNo := Lib.CreateLease('T-LI-002', 20270301D, 3, 100);
        LeaseMgt.CreateSchedule(LeaseNo);

        Assert.AreEqual(3, LeaseInvoicing.InvoiceDueLines(LeaseNo, 20270531D), 'All three lines are due');
        InvoiceLine.Get(LeaseNo, 30000);
        Assert.AreEqual(20270501D, InvoiceLine."Due Date", 'Due on Saturday 1 May');
        Assert.AreEqual(20270504D, InvoiceLine."Invoice Date", 'Weekend and Monday holiday skipped');
    end;

    [Test]
    procedure InvoiceAmountUsesSetupPrecision()
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
        LeaseNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(1, '', 3);
        Lib.ClearNonWorkingDays(20270301D, 20270531D);
        LeaseNo := Lib.CreateLease('T-LI-003', 20270301D, 3, 101);
        LeaseMgt.CreateSchedule(LeaseNo);

        LeaseInvoicing.InvoiceDueLines(LeaseNo, 20270301D);
        InvoiceLine.Get(LeaseNo, 10000);
        Assert.AreEqual(104.00, InvoiceLine.Amount, '104.03 rounded to whole units');
    end;

    [Test]
    procedure HandledLinesAreNotInserted()
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        ScheduleLine: Record "CGR Lease Schedule Line";
        Subscribers: Codeunit "CGR Test Library";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
        LeaseNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20270301D, 20270531D);
        LeaseNo := Lib.CreateLease('T-LI-004', 20270301D, 3, 100);
        LeaseMgt.CreateSchedule(LeaseNo);
        Subscribers.HandleLeaseInvoiceLines(true);
        BindSubscription(Subscribers);

        Assert.AreEqual(2, LeaseInvoicing.InvoiceDueLines(LeaseNo, 20270415D), 'Handled lines still count as invoiced');
        InvoiceLine.SetRange("Contract No.", LeaseNo);
        Assert.AreEqual(0, InvoiceLine.Count(), 'A handled line is not inserted');
        ScheduleLine.SetRange("Contract No.", LeaseNo);
        ScheduleLine.SetRange(Invoiced, true);
        Assert.AreEqual(2, ScheduleLine.Count(), 'Handled schedule lines are marked invoiced');
        Assert.AreEqual(0, Subscribers.LeaseInvoiceLinesSeen(), 'No after event for a handled line');
    end;

    [Test]
    procedure AfterEventSeesEveryCreatedLine()
    var
        Subscribers: Codeunit "CGR Test Library";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
        LeaseNo: Code[20];
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20270301D, 20270531D);
        LeaseNo := Lib.CreateLease('T-LI-005', 20270301D, 3, 100);
        LeaseMgt.CreateSchedule(LeaseNo);
        Subscribers.HandleLeaseInvoiceLines(false);
        BindSubscription(Subscribers);

        Assert.AreEqual(3, LeaseInvoicing.InvoiceDueLines(LeaseNo, 20270531D), 'Three lines invoiced');
        Assert.AreEqual(3, Subscribers.LeaseInvoiceLinesSeen(), 'One after event per created line');
    end;
}
