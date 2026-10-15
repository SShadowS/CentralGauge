codeunit 80154 "CGR Lease Night Run Naive A"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure TwoLeasesAreInvoiced()
    var
        Lease: Record "CGR Lease Contract";
        NightRun: Codeunit "CGR Lease Night Run";
        FailedLeases: List of [Code[20]];
    begin
        WorkDate(20300415D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20300301D, 20300531D);
        HX90NaiveLease('HX090-N1');
        HX90NaiveLease('HX090-N2');

        Lease.SetFilter("No.", '%1|%2', 'HX090-N1', 'HX090-N2');
        Assert.AreEqual(2, NightRun.InvoiceNightRun(Lease, FailedLeases), 'Both leases are invoiced');
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
