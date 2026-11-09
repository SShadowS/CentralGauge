codeunit 80606 "CGR Due Flags Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure RefusalLeavesLeaseUninvoiced()
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
        Spy: Codeunit "CGR Due Flags Spy";
        DueInvoicing: Codeunit "CGR Lease Due Invoicing";
        RefusedLeaseNo: Code[20];
        AcceptedLeaseNo: Code[20];
    begin
        FlagsPrepare(20250415D);
        RefusedLeaseNo := FlagsLease('HX153-N3R', 20250301D, 2);
        AcceptedLeaseNo := FlagsLease('HX153-N3A', 20250301D, 1);
        Spy.RefuseLine(RefusedLeaseNo, 20000);
        BindSubscription(Spy);

        Commit();
        Assert.AreEqual(1, DueInvoicing.InvoiceDue(20250415D), 'Only the accepted lease is invoiced');
        UnbindSubscription(Spy);

        ScheduleLine.Get(RefusedLeaseNo, 10000);
        Assert.IsFalse(ScheduleLine.Invoiced, 'No line of the refused lease is invoiced');
        ScheduleLine.Get(AcceptedLeaseNo, 10000);
        Assert.IsTrue(ScheduleLine.Invoiced, 'The other lease is invoiced');
    end;

    [Test]
    procedure DueDateBoundaries()
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
        DueInvoicing: Codeunit "CGR Lease Due Invoicing";
        LeaseNo: Code[20];
    begin
        FlagsPrepare(20250401D);
        LeaseNo := FlagsLease('HX153-N3D', 20250301D, 3);

        Commit();
        Assert.AreEqual(1, DueInvoicing.InvoiceDue(20250401D), 'The lease counts once');
        ScheduleLine.Get(LeaseNo, 20000);
        Assert.IsTrue(ScheduleLine.Invoiced, 'The line due on the date is invoiced');
        ScheduleLine.Get(LeaseNo, 30000);
        Assert.IsFalse(ScheduleLine.Invoiced, 'The later line is not invoiced');
    end;

    local procedure FlagsPrepare(AsOf: Date)
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        WorkDate(20250415D);
        Lib.SetV2Setup(0.01, '', 3);
        ScheduleLine.SetRange(Invoiced, false);
        ScheduleLine.SetFilter("Due Date", '..%1', AsOf);
        ScheduleLine.ModifyAll(Invoiced, true);
    end;

    local procedure FlagsLease(VehicleNo: Code[20]; StartDate: Date; Months: Integer): Code[20]
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
        LeaseNo: Code[20];
    begin
        LeaseNo := Lib.CreateLease(VehicleNo, StartDate, Months, 100);
        LeaseMgt.CreateSchedule(LeaseNo);
        exit(LeaseNo);
    end;
}
