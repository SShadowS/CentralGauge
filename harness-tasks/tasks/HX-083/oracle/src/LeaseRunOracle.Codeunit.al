codeunit 87120 "HX083 Lease Run Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure TwoLeasesSummarised()
    var
        Partner: Codeunit "HX083 Archive Partner";
        Runner: Codeunit "HX083 Run Runner";
    begin
        HX83Init();
        HX83InsertLease('HX83-1A', 20270301D);
        HX83InsertLease('HX83-1B', 20270301D);
        BindSubscription(Partner);

        Runner.HX83SetRun('HX83-1A|HX83-1B', 20270415D);
        Assert.IsTrue(HX83Run(Runner), 'RunLeaseSummary completes');

        Assert.AreEqual(4, Runner.HX83Added(), 'The result is the number of rows added');
        Assert.AreEqual(4, Runner.HX83RowCount(), 'The summary holds exactly the created lines');
        HX83AssertRow(Runner, 'HX83-1A', 10000);
        HX83AssertRow(Runner, 'HX83-1A', 20000);
        HX83AssertRow(Runner, 'HX83-1B', 10000);
        HX83AssertRow(Runner, 'HX83-1B', 20000);
        HX83AssertInvoiced('HX83-1A', 2);
        HX83AssertInvoiced('HX83-1B', 2);
    end;

    [Test]
    procedure FailedLeaseNotSummarised()
    var
        Partner: Codeunit "HX083 Archive Partner";
        Runner: Codeunit "HX083 Run Runner";
    begin
        HX83Init();
        HX83InsertLease('HX83-2A', 20270301D);
        HX83InsertLease('HX83-2F', 20270301D);
        HX83InsertLease('HX83-2G', 20270301D);
        Partner.HX83RefuseLine('HX83-2F', 20000, false);
        BindSubscription(Partner);

        Runner.HX83SetRun('HX83-2A|HX83-2F|HX83-2G', 20270415D);
        Assert.IsTrue(HX83Run(Runner), 'A failed lease does not stop the run');

        Assert.IsTrue(Partner.HX83Saw('HX83-2F', 10000), 'Precondition: the failed lease created its first line before the refusal');
        Assert.IsTrue(Partner.HX83Saw('HX83-2F', 20000), 'Precondition: the archive app refused the second line');
        Assert.AreEqual(4, Runner.HX83Added(), 'Rows of the failed lease are not counted');
        Assert.AreEqual(4, Runner.HX83RowCount(), 'The summary holds only the lines of the leases that succeeded');
        HX83AssertRow(Runner, 'HX83-2A', 10000);
        HX83AssertRow(Runner, 'HX83-2A', 20000);
        HX83AssertRow(Runner, 'HX83-2G', 10000);
        HX83AssertRow(Runner, 'HX83-2G', 20000);
        HX83AssertInvoiced('HX83-2F', 0);
        HX83AssertInvoiced('HX83-2A', 2);
        HX83AssertInvoiced('HX83-2G', 2);
    end;

    [Test]
    procedure RefusalAfterInvoicingNotSummarised()
    var
        Partner: Codeunit "HX083 Archive Partner";
        Runner: Codeunit "HX083 Run Runner";
    begin
        HX83Init();
        HX83InsertLease('HX83-3A', 20270301D);
        HX83InsertLease('HX83-3F', 20270301D);
        Partner.HX83RefuseAfter('HX83-3F');
        BindSubscription(Partner);

        Runner.HX83SetRun('HX83-3A|HX83-3F', 20270415D);
        Assert.IsTrue(HX83Run(Runner), 'A failed lease does not stop the run');

        Assert.IsTrue(Partner.HX83Saw('HX83-3F', 10000), 'Precondition: the failed lease created its first line');
        Assert.IsTrue(Partner.HX83Saw('HX83-3F', 20000), 'Precondition: the failed lease created its second line');
        Assert.IsTrue(Partner.HX83AfterRefused(), 'Precondition: the archive app refused the lease after its lines');
        Assert.AreEqual(2, Runner.HX83Added(), 'Rows of the failed lease are not counted');
        Assert.AreEqual(2, Runner.HX83RowCount(), 'The summary holds only the lines of the lease that succeeded');
        HX83AssertRow(Runner, 'HX83-3A', 10000);
        HX83AssertRow(Runner, 'HX83-3A', 20000);
        HX83AssertInvoiced('HX83-3F', 0);
        HX83AssertInvoiced('HX83-3A', 2);
    end;

    [Test]
    procedure EarlierRowsKept()
    var
        Seed: Record "CGR Lease Invoice Line";
        Partner: Codeunit "HX083 Archive Partner";
        Runner: Codeunit "HX083 Run Runner";
    begin
        HX83Init();
        HX83InsertLease('HX83-4A', 20270301D);
        BindSubscription(Partner);
        HX83SeedRow(Runner, Seed, 'HX83-4Z');

        Runner.HX83SetRun('HX83-4A', 20270315D);
        Assert.IsTrue(HX83Run(Runner), 'First run completes');
        Assert.AreEqual(1, Runner.HX83Added(), 'First run: the result counts only the rows it added');
        Assert.AreEqual(2, Runner.HX83RowCount(), 'First run: the seeded row and the new line');
        HX83AssertRow(Runner, 'HX83-4A', 10000);

        Partner.HX83RefuseLine('HX83-4A', 30000, false);
        Runner.HX83SetRun('HX83-4A', 20270515D);
        Assert.IsTrue(HX83Run(Runner), 'Second run completes although the lease fails');

        Assert.IsTrue(Partner.HX83Saw('HX83-4A', 20000), 'Precondition: the second run created line 20000 before the refusal');
        Assert.IsTrue(Partner.HX83Saw('HX83-4A', 30000), 'Precondition: the archive app refused line 30000');
        Assert.AreEqual(0, Runner.HX83Added(), 'Second run: a failed lease adds nothing');
        Assert.AreEqual(2, Runner.HX83RowCount(), 'Rows the summary already held stay');
        HX83AssertSeeded(Runner, Seed);
        HX83AssertRow(Runner, 'HX83-4A', 10000);
        HX83AssertInvoiced('HX83-4A', 1);
    end;

    [Test]
    procedure EarlierInvoicedLinesNotListed()
    var
        Stored: Record "CGR Lease Invoice Line";
        LeaseInvoicing: Codeunit "CGR Lease Invoicing";
        Partner: Codeunit "HX083 Archive Partner";
        Runner: Codeunit "HX083 Run Runner";
    begin
        HX83Init();
        HX83InsertLease('HX83-5C', 20270301D);
        LeaseInvoicing.InvoiceDueLines('HX83-5C', 20270315D);
        Assert.IsTrue(Stored.Get('HX83-5C', 10000), 'Precondition: line 10000 was invoiced before the run');
        HX83AssertInvoiced('HX83-5C', 1);
        BindSubscription(Partner);

        Runner.HX83SetRun('HX83-5C', 20270415D);
        Assert.IsTrue(HX83Run(Runner), 'RunLeaseSummary completes');

        Assert.AreEqual(1, Runner.HX83Added(), 'Only the line this run created is counted');
        Assert.AreEqual(1, Runner.HX83RowCount(), 'Lines invoiced before the run are not listed');
        HX83AssertRow(Runner, 'HX83-5C', 20000);
        HX83AssertInvoiced('HX83-5C', 2);
    end;

    [Test]
    procedure CommittingArchiveKeepsNothing()
    var
        Partner: Codeunit "HX083 Archive Partner";
        Runner: Codeunit "HX083 Run Runner";
    begin
        HX83Init();
        HX83InsertLease('HX83-6A', 20270301D);
        HX83InsertLease('HX83-6F', 20270301D);
        HX83InsertLease('HX83-6G', 20270301D);
        Partner.HX83RefuseLine('HX83-6F', 20000, true);
        BindSubscription(Partner);

        Runner.HX83SetRun('HX83-6A|HX83-6F|HX83-6G', 20270415D);
        Assert.IsTrue(HX83Run(Runner), 'A failed lease does not stop the run');

        Assert.IsTrue(Partner.HX83Saw('HX83-6F', 20000), 'Precondition: the archive app committed and refused line 20000');
        Assert.AreEqual(4, Runner.HX83Added(), 'Rows of the failed lease are not counted');
        Assert.AreEqual(4, Runner.HX83RowCount(), 'The summary holds only the lines of the leases that succeeded');
        HX83AssertRow(Runner, 'HX83-6A', 10000);
        HX83AssertRow(Runner, 'HX83-6A', 20000);
        HX83AssertRow(Runner, 'HX83-6G', 10000);
        HX83AssertRow(Runner, 'HX83-6G', 20000);
        HX83AssertInvoiced('HX83-6F', 0);
        HX83AssertInvoiced('HX83-6A', 2);
        HX83AssertInvoiced('HX83-6G', 2);
    end;

    [Test]
    procedure FilterAndDatesRespected()
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
        Partner: Codeunit "HX083 Archive Partner";
        Runner: Codeunit "HX083 Run Runner";
    begin
        HX83Init();
        HX83InsertLease('HX83-7A', 20270301D);
        HX83InsertLease('HX83-7O', 20270301D);
        ScheduleLine.Get('HX83-7O', 10000);
        Assert.AreEqual(20270301D, ScheduleLine."Due Date", 'Precondition: the lease outside the filter has a line due');
        BindSubscription(Partner);

        Runner.HX83SetRun('HX83-7A', 20270315D);
        Assert.IsTrue(HX83Run(Runner), 'RunLeaseSummary completes');

        Assert.AreEqual(1, Runner.HX83Added(), 'One line due up to the date');
        Assert.AreEqual(1, Runner.HX83RowCount(), 'Only the line due up to the date of the lease in the filter');
        HX83AssertRow(Runner, 'HX83-7A', 10000);
        HX83AssertInvoiced('HX83-7A', 1);
        HX83AssertInvoiced('HX83-7O', 0);
    end;

    [Test]
    procedure NothingDue()
    var
        Seed: Record "CGR Lease Invoice Line";
        ScheduleLine: Record "CGR Lease Schedule Line";
        Partner: Codeunit "HX083 Archive Partner";
        Runner: Codeunit "HX083 Run Runner";
    begin
        HX83Init();
        HX83InsertLease('HX83-8A', 20270601D);
        ScheduleLine.SetRange("Contract No.", 'HX83-8A');
        Assert.AreEqual(3, ScheduleLine.Count(), 'Precondition: the lease has its schedule');
        BindSubscription(Partner);
        HX83SeedRow(Runner, Seed, 'HX83-8Z');

        Runner.HX83SetRun('HX83-8A', 20270415D);
        Assert.IsTrue(HX83Run(Runner), 'RunLeaseSummary completes');

        Assert.AreEqual(0, Runner.HX83Added(), 'Nothing due adds nothing');
        Assert.AreEqual(1, Runner.HX83RowCount(), 'The summary keeps only its seeded row');
        HX83AssertSeeded(Runner, Seed);
        HX83AssertInvoiced('HX83-8A', 0);
    end;

    local procedure HX83Run(var Runner: Codeunit "HX083 Run Runner"): Boolean
    begin
        Commit();
        exit(Runner.Run());
    end;

    local procedure HX83Init()
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
        NonWorkingDay.SetRange("Non-Working Date", 20270301D, 20270531D);
        NonWorkingDay.DeleteAll();
    end;

    local procedure HX83InsertLease(LeaseNo: Code[20]; StartDate: Date)
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
        Contract."Vehicle No." := 'HX083-V' + CopyStr(LeaseNo, 6);
        Contract."Customer Name" := 'HX083 Customer ' + CopyStr(LeaseNo, 6);
        Contract."Start Date" := StartDate;
        Contract.Months := 3;
        Contract."Base Rate" := 100;
        Contract.Insert();
        LeaseMgt.CreateSchedule(LeaseNo);
    end;

    local procedure HX83SeedRow(var Runner: Codeunit "HX083 Run Runner"; var Seed: Record "CGR Lease Invoice Line"; LeaseNo: Code[20])
    begin
        Seed.Init();
        Seed."Contract No." := LeaseNo;
        Seed."Schedule Line No." := 10000;
        Seed."Vehicle No." := 'HX083-SEEDED';
        Seed."Customer Name" := 'HX083 Seeded Customer';
        Seed."Due Date" := 20270201D;
        Seed."Invoice Date" := 20270202D;
        Seed.Amount := 77.77;
        Runner.HX83Seed(Seed);
    end;

    local procedure HX83AssertSeeded(var Runner: Codeunit "HX083 Run Runner"; Seed: Record "CGR Lease Invoice Line")
    var
        Row: Record "CGR Lease Invoice Line";
    begin
        Assert.IsTrue(Runner.HX83FindRow(Seed."Contract No.", Seed."Schedule Line No.", Row), 'The row the summary already held stays');
        Assert.AreEqual(Seed."Vehicle No.", Row."Vehicle No.", 'Seeded row: Vehicle No. unchanged');
        Assert.AreEqual(Seed."Customer Name", Row."Customer Name", 'Seeded row: Customer Name unchanged');
        Assert.AreEqual(Seed."Due Date", Row."Due Date", 'Seeded row: Due Date unchanged');
        Assert.AreEqual(Seed."Invoice Date", Row."Invoice Date", 'Seeded row: Invoice Date unchanged');
        Assert.AreEqual(Seed.Amount, Row.Amount, 'Seeded row: Amount unchanged');
    end;

    local procedure HX83AssertRow(var Runner: Codeunit "HX083 Run Runner"; LeaseNo: Code[20]; LineNo: Integer)
    var
        Stored: Record "CGR Lease Invoice Line";
        Row: Record "CGR Lease Invoice Line";
    begin
        Assert.IsTrue(Stored.Get(LeaseNo, LineNo), StrSubstNo('Invoice line %1 %2 exists', LeaseNo, LineNo));
        Assert.IsTrue(Runner.HX83FindRow(LeaseNo, LineNo, Row), StrSubstNo('The summary lists %1 %2', LeaseNo, LineNo));
        Assert.AreEqual(Stored."Vehicle No.", Row."Vehicle No.", StrSubstNo('Vehicle No. of %1 %2', LeaseNo, LineNo));
        Assert.AreEqual(Stored."Customer Name", Row."Customer Name", StrSubstNo('Customer Name of %1 %2', LeaseNo, LineNo));
        Assert.AreEqual(Stored."Due Date", Row."Due Date", StrSubstNo('Due Date of %1 %2', LeaseNo, LineNo));
        Assert.AreEqual(Stored."Invoice Date", Row."Invoice Date", StrSubstNo('Invoice Date of %1 %2', LeaseNo, LineNo));
        Assert.AreEqual(Stored.Amount, Row.Amount, StrSubstNo('Amount of %1 %2', LeaseNo, LineNo));
    end;

    local procedure HX83AssertInvoiced(LeaseNo: Code[20]; ExpectedLines: Integer)
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
