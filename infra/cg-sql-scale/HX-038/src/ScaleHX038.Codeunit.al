/// <summary>
/// Q-06 scale scenario for HX-038 (harness-owned, private; never a task test, never scored).
/// One lease with a 100-month schedule, every line due up to the run date.
///
/// Placed as the only source of the Test app (the Q-04 test-rerun path) and run with
/// `--sql-cost`, which counts SQL statements per [Test] method. Every method is self-contained:
/// it builds its own vehicle and lease under its own key tag (S, P, I), and starts by clearing
/// its own keys only. So no method sees another method's data, and the result depends neither on
/// the runner's isolation level nor on method order.
/// SetupOnly measures the setup alone; Propose100 and Invoice100 each measure the same setup plus
/// one call. A call's cost is the difference, taken per execution (the "Setup" name prefix marks
/// the baseline method).
/// Success only is asserted: the calls complete without an error. Nothing about how the solution
/// builds the lines is checked.
/// </summary>
codeunit 84981 "CG Scale HX-038"
{
    Subtype = Test;
    TestPermissions = Disabled;

    [Test]
    procedure SetupOnly()
    begin
        Setup100DueLines('S');
    end;

    [Test]
    procedure Propose100()
    var
        InvoiceBuffer: Record "CGR Lease Invoice Line" temporary;
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        Setup100DueLines('P');
        LeaseInvoicing.ProposeInvoiceLines(LeaseNo('P'), LastDueDate(), InvoiceBuffer);
    end;

    [Test]
    procedure Invoice100()
    var
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        Setup100DueLines('I');
        LeaseInvoicing.InvoiceDueLines(LeaseNo('I'), LastDueDate());
    end;

    local procedure LeaseNo(Tag: Text[1]): Code[20]
    begin
        exit(CopyStr('CGSQL-L38' + Tag, 1, 20));
    end;

    local procedure VehicleNo(Tag: Text[1]): Code[20]
    begin
        exit(CopyStr('CGSQL-V38' + Tag, 1, 20));
    end;

    /// <summary>The 100th line is due 99 months after the 2027-03-01 start.</summary>
    local procedure LastDueDate(): Date
    begin
        exit(20351231D);
    end;

    local procedure Setup100DueLines(Tag: Text[1])
    begin
        InitRun();
        NewLease(LeaseNo(Tag), VehicleNo(Tag), 100);
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

    local procedure NewLease(ContractNo: Code[20]; VehNo: Code[20]; Months: Integer)
    var
        Vehicle: Record "CGR Vehicle";
        LeaseContract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
        InvoiceLine: Record "CGR Lease Invoice Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        ScheduleLine.SetRange("Contract No.", ContractNo);
        ScheduleLine.DeleteAll();
        InvoiceLine.SetRange("Contract No.", ContractNo);
        InvoiceLine.DeleteAll();
        LeaseContract.SetRange("No.", ContractNo);
        LeaseContract.DeleteAll();
        Vehicle.SetRange("No.", VehNo);
        Vehicle.DeleteAll();

        Vehicle.Init();
        Vehicle."No." := VehNo;
        Vehicle.Mileage := 1000;
        Vehicle."Daily Rate" := 40;
        Vehicle.Insert();
        LeaseContract.Init();
        LeaseContract."No." := ContractNo;
        LeaseContract."Vehicle No." := VehNo;
        LeaseContract."Customer Name" := 'CGSQL Customer';
        LeaseContract."Start Date" := 20270301D;
        LeaseContract.Months := Months;
        LeaseContract."Base Rate" := 100;
        LeaseContract.Insert();
        LeaseMgt.CreateSchedule(ContractNo);
    end;
}
