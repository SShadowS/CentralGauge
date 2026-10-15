codeunit 80155 "CGR Lease Night Run Naive B"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure RefusedLeaseIsListed()
    var
        Lease: Record "CGR Lease Contract";
        InvoiceLine: Record "CGR Lease Invoice Line";
        Spy: Codeunit "CGR Lease Archive Spy";
        NightRun: Codeunit "CGR Lease Night Run";
        FailedLeases: List of [Code[20]];
    begin
        WorkDate(20300415D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20300301D, 20300531D);
        HX90NaiveLease('HX090-M1');
        HX90NaiveLease('HX090-M2');
        HX90NaiveLease('HX090-M3');
        Spy.RefuseLine('HX090-M2', 20000, false);
        BindSubscription(Spy);
        FailedLeases.Add('HX090-OLD');

        Lease.SetFilter("No.", 'HX090-M1..HX090-M3');
        Assert.AreEqual(2, NightRun.InvoiceNightRun(Lease, FailedLeases), 'Two leases are invoiced');
        UnbindSubscription(Spy);
        Assert.AreEqual(1, FailedLeases.Count(), 'One lease failed');
        Assert.AreEqual('HX090-M2', FailedLeases.Get(1), 'The refused lease failed');
        InvoiceLine.SetRange("Contract No.", 'HX090-M2');
        Assert.AreEqual(0, InvoiceLine.Count(), 'The refused lease has no invoice line');
        Assert.IsTrue(InvoiceLine.Get('HX090-M1', 10000), 'March of the first lease is invoiced');
        Assert.IsTrue(InvoiceLine.Get('HX090-M1', 20000), 'April of the first lease is invoiced');
    end;

    local procedure HX90NaiveLease(LeaseNo: Code[20])
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
        Lease."Start Date" := 20300301D;
        Lease.Months := 3;
        Lease."Base Rate" := 100;
        Lease.Insert();
        LeaseMgt.CreateSchedule(LeaseNo);
    end;
}
