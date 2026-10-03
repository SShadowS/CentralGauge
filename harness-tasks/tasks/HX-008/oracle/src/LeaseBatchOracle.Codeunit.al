codeunit 85620 "HX008 Lease Batch Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure InvoicesEveryDueLease()
    var
        LeaseFilter: Record "CGR Lease Contract";
        InvoiceLine: Record "CGR Lease Invoice Line";
        ScheduleLine: Record "CGR Lease Schedule Line";
        BatchInvoicing: Codeunit "CGR Lease Batch Invoicing";
    begin
        InitRun();
        InsertLease('HX8-R1A', 20270301D);
        InsertLease('HX8-R1B', 20270301D);

        LeaseFilter.SetFilter("Vehicle No.", '%1|%2', 'HX8-R1A', 'HX8-R1B');
        Assert.AreEqual(2, BatchInvoicing.InvoiceDueLeases(LeaseFilter, 20270401D), 'Both leases with due lines are counted');

        AssertLeaseInvoiced('HX8-R1A', 2);
        AssertLeaseInvoiced('HX8-R1B', 2);
        InvoiceLine.Get('HX8-R1B', 20000);
        Assert.AreEqual(103.00, InvoiceLine.Amount, 'Invoice line amount as InvoiceDueLines gives it');
        Assert.AreEqual(20270401D, InvoiceLine."Invoice Date", 'Invoice date as InvoiceDueLines gives it');
        ScheduleLine.Get('HX8-R1A', 30000);
        Assert.IsFalse(ScheduleLine.Invoiced, 'A line due after UpToDate is not invoiced');
        ScheduleLine.Get('HX8-R1B', 30000);
        Assert.IsFalse(ScheduleLine.Invoiced, 'A line due after UpToDate is not invoiced');
    end;

    [Test]
    procedure LeaseOutsideFilterUntouched()
    var
        LeaseFilter: Record "CGR Lease Contract";
        BatchInvoicing: Codeunit "CGR Lease Batch Invoicing";
    begin
        InitRun();
        InsertLease('HX8-R2A', 20270301D);
        InsertLease('HX8-R2B', 20270301D);

        LeaseFilter.SetFilter("Vehicle No.", '%1', 'HX8-R2A');
        Assert.AreEqual(1, BatchInvoicing.InvoiceDueLeases(LeaseFilter, 20270401D), 'Only the lease in the filter is counted');

        AssertLeaseInvoiced('HX8-R2A', 2);
        AssertLeaseInvoiced('HX8-R2B', 0);
    end;

    [Test]
    procedure DueDateBoundaryInclusive()
    var
        LeaseFilter: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
        BatchInvoicing: Codeunit "CGR Lease Batch Invoicing";
    begin
        InitRun();
        InsertLease('HX8-R3A', 20270301D);
        InsertLease('HX8-R3B', 20270301D);

        LeaseFilter.SetFilter("Vehicle No.", '%1', 'HX8-R3A');
        Assert.AreEqual(1, BatchInvoicing.InvoiceDueLeases(LeaseFilter, 20270331D), 'Day before the second due date');
        AssertLeaseInvoiced('HX8-R3A', 1);
        ScheduleLine.Get('HX8-R3A', 20000);
        Assert.IsFalse(ScheduleLine.Invoiced, 'A line due one day after UpToDate is not invoiced');

        LeaseFilter.SetFilter("Vehicle No.", '%1', 'HX8-R3B');
        Assert.AreEqual(1, BatchInvoicing.InvoiceDueLeases(LeaseFilter, 20270401D), 'On the second due date');
        AssertLeaseInvoiced('HX8-R3B', 2);
        ScheduleLine.Get('HX8-R3B', 20000);
        Assert.IsTrue(ScheduleLine.Invoiced, 'A line due on UpToDate is invoiced');
    end;

    [Test]
    procedure CommittingFailureRollsBackLease()
    var
        LeaseFilter: Record "CGR Lease Contract";
        FailSubscriber: Codeunit "HX008 Lease Fail Subscriber";
        BatchInvoicing: Codeunit "CGR Lease Batch Invoicing";
    begin
        InitRun();
        InsertLease('HX8-R4A', 20270301D);
        InsertLease('HX8-R4B', 20270301D);
        InsertLease('HX8-R4C', 20270301D);
        FailSubscriber.FailOnScheduleLine('HX8-R4B', 20000, true);
        BindSubscription(FailSubscriber);

        LeaseFilter.SetFilter("Vehicle No.", '%1|%2|%3', 'HX8-R4A', 'HX8-R4B', 'HX8-R4C');
        Assert.AreEqual(2, BatchInvoicing.InvoiceDueLeases(LeaseFilter, 20270401D), 'The failing lease is not counted');

        AssertLeaseInvoiced('HX8-R4B', 0);
        AssertLeaseInvoiced('HX8-R4A', 2);
        AssertLeaseInvoiced('HX8-R4C', 2);
    end;

    [Test]
    procedure FailureRecordedWithText()
    var
        LeaseFilter: Record "CGR Lease Contract";
        LeaseInvoiceError: Record "CGR Lease Invoice Error";
        FailSubscriber: Codeunit "HX008 Lease Fail Subscriber";
        BatchInvoicing: Codeunit "CGR Lease Batch Invoicing";
        RunStartedAt: DateTime;
        RunEndedAt: DateTime;
    begin
        InitRun();
        InsertLease('HX8-R5A', 20270301D);
        InsertLease('HX8-R5B', 20270301D);
        InsertLease('HX8-R5C', 20270301D);
        FailSubscriber.FailOnScheduleLine('HX8-R5B', 20000, true);
        BindSubscription(FailSubscriber);

        LeaseFilter.SetFilter("Vehicle No.", '%1|%2|%3', 'HX8-R5A', 'HX8-R5B', 'HX8-R5C');
        RunStartedAt := CurrentDateTime();
        BatchInvoicing.InvoiceDueLeases(LeaseFilter, 20270401D);
        RunEndedAt := CurrentDateTime();

        LeaseInvoiceError.SetRange("Run Id", BatchInvoicing.LastRunId());
        Assert.AreEqual(1, LeaseInvoiceError.Count(), 'One record for the one failed lease');
        LeaseInvoiceError.FindFirst();
        Assert.AreEqual('HX8-R5B', LeaseInvoiceError."Contract No.", 'The record names the failed lease');
        Assert.AreEqual(StrSubstNo('HX008 failure on %1 line %2.', 'HX8-R5B', 20000), LeaseInvoiceError."Error Message", 'The record keeps the error text');
        Assert.AreNotEqual(0DT, LeaseInvoiceError."Logged At", 'The record has its time');
        // One second of slack each side: the stored DateTime may be rounded by the database.
        Assert.IsTrue(LeaseInvoiceError."Logged At" >= RunStartedAt - 1000, 'Recorded during the run, not before');
        Assert.IsTrue(LeaseInvoiceError."Logged At" <= RunEndedAt + 1000, 'Recorded during the run, not after');
    end;

    [Test]
    procedure FailuresRecordedSeparately()
    var
        LeaseFilter: Record "CGR Lease Contract";
        LeaseInvoiceError: Record "CGR Lease Invoice Error";
        FailSubscriber: Codeunit "HX008 Lease Fail Subscriber";
        BatchInvoicing: Codeunit "CGR Lease Batch Invoicing";
        FirstEntryNo: Integer;
    begin
        InitRun();
        InsertLease('HX8-R9A', 20270301D);
        InsertLease('HX8-R9B', 20270301D);
        InsertLease('HX8-R9C', 20270301D);
        FailSubscriber.FailOnScheduleLine('HX8-R9B', 20000, true);
        FailSubscriber.FailOnScheduleLine('HX8-R9C', 10000, false);
        BindSubscription(FailSubscriber);

        LeaseFilter.SetFilter("Vehicle No.", '%1|%2|%3', 'HX8-R9A', 'HX8-R9B', 'HX8-R9C');
        Assert.AreEqual(1, BatchInvoicing.InvoiceDueLeases(LeaseFilter, 20270401D), 'Only the good lease is counted');

        LeaseInvoiceError.SetRange("Run Id", BatchInvoicing.LastRunId());
        Assert.AreEqual(2, LeaseInvoiceError.Count(), 'One record per failed lease');
        LeaseInvoiceError.SetRange("Contract No.", 'HX8-R9B');
        Assert.AreEqual(1, LeaseInvoiceError.Count(), 'A record for the first failed lease');
        LeaseInvoiceError.FindFirst();
        FirstEntryNo := LeaseInvoiceError."Entry No.";
        LeaseInvoiceError.SetRange("Contract No.", 'HX8-R9C');
        Assert.AreEqual(1, LeaseInvoiceError.Count(), 'A record for the second failed lease');
        LeaseInvoiceError.FindFirst();
        Assert.AreNotEqual(FirstEntryNo, LeaseInvoiceError."Entry No.", 'Each record has its own entry number');
    end;

    [Test]
    procedure PlainFailureRollsBackLease()
    var
        LeaseFilter: Record "CGR Lease Contract";
        FailSubscriber: Codeunit "HX008 Lease Fail Subscriber";
        BatchInvoicing: Codeunit "CGR Lease Batch Invoicing";
    begin
        InitRun();
        InsertLease('HX8-R6A', 20270301D);
        InsertLease('HX8-R6B', 20270301D);
        FailSubscriber.FailOnScheduleLine('HX8-R6B', 20000, false);
        BindSubscription(FailSubscriber);

        LeaseFilter.SetFilter("Vehicle No.", '%1|%2', 'HX8-R6A', 'HX8-R6B');
        Assert.AreEqual(1, BatchInvoicing.InvoiceDueLeases(LeaseFilter, 20270401D), 'Only the good lease is counted');

        AssertLeaseInvoiced('HX8-R6B', 0);
        AssertLeaseInvoiced('HX8-R6A', 2);
    end;

    [Test]
    procedure NothingDueNotCountedOrRecorded()
    var
        LeaseFilter: Record "CGR Lease Contract";
        LeaseInvoiceError: Record "CGR Lease Invoice Error";
        BatchInvoicing: Codeunit "CGR Lease Batch Invoicing";
    begin
        InitRun();
        InsertLease('HX8-R7A', 20270301D);
        InsertLease('HX8-R7D', 20270501D);

        LeaseFilter.SetFilter("Vehicle No.", '%1|%2', 'HX8-R7A', 'HX8-R7D');
        Assert.AreEqual(1, BatchInvoicing.InvoiceDueLeases(LeaseFilter, 20270401D), 'A lease with nothing due is not counted');

        AssertLeaseInvoiced('HX8-R7D', 0);
        LeaseInvoiceError.SetRange("Run Id", BatchInvoicing.LastRunId());
        Assert.AreEqual(0, LeaseInvoiceError.Count(), 'A lease with nothing due is not recorded');
    end;

    [Test]
    procedure EachRunHasItsOwnId()
    var
        LeaseFilter: Record "CGR Lease Contract";
        LeaseInvoiceError: Record "CGR Lease Invoice Error";
        FailSubscriber: Codeunit "HX008 Lease Fail Subscriber";
        BatchInvoicing: Codeunit "CGR Lease Batch Invoicing";
        FirstRunId: Guid;
        SecondRunId: Guid;
    begin
        InitRun();
        InsertLease('HX8-R8A', 20270301D);
        InsertLease('HX8-R8B', 20270301D);
        FailSubscriber.FailOnScheduleLine('HX8-R8B', 10000, false);
        BindSubscription(FailSubscriber);

        LeaseFilter.SetFilter("Vehicle No.", '%1|%2', 'HX8-R8A', 'HX8-R8B');
        Assert.AreEqual(1, BatchInvoicing.InvoiceDueLeases(LeaseFilter, 20270401D), 'First run: the good lease is counted');
        FirstRunId := BatchInvoicing.LastRunId();
        Assert.IsFalse(IsNullGuid(FirstRunId), 'The first run has an id');
        LeaseInvoiceError.SetRange("Run Id", FirstRunId);
        Assert.AreEqual(1, LeaseInvoiceError.Count(), 'First run records its failed lease');

        UnbindSubscription(FailSubscriber);
        LeaseFilter.SetFilter("Vehicle No.", '%1', 'HX8-R8B');
        Assert.AreEqual(1, BatchInvoicing.InvoiceDueLeases(LeaseFilter, 20270401D), 'Second run invoices the lease that failed before');
        SecondRunId := BatchInvoicing.LastRunId();
        Assert.IsFalse(IsNullGuid(SecondRunId), 'The second run has an id');
        Assert.AreNotEqual(FirstRunId, SecondRunId, 'Each run gets a new id');
        LeaseInvoiceError.SetRange("Run Id", SecondRunId);
        Assert.AreEqual(0, LeaseInvoiceError.Count(), 'Second run records nothing');
        LeaseInvoiceError.SetRange("Run Id", FirstRunId);
        Assert.AreEqual(1, LeaseInvoiceError.Count(), 'First run keeps its record');
    end;

    local procedure InitRun()
    var
        Setup: Record "CGR Setup";
        NonWorkingDay: Record "CGR Non-Working Day";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := 0.01;
        Setup.Modify();
        SessionContext.Reset();
        NonWorkingDay.SetRange("Non-Working Date", 20270301D, 20270731D);
        NonWorkingDay.DeleteAll();
    end;

    local procedure InsertLease(LeaseNo: Code[20]; StartDate: Date)
    var
        Contract: Record "CGR Lease Contract";
        InvoiceLine: Record "CGR Lease Invoice Line";
        ScheduleLine: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        InvoiceLine.SetRange("Contract No.", LeaseNo);
        InvoiceLine.DeleteAll();
        ScheduleLine.SetRange("Contract No.", LeaseNo);
        ScheduleLine.DeleteAll();
        if Contract.Get(LeaseNo) then
            Contract.Delete();
        Contract.Init();
        Contract."No." := LeaseNo;
        Contract."Vehicle No." := LeaseNo;
        Contract."Customer Name" := 'HX008 Customer';
        Contract."Start Date" := StartDate;
        Contract.Months := 3;
        Contract."Base Rate" := 100;
        Contract.Insert();
        LeaseMgt.CreateSchedule(LeaseNo);
    end;

    local procedure AssertLeaseInvoiced(LeaseNo: Code[20]; ExpectedLines: Integer)
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        InvoiceLine.SetRange("Contract No.", LeaseNo);
        Assert.AreEqual(ExpectedLines, InvoiceLine.Count(), StrSubstNo('Invoice lines of %1', LeaseNo));
        ScheduleLine.SetRange("Contract No.", LeaseNo);
        ScheduleLine.SetRange(Invoiced, true);
        Assert.AreEqual(ExpectedLines, ScheduleLine.Count(), StrSubstNo('Invoiced schedule lines of %1', LeaseNo));
    end;
}
