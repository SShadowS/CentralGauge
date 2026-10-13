codeunit 86220 "HX038 Invoice Proposal Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure ProposalMatchesInvoicedLines()
    var
        TempInvoiceLine: Record "CGR Lease Invoice Line" temporary;
        InvoiceLine: Record "CGR Lease Invoice Line";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        InitRun();
        InsertLease('HX38-MATCH');

        LeaseInvoicing.ProposeInvoiceLines('HX38-MATCH', 20270401D, TempInvoiceLine);
        Assert.AreEqual(2, LeaseInvoicing.InvoiceDueLines('HX38-MATCH', 20270401D), 'InvoiceDueLines invoices March and April');

        TempInvoiceLine.Reset();
        Assert.AreEqual(2, TempInvoiceLine.Count(), 'The proposal holds the two lines due up to 1 April');
        InvoiceLine.SetRange("Contract No.", 'HX38-MATCH');
        Assert.AreEqual(2, InvoiceLine.Count(), 'InvoiceDueLines created two invoice lines');
        AssertInvoiceLine(TempInvoiceLine, 'HX38-MATCH', 10000, 20270301D, 20270301D, 103.00);
        AssertInvoiceLine(TempInvoiceLine, 'HX38-MATCH', 20000, 20270401D, 20270401D, 103.00);
        TempInvoiceLine.FindSet();
        repeat
            InvoiceLine.Get(TempInvoiceLine."Contract No.", TempInvoiceLine."Schedule Line No.");
            Assert.AreEqual(InvoiceLine."Vehicle No.", TempInvoiceLine."Vehicle No.", StrSubstNo('Vehicle No. of proposed line %1 equals the created line', TempInvoiceLine."Schedule Line No."));
            Assert.AreEqual(InvoiceLine."Customer Name", TempInvoiceLine."Customer Name", StrSubstNo('Customer Name of proposed line %1 equals the created line', TempInvoiceLine."Schedule Line No."));
            Assert.AreEqual(InvoiceLine."Due Date", TempInvoiceLine."Due Date", StrSubstNo('Due Date of proposed line %1 equals the created line', TempInvoiceLine."Schedule Line No."));
            Assert.AreEqual(InvoiceLine."Invoice Date", TempInvoiceLine."Invoice Date", StrSubstNo('Invoice Date of proposed line %1 equals the created line', TempInvoiceLine."Schedule Line No."));
            Assert.AreEqual(InvoiceLine.Amount, TempInvoiceLine.Amount, StrSubstNo('Amount of proposed line %1 equals the created line', TempInvoiceLine."Schedule Line No."));
        until TempInvoiceLine.Next() = 0;
    end;

    [Test]
    procedure ProposalChangesNothing()
    var
        TempInvoiceLine: Record "CGR Lease Invoice Line" temporary;
        InvoiceLine: Record "CGR Lease Invoice Line";
        ScheduleLine: Record "CGR Lease Schedule Line";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        InitRun();
        InsertLease('HX38-NOCHANGE');

        LeaseInvoicing.ProposeInvoiceLines('HX38-NOCHANGE', 20270501D, TempInvoiceLine);

        InvoiceLine.SetRange("Contract No.", 'HX38-NOCHANGE');
        Assert.AreEqual(0, InvoiceLine.Count(), 'A proposal creates no invoice lines');
        ScheduleLine.SetRange("Contract No.", 'HX38-NOCHANGE');
        Assert.AreEqual(3, ScheduleLine.Count(), 'The schedule keeps its three lines');
        ScheduleLine.SetRange(Invoiced, true);
        Assert.AreEqual(0, ScheduleLine.Count(), 'A proposal marks no schedule line invoiced');
    end;

    [Test]
    procedure ProposalRaisesNoEvents()
    var
        TempInvoiceLine: Record "CGR Lease Invoice Line" temporary;
        Spy: Codeunit "HX038 Invoicing Spy";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        InitRun();
        InsertLease('HX38-NOEVENT');
        Spy.SetAmountOverride(1);
        BindSubscription(Spy);

        LeaseInvoicing.ProposeInvoiceLines('HX38-NOEVENT', 20270401D, TempInvoiceLine);

        Assert.AreEqual(0, Spy.BeforeEvents(), 'A proposal raises no OnBeforeCreateInvoiceLine');
        Assert.AreEqual(0, Spy.AfterEvents(), 'A proposal raises no OnAfterCreateInvoiceLine');
        TempInvoiceLine.Reset();
        Assert.AreEqual(2, TempInvoiceLine.Count(), 'The proposal holds the two lines due up to 1 April');
        TempInvoiceLine.FindSet();
        repeat
            Assert.AreEqual(103.00, TempInvoiceLine.Amount, StrSubstNo('Proposed line %1 shows the amount before extensions', TempInvoiceLine."Schedule Line No."));
        until TempInvoiceLine.Next() = 0;
    end;

    [Test]
    procedure ProposalReplacesBuffer()
    var
        TempInvoiceLine: Record "CGR Lease Invoice Line" temporary;
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        InitRun();
        InsertLease('HX38-REPL-A');
        InsertLease('HX38-REPL-C');

        LeaseInvoicing.ProposeInvoiceLines('HX38-REPL-A', 20270401D, TempInvoiceLine);
        LeaseInvoicing.ProposeInvoiceLines('HX38-REPL-C', 20270401D, TempInvoiceLine);

        TempInvoiceLine.Reset();
        Assert.AreEqual(2, TempInvoiceLine.Count(), 'The second proposal replaces the first');
        TempInvoiceLine.SetRange("Contract No.", 'HX38-REPL-C');
        Assert.AreEqual(2, TempInvoiceLine.Count(), 'Only the second lease''s lines remain');
    end;

    [Test]
    procedure ProposalInvoiceDateSkipsWeekend()
    var
        TempInvoiceLine: Record "CGR Lease Invoice Line" temporary;
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        InitRun();
        InsertLease('HX38-WEEKEND');

        LeaseInvoicing.ProposeInvoiceLines('HX38-WEEKEND', 20270501D, TempInvoiceLine);

        TempInvoiceLine.Reset();
        Assert.AreEqual(3, TempInvoiceLine.Count(), 'All three lines are due up to 1 May');
        AssertInvoiceLine(TempInvoiceLine, 'HX38-WEEKEND', 30000, 20270501D, 20270503D, 103.00);
    end;

    [Test]
    procedure NothingDueClearsBuffer()
    var
        TempInvoiceLine: Record "CGR Lease Invoice Line" temporary;
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        InitRun();
        InsertLease('HX38-NODUE');
        TempInvoiceLine.Init();
        TempInvoiceLine."Contract No." := 'HX38-NODUE-OLD';
        TempInvoiceLine."Schedule Line No." := 10000;
        TempInvoiceLine.Amount := 50;
        TempInvoiceLine.Insert();

        LeaseInvoicing.ProposeInvoiceLines('HX38-NODUE', 20270228D, TempInvoiceLine);

        TempInvoiceLine.Reset();
        Assert.AreEqual(0, TempInvoiceLine.Count(), 'Nothing is due before 1 March, so the proposal is empty');
    end;

    [Test]
    procedure InvoicingAppliesBeforeEventChanges()
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        Spy: Codeunit "HX038 Invoicing Spy";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        InitRun();
        InsertLease('HX38-OVERRIDE');
        Spy.SetAmountOverride(99.99);
        BindSubscription(Spy);

        Assert.AreEqual(2, LeaseInvoicing.InvoiceDueLines('HX38-OVERRIDE', 20270401D), 'March and April are invoiced');

        InvoiceLine.SetRange("Contract No.", 'HX38-OVERRIDE');
        Assert.AreEqual(2, InvoiceLine.Count(), 'Two invoice lines created');
        InvoiceLine.FindSet();
        repeat
            Assert.AreEqual(99.99, InvoiceLine.Amount, StrSubstNo('Invoice line %1 keeps the amount a subscriber set', InvoiceLine."Schedule Line No."));
        until InvoiceLine.Next() = 0;
        Assert.AreEqual(2, Spy.AfterEvents(), 'One after event per created line');
    end;

    [Test]
    procedure HandledLineNotInsertedButInvoiced()
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        ScheduleLine: Record "CGR Lease Schedule Line";
        Spy: Codeunit "HX038 Invoicing Spy";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        InitRun();
        InsertLease('HX38-HANDLED');
        Spy.SetHandledLine(20000);
        BindSubscription(Spy);

        Assert.AreEqual(2, LeaseInvoicing.InvoiceDueLines('HX38-HANDLED', 20270401D), 'A handled line still counts as invoiced');

        InvoiceLine.SetRange("Contract No.", 'HX38-HANDLED');
        Assert.AreEqual(1, InvoiceLine.Count(), 'The handled line is not inserted');
        Assert.IsTrue(InvoiceLine.Get('HX38-HANDLED', 10000), 'The unhandled March line is inserted');
        ScheduleLine.Get('HX38-HANDLED', 10000);
        Assert.IsTrue(ScheduleLine.Invoiced, 'March schedule line marked invoiced');
        ScheduleLine.Get('HX38-HANDLED', 20000);
        Assert.IsTrue(ScheduleLine.Invoiced, 'The handled April schedule line is marked invoiced');
        Assert.AreEqual(1, Spy.AfterEvents(), 'No after event for the handled line');
    end;

    [Test]
    procedure InvoiceDueLinesUnchanged()
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        ScheduleLine: Record "CGR Lease Schedule Line";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        InitRun();
        InsertLease('HX38-UNCHANGED');

        Assert.AreEqual(3, LeaseInvoicing.InvoiceDueLines('HX38-UNCHANGED', 20270501D), 'All three lines are invoiced');

        InvoiceLine.SetRange("Contract No.", 'HX38-UNCHANGED');
        Assert.AreEqual(3, InvoiceLine.Count(), 'Three invoice lines created');
        AssertInvoiceLine(InvoiceLine, 'HX38-UNCHANGED', 10000, 20270301D, 20270301D, 103.00);
        AssertInvoiceLine(InvoiceLine, 'HX38-UNCHANGED', 20000, 20270401D, 20270401D, 103.00);
        AssertInvoiceLine(InvoiceLine, 'HX38-UNCHANGED', 30000, 20270501D, 20270503D, 103.00);
        ScheduleLine.SetRange("Contract No.", 'HX38-UNCHANGED');
        ScheduleLine.SetRange(Invoiced, true);
        Assert.AreEqual(3, ScheduleLine.Count(), 'All three schedule lines marked invoiced');
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
        NonWorkingDay.SetRange("Non-Working Date", 20270301D, 20270531D);
        NonWorkingDay.DeleteAll();
    end;

    local procedure InsertLease(LeaseNo: Code[20])
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
        Contract."Customer Name" := 'HX038 Customer';
        Contract."Start Date" := 20270301D;
        Contract.Months := 3;
        Contract."Base Rate" := 100;
        Contract.Insert();
        LeaseMgt.CreateSchedule(LeaseNo);
    end;

    local procedure AssertInvoiceLine(var InvoiceLine: Record "CGR Lease Invoice Line"; LeaseNo: Code[20]; LineNo: Integer; DueDate: Date; InvoiceDate: Date; Amount: Decimal)
    begin
        Assert.IsTrue(InvoiceLine.Get(LeaseNo, LineNo), StrSubstNo('Line %1 of %2 exists', LineNo, LeaseNo));
        Assert.AreEqual(LeaseNo, InvoiceLine."Vehicle No.", StrSubstNo('Vehicle No. of line %1 comes from the lease', LineNo));
        Assert.AreEqual('HX038 Customer', InvoiceLine."Customer Name", StrSubstNo('Customer Name of line %1 comes from the lease', LineNo));
        Assert.AreEqual(DueDate, InvoiceLine."Due Date", StrSubstNo('Due Date of line %1', LineNo));
        Assert.AreEqual(InvoiceDate, InvoiceLine."Invoice Date", StrSubstNo('Invoice Date of line %1', LineNo));
        Assert.AreEqual(Amount, InvoiceLine.Amount, StrSubstNo('Amount of line %1', LineNo));
    end;
}
