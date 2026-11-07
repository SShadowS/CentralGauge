codeunit 80160 "CGR Overnight Billing Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure UncommittedChangeOfCallerIsCommittedFirst()
    var
        Lease: Record "CGR Lease Contract";
        InvoiceLine: Record "CGR Lease Invoice Line";
        Runner: Codeunit "CGR Overnight Billing Runner";
        Ok: Boolean;
    begin
        WorkDate(20250415D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20250301D, 20250531D);
        HX100NewLease('HX100-P1', 20250301D);
        Runner.SetOvernightBilling('HX100-P1', 'HX100-P1', 'HX100 Renamed Customer');

        Commit();
        Ok := Runner.Run();
        Assert.IsTrue(Ok, 'The overnight billing works with an uncommitted change of its caller: ' + GetLastErrorText());
        Assert.AreEqual(1, Runner.InvoicedLeases(), 'The lease is invoiced');
        Assert.AreEqual(0, Runner.FailedLeaseCount(), 'No lease failed');
        Lease.Get('HX100-P1');
        Assert.AreEqual('HX100 Renamed Customer', Lease."Customer Name", 'The caller''s change is stored');
        InvoiceLine.SetRange("Contract No.", 'HX100-P1');
        Assert.AreEqual(2, InvoiceLine.Count(), 'March and April are invoiced');
        Assert.IsTrue(InvoiceLine.Get('HX100-P1', 10000), 'March invoice line exists');
        Assert.AreEqual('HX100 Renamed Customer', InvoiceLine."Customer Name", 'The invoice line sees the committed change');
    end;

    [Test]
    procedure CommittingArchiveKeepsNothingOfFailedLease()
    var
        Lease: Record "CGR Lease Contract";
        InvoiceLine: Record "CGR Lease Invoice Line";
        ScheduleLine: Record "CGR Lease Schedule Line";
        Spy: Codeunit "CGR Overnight Archive Spy";
        OvernightBilling: Codeunit "CGR Lease Overnight Billing";
        FailedLeases: List of [Code[20]];
        Invoiced: Integer;
    begin
        WorkDate(20250415D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20250301D, 20250531D);
        HX100NewLease('HX100-C1', 20250301D);
        HX100NewLease('HX100-C2', 20250301D);
        Spy.RefuseLine('HX100-C2', 20000, true);
        BindSubscription(Spy);

        Lease.SetFilter("No.", '%1|%2', 'HX100-C1', 'HX100-C2');
        Commit();
        Invoiced := OvernightBilling.BillLeasesOvernight(Lease, FailedLeases);
        UnbindSubscription(Spy);

        Assert.AreEqual(1, Invoiced, 'Only the first lease is invoiced');
        Assert.AreEqual(1, FailedLeases.Count(), 'One lease failed');
        Assert.AreEqual('HX100-C2', FailedLeases.Get(1), 'The refused lease failed');
        InvoiceLine.SetRange("Contract No.", 'HX100-C2');
        Assert.AreEqual(0, InvoiceLine.Count(), 'The failed lease keeps no invoice line, although the archive committed');
        ScheduleLine.SetRange("Contract No.", 'HX100-C2');
        ScheduleLine.SetRange(Invoiced, true);
        Assert.AreEqual(0, ScheduleLine.Count(), 'The failed lease keeps no invoiced schedule line');
        InvoiceLine.SetRange("Contract No.", 'HX100-C1');
        Assert.AreEqual(2, InvoiceLine.Count(), 'The good lease is invoiced');
    end;

    [Test]
    procedure FailedLeaseBetweenTwoGoodLeases()
    var
        Lease: Record "CGR Lease Contract";
        InvoiceLine: Record "CGR Lease Invoice Line";
        Spy: Codeunit "CGR Overnight Archive Spy";
        OvernightBilling: Codeunit "CGR Lease Overnight Billing";
        FailedLeases: List of [Code[20]];
        Invoiced: Integer;
    begin
        WorkDate(20250415D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20250301D, 20250531D);
        HX100NewLease('HX100-F1', 20250301D);
        HX100NewLease('HX100-F2', 20250301D);
        HX100NewLease('HX100-F3', 20250301D);
        Spy.RefuseLine('HX100-F2', 10000, false);
        BindSubscription(Spy);
        FailedLeases.Add('HX100-OLD');

        Lease.SetFilter("No.", '%1|%2|%3', 'HX100-F1', 'HX100-F2', 'HX100-F3');
        Commit();
        Invoiced := OvernightBilling.BillLeasesOvernight(Lease, FailedLeases);
        UnbindSubscription(Spy);

        Assert.AreEqual(2, Invoiced, 'Two of three leases are invoiced');
        Assert.AreEqual(1, FailedLeases.Count(), 'The list holds only the failure of this call');
        Assert.AreEqual('HX100-F2', FailedLeases.Get(1), 'The middle lease failed');
        InvoiceLine.SetRange("Contract No.", 'HX100-F1');
        Assert.AreEqual(2, InvoiceLine.Count(), 'The lease before the failure is invoiced');
        InvoiceLine.SetRange("Contract No.", 'HX100-F2');
        Assert.AreEqual(0, InvoiceLine.Count(), 'The failed lease keeps no invoice line');
        InvoiceLine.SetRange("Contract No.", 'HX100-F3');
        Assert.AreEqual(2, InvoiceLine.Count(), 'The lease after the failure is invoiced');
    end;

    [Test]
    procedure InvoicesFilteredLeasesUpToWorkDate()
    var
        Lease: Record "CGR Lease Contract";
        InvoiceLine: Record "CGR Lease Invoice Line";
        ScheduleLine: Record "CGR Lease Schedule Line";
        OvernightBilling: Codeunit "CGR Lease Overnight Billing";
        FailedLeases: List of [Code[20]];
        Invoiced: Integer;
    begin
        WorkDate(20250415D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20250301D, 20250531D);
        HX100NewLease('HX100-D1', 20250301D);
        HX100NewLease('HX100-D2', 20250415D);
        HX100NewLease('HX100-D9', 20250301D);

        Lease.SetFilter("No.", '%1|%2', 'HX100-D1', 'HX100-D2');
        Commit();
        Invoiced := OvernightBilling.BillLeasesOvernight(Lease, FailedLeases);

        Assert.AreEqual(2, Invoiced, 'Two leases in the filter');
        Assert.AreEqual(0, FailedLeases.Count(), 'No lease failed');
        Assert.IsTrue(InvoiceLine.Get('HX100-D1', 10000), 'March is due by the work date');
        Assert.AreEqual(103.00, InvoiceLine.Amount, 'March installment');
        Assert.IsTrue(InvoiceLine.Get('HX100-D1', 20000), 'April is due by the work date');
        Assert.AreEqual(103.00, InvoiceLine.Amount, 'April installment');
        Assert.IsFalse(InvoiceLine.Get('HX100-D1', 30000), 'May is due after the work date');
        ScheduleLine.Get('HX100-D1', 20000);
        Assert.IsTrue(ScheduleLine.Invoiced, 'April schedule line invoiced');
        ScheduleLine.Get('HX100-D1', 30000);
        Assert.IsFalse(ScheduleLine.Invoiced, 'May schedule line not invoiced');
        Assert.IsTrue(InvoiceLine.Get('HX100-D2', 10000), 'A line due on the work date is invoiced');
        Assert.IsFalse(InvoiceLine.Get('HX100-D2', 20000), 'The next month of that lease is not due');
        InvoiceLine.SetRange("Contract No.", 'HX100-D9');
        Assert.AreEqual(0, InvoiceLine.Count(), 'A lease outside the filter is not invoiced');
    end;

    [Test]
    procedure LeaseWithNothingDueStillCounts()
    var
        Lease: Record "CGR Lease Contract";
        InvoiceLine: Record "CGR Lease Invoice Line";
        OvernightBilling: Codeunit "CGR Lease Overnight Billing";
        FailedLeases: List of [Code[20]];
        Invoiced: Integer;
    begin
        WorkDate(20250415D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20250301D, 20250531D);
        HX100NewLease('HX100-N1', 20250301D);
        HX100NewLease('HX100-N2', 20250501D);

        Lease.SetFilter("No.", '%1|%2', 'HX100-N1', 'HX100-N2');
        Commit();
        Invoiced := OvernightBilling.BillLeasesOvernight(Lease, FailedLeases);

        Assert.AreEqual(2, Invoiced, 'A lease with no line due is invoiced without error and counts');
        Assert.AreEqual(0, FailedLeases.Count(), 'No lease failed');
        InvoiceLine.SetRange("Contract No.", 'HX100-N1');
        Assert.AreEqual(2, InvoiceLine.Count(), 'March and April of the first lease are invoiced');
        InvoiceLine.SetRange("Contract No.", 'HX100-N2');
        Assert.AreEqual(0, InvoiceLine.Count(), 'The lease with nothing due gets no invoice line');
    end;

    local procedure HX100NewLease(LeaseNo: Code[20]; StartDate: Date)
    var
        Lease: Record "CGR Lease Contract";
        InvoiceLine: Record "CGR Lease Invoice Line";
        ScheduleLine: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        InvoiceLine.SetRange("Contract No.", LeaseNo);
        InvoiceLine.DeleteAll();
        ScheduleLine.SetRange("Contract No.", LeaseNo);
        ScheduleLine.DeleteAll();
        if Lease.Get(LeaseNo) then
            Lease.Delete();
        Lease.Init();
        Lease."No." := LeaseNo;
        Lease."Vehicle No." := 'HX100-V';
        Lease."Customer Name" := 'HX100 Customer';
        Lease."Start Date" := StartDate;
        Lease.Months := 3;
        Lease."Base Rate" := 100;
        Lease.Insert();
        LeaseMgt.CreateSchedule(LeaseNo);
    end;
}
