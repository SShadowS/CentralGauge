codeunit 80164 "CGR Overnight Billing Naive B"
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
        Spy: Codeunit "CGR Overnight Archive Spy";
        OvernightBilling: Codeunit "CGR Lease Overnight Billing";
        FailedLeases: List of [Code[20]];
    begin
        WorkDate(20250415D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20250301D, 20250531D);
        HX100NaiveLease('HX100-M1');
        HX100NaiveLease('HX100-M2');
        HX100NaiveLease('HX100-M3');
        Spy.RefuseLine('HX100-M2', 20000, false);
        BindSubscription(Spy);
        FailedLeases.Add('HX100-OLD');

        Lease.SetFilter("No.", 'HX100-M1..HX100-M3');
        Assert.AreEqual(2, OvernightBilling.BillLeasesOvernight(Lease, FailedLeases), 'Two leases are invoiced');
        UnbindSubscription(Spy);
        Assert.AreEqual(1, FailedLeases.Count(), 'One lease failed');
        Assert.AreEqual('HX100-M2', FailedLeases.Get(1), 'The refused lease failed');
        InvoiceLine.SetRange("Contract No.", 'HX100-M2');
        Assert.AreEqual(0, InvoiceLine.Count(), 'The refused lease has no invoice line');
        InvoiceLine.SetRange("Contract No.", 'HX100-M1');
        Assert.AreEqual(2, InvoiceLine.Count(), 'March and April of the first lease are invoiced');
    end;

    local procedure HX100NaiveLease(LeaseNo: Code[20])
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
        Lease."Start Date" := 20250301D;
        Lease.Months := 3;
        Lease."Base Rate" := 100;
        Lease.Insert();
        LeaseMgt.CreateSchedule(LeaseNo);
    end;
}
