codeunit 80151 "CGR Lease Night Run Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure UnsavedChangeOfCallerIsSavedFirst()
    var
        Lease: Record "CGR Lease Contract";
        InvoiceLine: Record "CGR Lease Invoice Line";
        Runner: Codeunit "CGR Lease Night Run Runner";
        Ok: Boolean;
    begin
        WorkDate(20300415D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20300301D, 20300531D);
        HX90NewLease('HX090-P1', 20300301D);
        Runner.SetNightRun('HX090-P1', 'HX090-P1', 'HX090 Renamed Customer');

        Commit();
        Ok := Runner.Run();
        Assert.IsTrue(Ok, 'The night run works with an unsaved change of its caller: ' + GetLastErrorText());
        Assert.AreEqual(1, Runner.InvoicedLeases(), 'The lease is invoiced');
        Assert.AreEqual(0, Runner.FailedLeaseCount(), 'No lease failed');
        Lease.Get('HX090-P1');
        Assert.AreEqual('HX090 Renamed Customer', Lease."Customer Name", 'The caller''s change is saved');
        InvoiceLine.SetRange("Contract No.", 'HX090-P1');
        Assert.AreEqual(2, InvoiceLine.Count(), 'March and April are invoiced');
        Assert.IsTrue(InvoiceLine.Get('HX090-P1', 10000), 'March invoice line exists');
        Assert.AreEqual('HX090 Renamed Customer', InvoiceLine."Customer Name", 'The invoice line sees the saved change');
    end;

    [Test]
    procedure CommittingArchiveKeepsNothingOfFailedLease()
    var
        Lease: Record "CGR Lease Contract";
        InvoiceLine: Record "CGR Lease Invoice Line";
        ScheduleLine: Record "CGR Lease Schedule Line";
        Spy: Codeunit "CGR Lease Archive Spy";
        NightRun: Codeunit "CGR Lease Night Run";
        FailedLeases: List of [Code[20]];
        Invoiced: Integer;
    begin
        WorkDate(20300415D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20300301D, 20300531D);
        HX90NewLease('HX090-C1', 20300301D);
        HX90NewLease('HX090-C2', 20300301D);
        Spy.RefuseLine('HX090-C2', 20000, true);
        BindSubscription(Spy);

        Lease.SetFilter("No.", '%1|%2', 'HX090-C1', 'HX090-C2');
        Commit();
        Invoiced := NightRun.InvoiceNightRun(Lease, FailedLeases);
        UnbindSubscription(Spy);

        Assert.AreEqual(1, Invoiced, 'Only the first lease is invoiced');
        Assert.AreEqual(1, FailedLeases.Count(), 'One lease failed');
        Assert.AreEqual('HX090-C2', FailedLeases.Get(1), 'The refused lease failed');
        InvoiceLine.SetRange("Contract No.", 'HX090-C2');
        Assert.AreEqual(0, InvoiceLine.Count(), 'The failed lease keeps no invoice line, although the archive committed');
        ScheduleLine.SetRange("Contract No.", 'HX090-C2');
        ScheduleLine.SetRange(Invoiced, true);
        Assert.AreEqual(0, ScheduleLine.Count(), 'The failed lease keeps no invoiced schedule line');
        InvoiceLine.SetRange("Contract No.", 'HX090-C1');
        Assert.AreEqual(2, InvoiceLine.Count(), 'The good lease is invoiced');
    end;

    [Test]
    procedure FailedLeaseBetweenTwoGoodLeases()
    var
        Lease: Record "CGR Lease Contract";
        InvoiceLine: Record "CGR Lease Invoice Line";
        Spy: Codeunit "CGR Lease Archive Spy";
        NightRun: Codeunit "CGR Lease Night Run";
        FailedLeases: List of [Code[20]];
        Invoiced: Integer;
    begin
        WorkDate(20300415D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20300301D, 20300531D);
        HX90NewLease('HX090-F1', 20300301D);
        HX90NewLease('HX090-F2', 20300301D);
        HX90NewLease('HX090-F3', 20300301D);
        Spy.RefuseLine('HX090-F2', 10000, false);
        BindSubscription(Spy);
        FailedLeases.Add('HX090-OLD');

        Lease.SetFilter("No.", 'HX090-F1..HX090-F3');
        Commit();
        Invoiced := NightRun.InvoiceNightRun(Lease, FailedLeases);
        UnbindSubscription(Spy);

        Assert.AreEqual(2, Invoiced, 'Two of three leases are invoiced');
        Assert.AreEqual(1, FailedLeases.Count(), 'The list holds only the failure of this call');
        Assert.AreEqual('HX090-F2', FailedLeases.Get(1), 'The middle lease failed');
        InvoiceLine.SetRange("Contract No.", 'HX090-F1');
        Assert.AreEqual(2, InvoiceLine.Count(), 'The lease before the failure is invoiced');
        InvoiceLine.SetRange("Contract No.", 'HX090-F2');
        Assert.AreEqual(0, InvoiceLine.Count(), 'The failed lease keeps no invoice line');
        InvoiceLine.SetRange("Contract No.", 'HX090-F3');
        Assert.AreEqual(2, InvoiceLine.Count(), 'The lease after the failure is invoiced');
    end;

    [Test]
    procedure InvoicesFilteredLeasesUpToWorkDate()
    var
        Lease: Record "CGR Lease Contract";
        InvoiceLine: Record "CGR Lease Invoice Line";
        ScheduleLine: Record "CGR Lease Schedule Line";
        NightRun: Codeunit "CGR Lease Night Run";
        FailedLeases: List of [Code[20]];
        Invoiced: Integer;
    begin
        WorkDate(20300415D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20300301D, 20300531D);
        HX90NewLease('HX090-D1', 20300301D);
        HX90NewLease('HX090-D9', 20300301D);

        Lease.SetRange("No.", 'HX090-D1');
        Commit();
        Invoiced := NightRun.InvoiceNightRun(Lease, FailedLeases);

        Assert.AreEqual(1, Invoiced, 'One lease in the filter');
        Assert.AreEqual(0, FailedLeases.Count(), 'No lease failed');
        Assert.IsTrue(InvoiceLine.Get('HX090-D1', 10000), 'March is due by the work date');
        Assert.AreEqual(103.00, InvoiceLine.Amount, 'March installment');
        Assert.IsTrue(InvoiceLine.Get('HX090-D1', 20000), 'April is due by the work date');
        Assert.AreEqual(103.00, InvoiceLine.Amount, 'April installment');
        Assert.IsFalse(InvoiceLine.Get('HX090-D1', 30000), 'May is due after the work date');
        ScheduleLine.Get('HX090-D1', 20000);
        Assert.IsTrue(ScheduleLine.Invoiced, 'April schedule line invoiced');
        ScheduleLine.Get('HX090-D1', 30000);
        Assert.IsFalse(ScheduleLine.Invoiced, 'May schedule line not invoiced');
        InvoiceLine.SetRange("Contract No.", 'HX090-D9');
        Assert.AreEqual(0, InvoiceLine.Count(), 'A lease outside the filter is not invoiced');
    end;

    local procedure HX90NewLease(LeaseNo: Code[20]; StartDate: Date)
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
        Lease."Vehicle No." := 'HX090-V';
        Lease."Customer Name" := 'HX090 Customer';
        Lease."Start Date" := StartDate;
        Lease.Months := 3;
        Lease."Base Rate" := 100;
        Lease.Insert();
        LeaseMgt.CreateSchedule(LeaseNo);
    end;
}
