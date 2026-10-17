// Every procedure sets its own WorkDate, Setup and non-working days and uses its own leases HX075-<row><x>, cleaned first.
// Lease schedule: due 2027-03-01, 2027-04-01, 2027-05-01. N is the stored "Last Lease Invoice No." at the start of the
// procedure; every expected number is relative to it, so the rows hold alone and in any order.
codeunit 86960 "HX075 Invoice Number Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure OneNumberPerCall()
    var
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
        N: Integer;
    begin
        HX75Prepare();
        HX75Lease('HX075-1A');
        HX75Lease('HX075-1B');
        N := HX75Counter();

        Assert.AreEqual(2, LeaseInvoicing.InvoiceDueLines('HX075-1A', 20270401D), 'HX075-1A: March and April are invoiced');
        Assert.AreEqual(2, LeaseInvoicing.InvoiceDueLines('HX075-1B', 20270401D), 'HX075-1B: March and April are invoiced');

        HX75AssertNumbered('HX075-1A', 2, HX75No(N + 1));
        HX75AssertNumbered('HX075-1B', 2, HX75No(N + 2));
        Assert.AreEqual(N + 2, HX75Counter(), 'Two calls stored two numbers');
    end;

    [Test]
    procedure NextNumberDirect()
    var
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
        N: Integer;
    begin
        HX75Prepare();
        N := HX75Counter();

        Assert.AreEqual(HX75No(N + 1), LeaseInvoicing.NextLeaseInvoiceNo(), 'First number is the stored value + 1');
        Assert.AreEqual(HX75No(N + 2), LeaseInvoicing.NextLeaseInvoiceNo(), 'Second number follows');
        Assert.AreEqual(N + 2, HX75Counter(), 'The last number handed out is stored');
    end;

    [Test]
    procedure FailedLeaseNumberReused()
    var
        Partner: Codeunit "HX075 Invoice Partner";
        Runner: Codeunit "HX075 Invoice Runner";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
        N: Integer;
        Ok: Boolean;
    begin
        HX75Prepare();
        HX75Lease('HX075-3A');
        HX75Lease('HX075-3B');
        N := HX75Counter();
        Partner.HX75SetLine('HX075-3A', 20000, false, true);
        BindSubscription(Partner);
        Runner.HX75SetInvoice('HX075-3A', 20270401D);

        Commit();
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'Invoicing HX075-3A fails when the partner refuses line 20000');
        Assert.AreEqual('HX075 archive refused HX075-3A line 20000.', GetLastErrorText(), 'The partner''s error');
        HX75AssertNumbered('HX075-3A', 0, '');
        HX75AssertMarked('HX075-3A', 10000, false);
        HX75AssertMarked('HX075-3A', 20000, false);

        Assert.AreEqual(2, LeaseInvoicing.InvoiceDueLines('HX075-3B', 20270401D), 'HX075-3B: March and April are invoiced');
        HX75AssertNumbered('HX075-3B', 2, HX75No(N + 1));
        Assert.AreEqual(N + 1, HX75Counter(), 'Only the successful call keeps a number');
    end;

    [Test]
    procedure CommittingPartnerFailureKeepsNothing()
    var
        Partner: Codeunit "HX075 Invoice Partner";
        Runner: Codeunit "HX075 Invoice Runner";
        N: Integer;
        Ok: Boolean;
    begin
        HX75Prepare();
        HX75Lease('HX075-4A');
        N := HX75Counter();
        Partner.HX75SetLine('HX075-4A', 20000, true, true);
        BindSubscription(Partner);
        Runner.HX75SetInvoice('HX075-4A', 20270401D);

        Commit();
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'Invoicing HX075-4A fails when the partner commits and then refuses line 20000');
        Assert.AreEqual('HX075 archive refused HX075-4A line 20000.', GetLastErrorText(), 'The partner''s error');
        HX75AssertNumbered('HX075-4A', 0, '');
        HX75AssertMarked('HX075-4A', 10000, false);
        HX75AssertMarked('HX075-4A', 20000, false);
        Assert.AreEqual(N, HX75Counter(), 'The failed call keeps no number');
    end;

    [Test]
    procedure CommittingPartnerInvoicesNormally()
    var
        Partner: Codeunit "HX075 Invoice Partner";
        Runner: Codeunit "HX075 Invoice Runner";
        N: Integer;
        Ok: Boolean;
    begin
        HX75Prepare();
        HX75Lease('HX075-5A');
        N := HX75Counter();
        Partner.HX75SetLine('HX075-5A', 10000, true, false);
        BindSubscription(Partner);
        Runner.HX75SetInvoice('HX075-5A', 20270401D);

        Commit();
        Ok := Runner.Run();

        Assert.IsTrue(Ok, StrSubstNo('Invoicing HX075-5A succeeds with a committing partner: %1', GetLastErrorText()));
        HX75AssertNumbered('HX075-5A', 2, HX75No(N + 1));
        HX75AssertMarked('HX075-5A', 10000, true);
        HX75AssertMarked('HX075-5A', 20000, true);
        HX75AssertMarked('HX075-5A', 30000, false);
        Assert.AreEqual(N + 1, HX75Counter(), 'The call stored one number');
    end;

    [Test]
    procedure NothingDueTakesNoNumber()
    var
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
        N: Integer;
    begin
        HX75Prepare();
        HX75Lease('HX075-6A');
        N := HX75Counter();

        Assert.AreEqual(0, LeaseInvoicing.InvoiceDueLines('HX075-6A', 20270228D), 'Nothing is due up to 28 February');

        HX75AssertNumbered('HX075-6A', 0, '');
        Assert.AreEqual(N, HX75Counter(), 'A call that invoices nothing takes no number');
    end;

    [Test]
    procedure HandledLinesTakeNoNumber()
    var
        Partner: Codeunit "HX075 Invoice Partner";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
        N: Integer;
    begin
        HX75Prepare();
        HX75Lease('HX075-7A');
        N := HX75Counter();
        Partner.HX75SetHandled(true);
        BindSubscription(Partner);

        Assert.AreEqual(2, LeaseInvoicing.InvoiceDueLines('HX075-7A', 20270401D), 'Handled lines still count as invoiced');

        HX75AssertNumbered('HX075-7A', 0, '');
        HX75AssertMarked('HX075-7A', 10000, true);
        HX75AssertMarked('HX075-7A', 20000, true);
        Assert.AreEqual(N, HX75Counter(), 'A call whose lines are all handled takes no number');
    end;

    [Test]
    procedure FailedCallerHandsNumberAgain()
    var
        Runner: Codeunit "HX075 Invoice Runner";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
        N: Integer;
        Ok: Boolean;
    begin
        HX75Prepare();
        N := HX75Counter();
        Runner.HX75SetNumberThenFail();

        Commit();
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'The caller fails after taking a number');
        Assert.AreEqual('HX075 later step failed.', GetLastErrorText(), 'The caller''s error');
        Assert.AreEqual(N, HX75Counter(), 'The failed transaction keeps no number');
        Assert.AreEqual(HX75No(N + 1), LeaseInvoicing.NextLeaseInvoiceNo(), 'The number is handed out again');
        Assert.AreEqual(N + 1, HX75Counter(), 'The number handed out again is stored');
    end;

    [Test]
    procedure NoSetupStartsAtOne()
    var
        Setup: Record "CGR Setup";
        InvoiceLine: Record "CGR Lease Invoice Line";
        Runner: Codeunit "HX075 Invoice Runner";
        RunError: Text;
        SetupFound: Boolean;
        StoredNo: Integer;
        Ok: Boolean;
    begin
        HX75Prepare();
        HX75Lease('HX075-9A');
        Setup.Get();
        Setup.Delete();
        Assert.IsFalse(Setup.Get(), 'Precondition: no CGR Setup record');
        Runner.HX75SetInvoice('HX075-9A', 20270301D);

        Commit();
        Ok := Runner.Run();
        RunError := GetLastErrorText();

        SetupFound := Setup.Get();
        StoredNo := Setup."Last Lease Invoice No.";
        HX75Prepare();
        Assert.IsTrue(Ok, StrSubstNo('Invoicing HX075-9A without a CGR Setup record succeeds: %1', RunError));
        Assert.IsTrue(SetupFound, 'A CGR Setup record exists after the first number');
        Assert.AreEqual(1, StoredNo, 'Numbering starts at 1');
        InvoiceLine.SetRange("Contract No.", 'HX075-9A');
        Assert.AreEqual(1, InvoiceLine.Count(), 'March is invoiced');
        InvoiceLine.Get('HX075-9A', 10000);
        Assert.AreEqual('LI1', InvoiceLine."Invoice No.", 'The first number without a CGR Setup record');
    end;

    [Test]
    procedure NoSetupDirectStartsAtOne()
    var
        Setup: Record "CGR Setup";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
        InvoiceNo: Code[20];
        SetupFound: Boolean;
        StoredNo: Integer;
    begin
        HX75Prepare();
        Setup.Get();
        Setup.Delete();
        Assert.IsFalse(Setup.Get(), 'Precondition: no CGR Setup record');

        InvoiceNo := LeaseInvoicing.NextLeaseInvoiceNo();

        SetupFound := Setup.Get();
        StoredNo := Setup."Last Lease Invoice No.";
        HX75Prepare();
        Assert.AreEqual('LI1', InvoiceNo, 'The first number without a CGR Setup record');
        Assert.IsTrue(SetupFound, 'A CGR Setup record exists after the first number');
        Assert.AreEqual(1, StoredNo, 'Numbering starts at 1');
    end;

    [Test]
    procedure NumberWithoutSeparators()
    var
        Setup: Record "CGR Setup";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
    begin
        HX75Prepare();
        Setup.Get();
        Setup."Last Lease Invoice No." := 999;
        Setup.Modify();
        Assert.AreEqual(999, HX75Counter(), 'Precondition: the stored number is 999');

        Assert.AreEqual('LI1000', LeaseInvoicing.NextLeaseInvoiceNo(), 'No thousands separator');
        Assert.AreEqual('LI1001', LeaseInvoicing.NextLeaseInvoiceNo(), 'The next number follows');
        Assert.AreEqual(1001, HX75Counter(), 'The last number handed out is stored');
    end;

    local procedure HX75No(Value: Integer): Code[20]
    begin
        exit(CopyStr('LI' + Format(Value, 0, 9), 1, 20));
    end;

    local procedure HX75Counter(): Integer
    var
        Setup: Record "CGR Setup";
    begin
        Setup.Get();
        exit(Setup."Last Lease Invoice No.");
    end;

    local procedure HX75AssertNumbered(LeaseNo: Code[20]; LineCount: Integer; InvoiceNo: Code[20])
    var
        InvoiceLine: Record "CGR Lease Invoice Line";
    begin
        InvoiceLine.SetRange("Contract No.", LeaseNo);
        Assert.AreEqual(LineCount, InvoiceLine.Count(), StrSubstNo('Invoice lines of %1', LeaseNo));
        if InvoiceLine.FindSet() then
            repeat
                Assert.AreEqual(InvoiceNo, InvoiceLine."Invoice No.", StrSubstNo('Invoice No. of invoice line %1 of %2', InvoiceLine."Schedule Line No.", LeaseNo));
            until InvoiceLine.Next() = 0;
    end;

    local procedure HX75AssertMarked(LeaseNo: Code[20]; LineNo: Integer; IsInvoiced: Boolean)
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        ScheduleLine.Get(LeaseNo, LineNo);
        Assert.AreEqual(IsInvoiced, ScheduleLine.Invoiced, StrSubstNo('Schedule line %1 of %2: Invoiced', LineNo, LeaseNo));
    end;

    local procedure HX75Prepare()
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

    local procedure HX75Lease(LeaseNo: Code[20])
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
        Contract."Customer Name" := 'HX075 Customer';
        Contract."Start Date" := 20270301D;
        Contract.Months := 3;
        Contract."Base Rate" := 100;
        Contract.Insert();
        LeaseMgt.CreateSchedule(LeaseNo);
    end;
}
