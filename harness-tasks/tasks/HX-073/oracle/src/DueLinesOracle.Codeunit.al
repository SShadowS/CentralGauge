// Every procedure sets its own WorkDate, Setup and non-working days and uses its own leases HX073-<row><x>,
// cleaned first. Lease schedule: due 2027-03-01 (Mon), 2027-04-01 (Thu), 2027-05-01 (Sat), amounts 101.11, 202.22, 303.33.
codeunit 86920 "HX073 Due Lines Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure DueLinesHandedOut()
    var
        TempDueLine: Record "CGR Lease Schedule Line" temporary;
        ScheduleLine: Record "CGR Lease Schedule Line";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        HX73Prepare();
        HX73Lease('HX073-1A');

        Assert.AreEqual(2, LeaseInvoicing.GetDueLines('HX073-1A', 20270401D, TempDueLine), 'March and April are due up to 1 April');

        TempDueLine.Reset();
        Assert.AreEqual(2, TempDueLine.Count(), 'The buffer holds the two due lines');
        HX73AssertHandedOut(TempDueLine, 'HX073-1A', 10000, 20270301D, 101.11);
        HX73AssertHandedOut(TempDueLine, 'HX073-1A', 20000, 20270401D, 202.22);
        TempDueLine.FindSet();
        repeat
            ScheduleLine.Get(TempDueLine."Contract No.", TempDueLine."Line No.");
            Assert.AreEqual(ScheduleLine."Due Date", TempDueLine."Due Date", StrSubstNo('Due Date of line %1 equals the stored line', TempDueLine."Line No."));
            Assert.AreEqual(ScheduleLine.Amount, TempDueLine.Amount, StrSubstNo('Amount of line %1 equals the stored line', TempDueLine."Line No."));
            Assert.AreEqual(ScheduleLine.Invoiced, TempDueLine.Invoiced, StrSubstNo('Invoiced of line %1 equals the stored line', TempDueLine."Line No."));
        until TempDueLine.Next() = 0;
    end;

    [Test]
    procedure InvoicedAndOtherLeasesExcluded()
    var
        TempDueLine: Record "CGR Lease Schedule Line" temporary;
        ScheduleLine: Record "CGR Lease Schedule Line";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        HX73Prepare();
        HX73Lease('HX073-2A');
        HX73Lease('HX073-2B');
        ScheduleLine.Get('HX073-2A', 10000);
        ScheduleLine.Invoiced := true;
        ScheduleLine.Modify();
        ScheduleLine.Get('HX073-2A', 10000);
        Assert.IsTrue(ScheduleLine.Invoiced, 'Precondition: line 10000 of HX073-2A is invoiced');

        Assert.AreEqual(1, LeaseInvoicing.GetDueLines('HX073-2A', 20270430D, TempDueLine), 'Only April of HX073-2A is due and not invoiced');

        TempDueLine.Reset();
        Assert.AreEqual(1, TempDueLine.Count(), 'The buffer holds one line');
        Assert.IsTrue(TempDueLine.Get('HX073-2A', 20000), 'Line 20000 of HX073-2A is handed out');
        Assert.IsFalse(TempDueLine.Get('HX073-2A', 10000), 'The invoiced line is not handed out');
        Assert.IsFalse(TempDueLine.Get('HX073-2A', 30000), 'The May line is not due by 30 April');
        TempDueLine.SetRange("Contract No.", 'HX073-2B');
        Assert.AreEqual(0, TempDueLine.Count(), 'No line of another lease is handed out');
    end;

    [Test]
    procedure CallerBufferReplaced()
    var
        TempDueLine: Record "CGR Lease Schedule Line" temporary;
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        HX73Prepare();
        HX73Lease('HX073-3A');
        TempDueLine.Init();
        TempDueLine."Contract No." := 'HX073-3X';
        TempDueLine."Line No." := 10000;
        TempDueLine."Due Date" := 20270201D;
        TempDueLine.Amount := 55.55;
        TempDueLine.Insert();
        Assert.AreEqual(1, TempDueLine.Count(), 'Precondition: the buffer holds the foreign row');

        Assert.AreEqual(1, LeaseInvoicing.GetDueLines('HX073-3A', 20270301D, TempDueLine), 'Only March is due on 1 March');

        TempDueLine.Reset();
        Assert.AreEqual(1, TempDueLine.Count(), 'The buffer holds only the lease''s due line');
        Assert.IsTrue(TempDueLine.Get('HX073-3A', 10000), 'Line 10000 of HX073-3A is handed out');
        Assert.IsFalse(TempDueLine.Get('HX073-3X', 10000), 'The row the buffer held before is gone');
    end;

    [Test]
    procedure FilteredBufferReplaced()
    var
        TempDueLine: Record "CGR Lease Schedule Line" temporary;
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        HX73Prepare();
        HX73Lease('HX073-10A');
        TempDueLine.Init();
        TempDueLine."Contract No." := 'HX073-10X';
        TempDueLine."Line No." := 10000;
        TempDueLine."Due Date" := 20270201D;
        TempDueLine.Amount := 55.55;
        TempDueLine.Insert();
        TempDueLine.SetRange("Contract No.", 'HX073-10A');
        Assert.AreEqual(0, TempDueLine.Count(), 'Precondition: the caller''s filter hides the foreign row');

        Assert.AreEqual(2, LeaseInvoicing.GetDueLines('HX073-10A', 20270401D, TempDueLine), 'March and April are due up to 1 April');

        TempDueLine.Reset();
        Assert.AreEqual(2, TempDueLine.Count(), 'The buffer holds only the lease''s two due lines');
        Assert.IsTrue(TempDueLine.Get('HX073-10A', 10000), 'Line 10000 of HX073-10A is handed out');
        Assert.IsTrue(TempDueLine.Get('HX073-10A', 20000), 'Line 20000 of HX073-10A is handed out');
        Assert.IsFalse(TempDueLine.Get('HX073-10X', 10000), 'The row the filter hid is gone');
    end;

    [Test]
    procedure UpToDateBoundaries()
    var
        TempDueLine: Record "CGR Lease Schedule Line" temporary;
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        HX73Prepare();
        HX73Lease('HX073-4A');

        Assert.AreEqual(2, LeaseInvoicing.GetDueLines('HX073-4A', 20270401D, TempDueLine), 'A line due on the date itself is due');
        TempDueLine.Reset();
        Assert.AreEqual(2, TempDueLine.Count(), 'Up to 1 April: two lines');
        Assert.IsTrue(TempDueLine.Get('HX073-4A', 20000), 'Up to 1 April: the April line is handed out');

        Assert.AreEqual(0, LeaseInvoicing.GetDueLines('HX073-4A', 20270228D, TempDueLine), 'Nothing is due up to 28 February');
        TempDueLine.Reset();
        Assert.AreEqual(0, TempDueLine.Count(), 'Up to 28 February: the buffer is empty');

        Assert.AreEqual(1, LeaseInvoicing.GetDueLines('HX073-4A', 20270331D, TempDueLine), 'Only March is due up to 31 March');
        TempDueLine.Reset();
        Assert.AreEqual(1, TempDueLine.Count(), 'Up to 31 March: one line');
        Assert.IsTrue(TempDueLine.Get('HX073-4A', 10000), 'Up to 31 March: the March line is handed out');
    end;

    [Test]
    procedure GetDueLinesChangesNothing()
    var
        TempDueLine: Record "CGR Lease Schedule Line" temporary;
        Contract: Record "CGR Lease Contract";
        InvoiceLine: Record "CGR Lease Invoice Line";
        ScheduleLine: Record "CGR Lease Schedule Line";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        HX73Prepare();
        HX73Lease('HX073-5A');

        Assert.AreEqual(3, LeaseInvoicing.GetDueLines('HX073-5A', 20270531D, TempDueLine), 'All three lines are due up to 31 May');
        TempDueLine.Reset();
        Assert.AreEqual(3, TempDueLine.Count(), 'The buffer holds the three lines');

        HX73AssertStored('HX073-5A', 10000, 101.11, false);
        HX73AssertStored('HX073-5A', 20000, 202.22, false);
        HX73AssertStored('HX073-5A', 30000, 303.33, false);
        ScheduleLine.SetRange("Contract No.", 'HX073-5A');
        Assert.AreEqual(3, ScheduleLine.Count(), 'The schedule keeps its three lines');
        InvoiceLine.SetRange("Contract No.", 'HX073-5A');
        Assert.AreEqual(0, InvoiceLine.Count(), 'No invoice line is created');
        Contract.Get('HX073-5A');
        Assert.AreEqual('HX073-5A', Contract."Vehicle No.", 'Lease vehicle unchanged');
        Assert.AreEqual('HX073 Customer', Contract."Customer Name", 'Lease customer unchanged');
        Assert.AreEqual(20270301D, Contract."Start Date", 'Lease start unchanged');
        Assert.AreEqual(3, Contract.Months, 'Lease months unchanged');
        Assert.AreEqual(100, Contract."Base Rate", 'Lease base rate unchanged');
    end;

    [Test]
    procedure InvoiceDueLinesAsToday()
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        HX73Prepare();
        HX73Lease('HX073-6A');

        Assert.AreEqual(2, LeaseInvoicing.InvoiceDueLines('HX073-6A', 20270401D), 'March and April are invoiced');

        InvoiceLine.SetRange("Contract No.", 'HX073-6A');
        Assert.AreEqual(2, InvoiceLine.Count(), 'Two invoice lines');
        HX73AssertInvoiceLine('HX073-6A', 10000, 20270301D, 20270301D, 101.11);
        HX73AssertInvoiceLine('HX073-6A', 20000, 20270401D, 20270401D, 202.22);
        HX73AssertStored('HX073-6A', 10000, 101.11, true);
        HX73AssertStored('HX073-6A', 20000, 202.22, true);
        HX73AssertStored('HX073-6A', 30000, 303.33, false);
    end;

    [Test]
    procedure SecondRunInvoicesNothing()
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        Runner: Codeunit "HX073 Due Lines Runner";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
        Ok: Boolean;
    begin
        HX73Prepare();
        HX73Lease('HX073-7A');
        Assert.AreEqual(2, LeaseInvoicing.InvoiceDueLines('HX073-7A', 20270401D), 'Precondition: the first run invoices March and April');
        Runner.HX73SetInvoice('HX073-7A', 20270401D);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, StrSubstNo('The second run succeeds: %1', GetLastErrorText()));
        Assert.AreEqual(0, Runner.HX73LineCount(), 'The second run invoices nothing');
        InvoiceLine.SetRange("Contract No.", 'HX073-7A');
        Assert.AreEqual(2, InvoiceLine.Count(), 'Still two invoice lines');
    end;

    [Test]
    procedure MissingLeaseRaises()
    var
        Contract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
        Runner: Codeunit "HX073 Due Lines Runner";
        Ok: Boolean;
    begin
        HX73Prepare();
        ScheduleLine.SetRange("Contract No.", 'HX073-NONE');
        ScheduleLine.DeleteAll();
        if Contract.Get('HX073-NONE') then
            Contract.Delete();
        Runner.HX73SetDueLines('HX073-NONE', 20270401D);

        Commit();
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'A lease that does not exist raises an error');
        Assert.AreEqual('The CGR Lease Contract does not exist. Identification fields and values: No.=''HX073-NONE''', GetLastErrorText(), 'The platform''s not-found error');
    end;

    [Test]
    procedure HandledLinesStillMarked()
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
        HandledLines: Codeunit "HX073 Handled Lines";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        HX73Prepare();
        HX73Lease('HX073-9A');
        HandledLines.HX73SetHandled(true);
        BindSubscription(HandledLines);

        Assert.AreEqual(2, LeaseInvoicing.InvoiceDueLines('HX073-9A', 20270401D), 'Handled lines still count as invoiced');

        InvoiceLine.SetRange("Contract No.", 'HX073-9A');
        Assert.AreEqual(0, InvoiceLine.Count(), 'A handled line is not inserted');
        HX73AssertStored('HX073-9A', 10000, 101.11, true);
        HX73AssertStored('HX073-9A', 20000, 202.22, true);
        HX73AssertStored('HX073-9A', 30000, 303.33, false);
    end;

    local procedure HX73AssertHandedOut(var TempDueLine: Record "CGR Lease Schedule Line" temporary; ContractNo: Code[20]; LineNo: Integer; DueDate: Date; Amount: Decimal)
    begin
        Assert.IsTrue(TempDueLine.Get(ContractNo, LineNo), StrSubstNo('Line %1 of %2 is handed out', LineNo, ContractNo));
        Assert.AreEqual(ContractNo, TempDueLine."Contract No.", StrSubstNo('Contract No. of line %1', LineNo));
        Assert.AreEqual(LineNo, TempDueLine."Line No.", StrSubstNo('Line No. of line %1', LineNo));
        Assert.AreEqual(DueDate, TempDueLine."Due Date", StrSubstNo('Due Date of line %1', LineNo));
        Assert.AreEqual(Amount, TempDueLine.Amount, StrSubstNo('Amount of line %1', LineNo));
        Assert.IsFalse(TempDueLine.Invoiced, StrSubstNo('Line %1 is handed out not invoiced', LineNo));
    end;

    local procedure HX73AssertStored(ContractNo: Code[20]; LineNo: Integer; Amount: Decimal; IsInvoiced: Boolean)
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        ScheduleLine.Get(ContractNo, LineNo);
        Assert.AreEqual(IsInvoiced, ScheduleLine.Invoiced, StrSubstNo('Stored line %1 of %2: Invoiced', LineNo, ContractNo));
        Assert.AreEqual(Amount, ScheduleLine.Amount, StrSubstNo('Stored line %1 of %2: Amount', LineNo, ContractNo));
    end;

    local procedure HX73AssertInvoiceLine(ContractNo: Code[20]; LineNo: Integer; DueDate: Date; InvoiceDate: Date; Amount: Decimal)
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
    begin
        Assert.IsTrue(InvoiceLine.Get(ContractNo, LineNo), StrSubstNo('Invoice line %1 of %2 exists', LineNo, ContractNo));
        Assert.AreEqual(ContractNo, InvoiceLine."Vehicle No.", StrSubstNo('Vehicle No. of invoice line %1', LineNo));
        Assert.AreEqual('HX073 Customer', InvoiceLine."Customer Name", StrSubstNo('Customer Name of invoice line %1', LineNo));
        Assert.AreEqual(DueDate, InvoiceLine."Due Date", StrSubstNo('Due Date of invoice line %1', LineNo));
        Assert.AreEqual(InvoiceDate, InvoiceLine."Invoice Date", StrSubstNo('Invoice Date of invoice line %1', LineNo));
        Assert.AreEqual(Amount, InvoiceLine.Amount, StrSubstNo('Amount of invoice line %1', LineNo));
    end;

    local procedure HX73Prepare()
    var
        Setup: Record "CGR Setup";
        NonWorkingDay: Record "CGR Non-Working Day";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Default Branch Code" := '';
        Setup."Outbox Max Attempts" := 3;
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();
        NonWorkingDay.SetRange("Non-Working Date", 20270101D, 20271231D);
        NonWorkingDay.DeleteAll();
    end;

    local procedure HX73Lease(LeaseNo: Code[20])
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
        Contract."Customer Name" := 'HX073 Customer';
        Contract."Start Date" := 20270301D;
        Contract.Months := 3;
        Contract."Base Rate" := 100;
        Contract.Insert();
        LeaseMgt.CreateSchedule(LeaseNo);
        HX73SetAmount(LeaseNo, 10000, 101.11);
        HX73SetAmount(LeaseNo, 20000, 202.22);
        HX73SetAmount(LeaseNo, 30000, 303.33);
    end;

    local procedure HX73SetAmount(LeaseNo: Code[20]; LineNo: Integer; Amount: Decimal)
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        ScheduleLine.Get(LeaseNo, LineNo);
        ScheduleLine.Amount := Amount;
        ScheduleLine.Modify();
    end;
}
