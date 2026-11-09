codeunit 80605 "CGR Due Early Date Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure InvoicesEveryDueLine()
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
        DueInvoicing: Codeunit "CGR Lease Due Invoicing";
        LeaseNo: Code[20];
    begin
        EarlyPrepare(20250415D);
        LeaseNo := EarlyLease('HX153-N2A', 20250201D, 2);

        Commit();
        Assert.AreEqual(1, DueInvoicing.InvoiceDue(20250415D), 'One lease is invoiced');
        ScheduleLine.SetRange("Contract No.", LeaseNo);
        ScheduleLine.SetRange(Invoiced, true);
        Assert.AreEqual(2, ScheduleLine.Count(), 'Both due lines are invoiced');
    end;

    [Test]
    procedure WritesInvoiceLines()
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
        InvoiceLine: Record "CGR Lease Invoice Line";
        DueInvoicing: Codeunit "CGR Lease Due Invoicing";
        LeaseNo: Code[20];
    begin
        EarlyPrepare(20250415D);
        LeaseNo := EarlyLease('HX153-N2W', 20250201D, 2);

        Commit();
        DueInvoicing.InvoiceDue(20250415D);

        InvoiceLine.SetRange("Contract No.", LeaseNo);
        Assert.AreEqual(2, InvoiceLine.Count(), 'One invoice line per schedule line');
        ScheduleLine.Get(LeaseNo, 20000);
        InvoiceLine.Get(LeaseNo, 20000);
        Assert.AreEqual(ScheduleLine.Amount, InvoiceLine.Amount, 'Invoice amount');
    end;

    local procedure EarlyPrepare(AsOf: Date)
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        WorkDate(20250415D);
        Lib.SetV2Setup(0.01, '', 3);
        ScheduleLine.SetRange(Invoiced, false);
        ScheduleLine.SetFilter("Due Date", '..%1', AsOf);
        ScheduleLine.ModifyAll(Invoiced, true);
    end;

    local procedure EarlyLease(VehicleNo: Code[20]; StartDate: Date; Months: Integer): Code[20]
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
        LeaseNo: Code[20];
    begin
        LeaseNo := Lib.CreateLease(VehicleNo, StartDate, Months, 100);
        LeaseMgt.CreateSchedule(LeaseNo);
        exit(LeaseNo);
    end;
}
