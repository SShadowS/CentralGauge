codeunit 80165 "CGR Overnight Billing Naive C"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure CommittedLeasesAreInvoicedThroughRunner()
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        Runner: Codeunit "CGR Overnight Naive Runner";
        Ok: Boolean;
    begin
        WorkDate(20250415D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20250301D, 20250531D);
        HX100NaiveLease('HX100-R1');
        HX100NaiveLease('HX100-R2');
        Runner.SetLeaseFilter('HX100-R1|HX100-R2');

        Commit();
        Ok := Runner.Run();
        Assert.IsTrue(Ok, 'The overnight billing runs after the caller committed: ' + GetLastErrorText());
        Assert.AreEqual(2, Runner.InvoicedLeases(), 'Both leases are invoiced');
        Assert.AreEqual(0, Runner.FailedLeaseCount(), 'No lease failed');
        InvoiceLine.SetRange("Contract No.", 'HX100-R1');
        Assert.AreEqual(2, InvoiceLine.Count(), 'March and April of the first lease are invoiced');
        InvoiceLine.SetRange("Contract No.", 'HX100-R2');
        Assert.AreEqual(2, InvoiceLine.Count(), 'March and April of the second lease are invoiced');
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
