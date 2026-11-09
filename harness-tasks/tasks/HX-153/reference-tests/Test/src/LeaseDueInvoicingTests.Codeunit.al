codeunit 80600 "CGR Lease Due Invoicing Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure RefusedLineKeepsWholeLeaseOpen()
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
        InvoiceLine: Record "CGR Lease Invoice Line";
        Spy: Codeunit "CGR Lease Due Refusal Spy";
        DueInvoicing: Codeunit "CGR Lease Due Invoicing";
        RefusedLeaseNo: Code[20];
        AcceptedLeaseNo: Code[20];
        LeasesInvoiced: Integer;
    begin
        HX153Prepare(20250415D);
        RefusedLeaseNo := HX153Lease('HX153-R1', 20250301D, 2);
        AcceptedLeaseNo := HX153Lease('HX153-R2', 20250301D, 1);
        Spy.RefuseScheduleLine(RefusedLeaseNo, 20000);
        BindSubscription(Spy);

        Commit();
        LeasesInvoiced := DueInvoicing.InvoiceDue(20250415D);
        UnbindSubscription(Spy);

        Assert.AreEqual(1, LeasesInvoiced, 'Only the lease the accounting app accepted is invoiced');
        ScheduleLine.Get(RefusedLeaseNo, 10000);
        Assert.IsFalse(ScheduleLine.Invoiced, 'The accepted line of a refused lease is not invoiced either');
        ScheduleLine.Get(RefusedLeaseNo, 20000);
        Assert.IsFalse(ScheduleLine.Invoiced, 'The refused line is not invoiced');
        InvoiceLine.SetRange("Contract No.", RefusedLeaseNo);
        Assert.AreEqual(0, InvoiceLine.Count(), 'A refused lease has no invoice line');
        ScheduleLine.Get(AcceptedLeaseNo, 10000);
        Assert.IsTrue(ScheduleLine.Invoiced, 'The other lease is still invoiced');
        Assert.IsTrue(InvoiceLine.Get(AcceptedLeaseNo, 10000), 'The other lease gets its invoice line');
    end;

    [Test]
    procedure InvoicesLineDueOnAsOfDate()
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
        DueInvoicing: Codeunit "CGR Lease Due Invoicing";
        LeaseNo: Code[20];
        LeasesInvoiced: Integer;
    begin
        HX153Prepare(20250301D);
        LeaseNo := HX153Lease('HX153-D1', 20250301D, 2);

        Commit();
        LeasesInvoiced := DueInvoicing.InvoiceDue(20250301D);

        Assert.AreEqual(1, LeasesInvoiced, 'A lease with a line due on AsOf is invoiced');
        ScheduleLine.Get(LeaseNo, 10000);
        Assert.IsTrue(ScheduleLine.Invoiced, 'The line due on AsOf is invoiced');
    end;

    [Test]
    procedure CountsEachLeaseOnce()
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
        DueInvoicing: Codeunit "CGR Lease Due Invoicing";
        LeaseNo: Code[20];
        LeasesInvoiced: Integer;
    begin
        HX153Prepare(20250415D);
        LeaseNo := HX153Lease('HX153-C1', 20250201D, 3);

        Commit();
        LeasesInvoiced := DueInvoicing.InvoiceDue(20250415D);

        Assert.AreEqual(1, LeasesInvoiced, 'One lease with three due lines counts once');
        ScheduleLine.SetRange("Contract No.", LeaseNo);
        ScheduleLine.SetRange(Invoiced, true);
        Assert.AreEqual(3, ScheduleLine.Count(), 'All three due lines are invoiced');
    end;

    [Test]
    procedure LeavesLaterLinesOpen()
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
        DueInvoicing: Codeunit "CGR Lease Due Invoicing";
        LeaseNo: Code[20];
        LeasesInvoiced: Integer;
    begin
        HX153Prepare(20250415D);
        LeaseNo := HX153Lease('HX153-F1', 20250301D, 3);

        Commit();
        LeasesInvoiced := DueInvoicing.InvoiceDue(20250415D);

        Assert.AreEqual(1, LeasesInvoiced, 'The lease is invoiced');
        ScheduleLine.Get(LeaseNo, 20000);
        Assert.IsTrue(ScheduleLine.Invoiced, 'The April line is due and invoiced');
        ScheduleLine.Get(LeaseNo, 30000);
        Assert.IsFalse(ScheduleLine.Invoiced, 'The May line is not due yet');
    end;

    [Test]
    procedure WritesInvoiceLinePerScheduleLine()
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
        InvoiceLine: Record "CGR Lease Invoice Line";
        DueInvoicing: Codeunit "CGR Lease Due Invoicing";
        LeaseNo: Code[20];
    begin
        HX153Prepare(20250415D);
        LeaseNo := HX153Lease('HX153-W1', 20250301D, 2);

        Commit();
        DueInvoicing.InvoiceDue(20250415D);

        InvoiceLine.SetRange("Contract No.", LeaseNo);
        Assert.AreEqual(2, InvoiceLine.Count(), 'One invoice line per invoiced schedule line');
        ScheduleLine.Get(LeaseNo, 10000);
        Assert.IsTrue(InvoiceLine.Get(LeaseNo, 10000), 'The March line has its invoice line');
        Assert.AreEqual(ScheduleLine.Amount, InvoiceLine.Amount, 'The invoice line carries the March amount');
        ScheduleLine.Get(LeaseNo, 20000);
        Assert.IsTrue(InvoiceLine.Get(LeaseNo, 20000), 'The April line has its invoice line');
        Assert.AreEqual(ScheduleLine.Amount, InvoiceLine.Amount, 'The invoice line carries the April amount');
    end;

    [Test]
    procedure ShowsNothingWithoutUserInterface()
    var
        Runner: Codeunit "CGR Lease Due Invoicing Runner";
        Ok: Boolean;
    begin
        HX153Prepare(20250415D);
        Runner.SetDueRun(20250415D);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'Without a user interface the invoicing shows nothing: ' + GetLastErrorText());
        Assert.AreEqual(0, Runner.LeasesInvoicedInDueRun(), 'Nothing is due');
    end;

    local procedure HX153Prepare(AsOf: Date)
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        WorkDate(20250415D);
        Lib.SetV2Setup(0.01, '', 3);
        ScheduleLine.SetRange(Invoiced, false);
        ScheduleLine.SetFilter("Due Date", '..%1', AsOf);
        ScheduleLine.ModifyAll(Invoiced, true);
    end;

    local procedure HX153Lease(VehicleNo: Code[20]; StartDate: Date; Months: Integer): Code[20]
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
        LeaseNo: Code[20];
    begin
        LeaseNo := Lib.CreateLease(VehicleNo, StartDate, Months, 100);
        LeaseMgt.CreateSchedule(LeaseNo);
        exit(LeaseNo);
    end;
}
