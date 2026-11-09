codeunit 80603 "CGR Due One Line Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure RefusedLeaseIsNotInvoiced()
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
        InvoiceLine: Record "CGR Lease Invoice Line";
        Spy: Codeunit "CGR Due One Line Spy";
        DueInvoicing: Codeunit "CGR Lease Due Invoicing";
        RefusedLeaseNo: Code[20];
        AcceptedLeaseNo: Code[20];
    begin
        OneLinePrepare(20250415D);
        RefusedLeaseNo := OneLineLease('HX153-N1R', 20250301D, 1);
        AcceptedLeaseNo := OneLineLease('HX153-N1A', 20250301D, 1);
        Spy.RefuseLease(RefusedLeaseNo);
        BindSubscription(Spy);

        Commit();
        Assert.AreEqual(1, DueInvoicing.InvoiceDue(20250415D), 'Only the accepted lease is invoiced');
        UnbindSubscription(Spy);

        ScheduleLine.Get(RefusedLeaseNo, 10000);
        Assert.IsFalse(ScheduleLine.Invoiced, 'The refused line is not invoiced');
        InvoiceLine.SetRange("Contract No.", RefusedLeaseNo);
        Assert.AreEqual(0, InvoiceLine.Count(), 'A refused lease has no invoice line');
        ScheduleLine.Get(AcceptedLeaseNo, 10000);
        Assert.IsTrue(ScheduleLine.Invoiced, 'The other lease is invoiced');
    end;

    [Test]
    procedure InvoicesLineDueOnTheDate()
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
        DueInvoicing: Codeunit "CGR Lease Due Invoicing";
        LeaseNo: Code[20];
    begin
        OneLinePrepare(20250301D);
        LeaseNo := OneLineLease('HX153-N1D', 20250301D, 2);

        Commit();
        Assert.AreEqual(1, DueInvoicing.InvoiceDue(20250301D), 'The lease is invoiced');
        ScheduleLine.Get(LeaseNo, 10000);
        Assert.IsTrue(ScheduleLine.Invoiced, 'The line due on the date is invoiced');
    end;

    [Test]
    procedure InvoiceLineCarriesAmount()
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
        InvoiceLine: Record "CGR Lease Invoice Line";
        DueInvoicing: Codeunit "CGR Lease Due Invoicing";
        LeaseNo: Code[20];
    begin
        OneLinePrepare(20250415D);
        LeaseNo := OneLineLease('HX153-N1W', 20250301D, 1);

        Commit();
        DueInvoicing.InvoiceDue(20250415D);

        ScheduleLine.Get(LeaseNo, 10000);
        Assert.IsTrue(InvoiceLine.Get(LeaseNo, 10000), 'The line has its invoice line');
        Assert.AreEqual(ScheduleLine.Amount, InvoiceLine.Amount, 'Invoice amount');
    end;

    local procedure OneLinePrepare(AsOf: Date)
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        WorkDate(20250415D);
        Lib.SetV2Setup(0.01, '', 3);
        ScheduleLine.SetRange(Invoiced, false);
        ScheduleLine.SetFilter("Due Date", '..%1', AsOf);
        ScheduleLine.ModifyAll(Invoiced, true);
    end;

    local procedure OneLineLease(VehicleNo: Code[20]; StartDate: Date; Months: Integer): Code[20]
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
        LeaseNo: Code[20];
    begin
        LeaseNo := Lib.CreateLease(VehicleNo, StartDate, Months, 100);
        LeaseMgt.CreateSchedule(LeaseNo);
        exit(LeaseNo);
    end;
}
