codeunit 88510 "HX170 Lease Billed Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";

    [Test]
    procedure DueOnRunDateIsInvoiced()
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
    begin
        NewHX170Lease('HX170-A');

        Assert.AreEqual(2, LeaseInvoicing.InvoiceDueLines('HX170-A', 20240401D), 'Lines due before and on UpToDate are processed');
        Assert.IsTrue(InvoiceLine.Get('HX170-A', 20000), 'The line due on UpToDate gets an invoice line');
        Assert.IsFalse(InvoiceLine.Get('HX170-A', 30000), 'The line due after UpToDate gets no invoice line');
        AssertHX170Invoiced('HX170-A', 30000, false, 'The line due after UpToDate');
    end;

    [Test]
    procedure LineStaysInvoiced()
    begin
        NewHX170Lease('HX170-B');

        LeaseInvoicing.InvoiceDueLines('HX170-B', 20240401D);

        AssertHX170Invoiced('HX170-B', 10000, true, 'The first due line after the run');
        AssertHX170Invoiced('HX170-B', 20000, true, 'The line due on UpToDate after the run');
    end;

    [Test]
    procedure BilledAmountIsTheInvoiceLinesAmount()
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        Spy: Codeunit "HX170 Lease Desk Spy";
    begin
        NewHX170Lease('HX170-D');
        Spy.WatchLease('HX170-D');
        Spy.RepriceLine(20000, 215.5);
        BindSubscription(Spy);

        LeaseInvoicing.InvoiceDueLines('HX170-D', 20240401D);
        UnbindSubscription(Spy);

        InvoiceLine.Get('HX170-D', 10000);
        Assert.AreEqual(100.0, InvoiceLine.Amount, 'Invoice line amount is the rounded installment');
        AssertHX170Billed('HX170-D', 10000, 100.0, 'An unchanged line bills its rounded invoice line amount');
        InvoiceLine.Get('HX170-D', 20000);
        Assert.AreEqual(215.5, InvoiceLine.Amount, 'The subscriber changed the invoice line amount');
        AssertHX170Billed('HX170-D', 20000, 215.5, 'A line changed by a subscriber bills the changed amount');
        AssertHX170Billed('HX170-D', 30000, 0, 'A line not due is not billed');
    end;

    [Test]
    procedure HandledLineHasZeroBilledAmount()
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        Spy: Codeunit "HX170 Lease Desk Spy";
        Processed: Integer;
    begin
        NewHX170Lease('HX170-E');
        Spy.WatchLease('HX170-E');
        Spy.HandleLine(20000);
        BindSubscription(Spy);

        Processed := LeaseInvoicing.InvoiceDueLines('HX170-E', 20240401D);
        UnbindSubscription(Spy);
        Assert.AreEqual(2, Processed, 'A handled line still counts as processed');

        Assert.IsFalse(InvoiceLine.Get('HX170-E', 20000), 'A handled line gets no invoice line from us');
        AssertHX170Invoiced('HX170-E', 20000, true, 'A handled line');
        AssertHX170Billed('HX170-E', 20000, 0, 'A handled line bills nothing');
        AssertHX170Invoiced('HX170-E', 10000, true, 'The unhandled line');
        AssertHX170Billed('HX170-E', 10000, 100.0, 'The unhandled line bills its invoice line amount');
    end;

    [Test]
    procedure InvoicedLineKeepsAccountingRef()
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
        Spy: Codeunit "HX170 Lease Desk Spy";
    begin
        NewHX170Lease('HX170-F');
        Spy.WatchLease('HX170-F');
        Spy.PostLikeAccounting();
        BindSubscription(Spy);

        LeaseInvoicing.InvoiceDueLines('HX170-F', 20240401D);
        UnbindSubscription(Spy);

        ScheduleLine.Get('HX170-F', 10000);
        Assert.AreEqual(Spy.ExpectedRef(10000), ScheduleLine."Accounting Ref.", 'The first invoiced line carries the accounting reference');
        Assert.IsTrue(ScheduleLine.Invoiced, 'The first line is invoiced');
        ScheduleLine.Get('HX170-F', 20000);
        Assert.AreEqual(Spy.ExpectedRef(20000), ScheduleLine."Accounting Ref.", 'The line due on UpToDate carries the accounting reference');
        Assert.IsTrue(ScheduleLine.Invoiced, 'The line due on UpToDate is invoiced');
        ScheduleLine.Get('HX170-F', 30000);
        Assert.AreEqual('', ScheduleLine."Accounting Ref.", 'A line not invoiced has no accounting reference');
    end;

    local procedure NewHX170Lease(LeaseNo: Code[20])
    var
        Setup: Record "CGR Setup";
        NonWorkingDay: Record "CGR Non-Working Day";
        Contract: Record "CGR Lease Contract";
        InvoiceLine: Record "CGR Lease Invoice Line";
        ScheduleLine: Record "CGR Lease Schedule Line";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20240301D);
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := 0.01;
        Setup.Modify();
        SessionContext.Reset();
        NonWorkingDay.SetRange("Non-Working Date", 20240301D, 20240430D);
        NonWorkingDay.DeleteAll();

        InvoiceLine.SetRange("Contract No.", LeaseNo);
        InvoiceLine.DeleteAll();
        ScheduleLine.SetRange("Contract No.", LeaseNo);
        ScheduleLine.DeleteAll();
        if Contract.Get(LeaseNo) then
            Contract.Delete();
        Contract.Init();
        Contract."No." := LeaseNo;
        Contract."Vehicle No." := LeaseNo;
        Contract."Customer Name" := 'HX170 Customer';
        Contract."Start Date" := 20240304D;
        Contract.Months := 3;
        Contract."Base Rate" := 200;
        Contract.Insert();

        AddHX170Line(LeaseNo, 10000, 20240304D, 100.004);
        AddHX170Line(LeaseNo, 20000, 20240401D, 200);
        AddHX170Line(LeaseNo, 30000, 20240402D, 300);
    end;

    local procedure AddHX170Line(LeaseNo: Code[20]; LineNo: Integer; DueDate: Date; LineAmount: Decimal)
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        ScheduleLine.Init();
        ScheduleLine."Contract No." := LeaseNo;
        ScheduleLine."Line No." := LineNo;
        ScheduleLine."Due Date" := DueDate;
        ScheduleLine.Amount := LineAmount;
        ScheduleLine.Insert();
    end;

    local procedure AssertHX170Invoiced(LeaseNo: Code[20]; LineNo: Integer; Expected: Boolean; What: Text)
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        ScheduleLine.Get(LeaseNo, LineNo);
        Assert.AreEqual(Expected, ScheduleLine.Invoiced, What + ': Invoiced');
    end;

    local procedure AssertHX170Billed(LeaseNo: Code[20]; LineNo: Integer; Expected: Decimal; What: Text)
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        ScheduleLine.Get(LeaseNo, LineNo);
        Assert.AreEqual(Expected, ScheduleLine."Billed Amount", What + ': Billed Amount');
    end;
}
