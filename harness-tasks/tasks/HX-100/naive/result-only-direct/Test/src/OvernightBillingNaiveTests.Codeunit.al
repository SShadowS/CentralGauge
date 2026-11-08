codeunit 80163 "CGR Overnight Billing Naive A"
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
        OvernightBilling: Codeunit "CGR Lease Overnight Billing";
        FailedLeases: List of [Code[20]];
    begin
        WorkDate(20250415D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20250301D, 20250531D);
        HX100NaiveLease('HX100-A1');
        HX100NaiveLease('HX100-A2');

        Lease.SetFilter("No.", '%1|%2', 'HX100-A1', 'HX100-A2');
        Assert.AreEqual(2, OvernightBilling.BillLeasesOvernight(Lease, FailedLeases), 'Both leases are invoiced');
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
