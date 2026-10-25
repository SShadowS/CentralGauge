/// <summary>
/// Q-06 scale scenario for HX-038 (harness-owned, private; never a task test, never scored).
/// One lease with a 100-month schedule, every line due up to the run date.
///
/// Placed as the only source of the Test app (the Q-04 test-rerun path) and run with
/// `--sql-cost`, which counts SQL statements per [Test] method. Three methods, run in this
/// order: Setup100DueLines builds the lease, Propose100 fills the temporary buffer with the
/// 100 lines, Invoice100 creates the 100 invoice lines. The runner rolls back after the
/// codeunit, not after each method, so the lease of the first method is there for the others.
/// Success only is asserted: both calls complete without an error. Nothing about how the
/// solution builds the lines is checked.
/// </summary>
codeunit 84981 "CG Scale HX-038"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        LeaseNoTok: Label 'CGSQL-L38', Locked = true;
        VehicleNoTok: Label 'CGSQL-V38', Locked = true;
        // The 100th line is due 99 months after the 2027-03-01 start.
        UpToDate: Date;

    [Test]
    procedure Setup100DueLines()
    begin
        InitRun();
        NewLease(LeaseNoTok, VehicleNoTok, 100);
    end;

    [Test]
    procedure Propose100()
    var
        InvoiceBuffer: Record "CGR Lease Invoice Line" temporary;
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        UpToDate := 20351231D;
        LeaseInvoicing.ProposeInvoiceLines(LeaseNoTok, UpToDate, InvoiceBuffer);
    end;

    [Test]
    procedure Invoice100()
    var
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        UpToDate := 20351231D;
        LeaseInvoicing.InvoiceDueLines(LeaseNoTok, UpToDate);
    end;

    local procedure InitRun()
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();
    end;

    local procedure NewLease(LeaseNo: Code[20]; VehicleNo: Code[20]; Months: Integer)
    var
        Vehicle: Record "CGR Vehicle";
        LeaseContract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
        InvoiceLine: Record "CGR Lease Invoice Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        ScheduleLine.SetRange("Contract No.", LeaseNo);
        ScheduleLine.DeleteAll();
        InvoiceLine.SetRange("Contract No.", LeaseNo);
        InvoiceLine.DeleteAll();
        if LeaseContract.Get(LeaseNo) then
            LeaseContract.Delete();
        if not Vehicle.Get(VehicleNo) then begin
            Vehicle.Init();
            Vehicle."No." := VehicleNo;
            Vehicle.Mileage := 1000;
            Vehicle."Daily Rate" := 40;
            Vehicle.Insert();
        end;
        LeaseContract.Init();
        LeaseContract."No." := LeaseNo;
        LeaseContract."Vehicle No." := VehicleNo;
        LeaseContract."Customer Name" := 'CGSQL Customer';
        LeaseContract."Start Date" := 20270301D;
        LeaseContract.Months := Months;
        LeaseContract."Base Rate" := 100;
        LeaseContract.Insert();
        LeaseMgt.CreateSchedule(LeaseNo);
    end;
}
