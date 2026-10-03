codeunit 86000 "HX027 Schedule Build Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure BuildMatchesCreatedSchedule()
    var
        TempScheduleBuffer: Record "CGR Lease Schedule Line" temporary;
        ScheduleLine: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        i: Integer;
    begin
        WorkDate(20270301D);
        InitLease('HX27-MATCH', 3, 100.10);

        LeaseMgt.BuildSchedule('HX27-MATCH', TempScheduleBuffer);
        Assert.AreEqual(3, TempScheduleBuffer.Count(), 'The built schedule has one line per month');
        AssertStandardSchedule(TempScheduleBuffer, 'HX27-MATCH');

        LeaseMgt.CreateSchedule('HX27-MATCH');
        Assert.AreEqual(3, SavedLineCount('HX27-MATCH'), 'CreateSchedule saves one line per month');
        for i := 1 to 3 do begin
            TempScheduleBuffer.Get('HX27-MATCH', i * 10000);
            ScheduleLine.Get('HX27-MATCH', i * 10000);
            Assert.AreEqual(ScheduleLine."Due Date", TempScheduleBuffer."Due Date", StrSubstNo('Built due date of line %1 equals the saved due date', i * 10000));
            Assert.AreEqual(ScheduleLine.Amount, TempScheduleBuffer.Amount, StrSubstNo('Built amount of line %1 equals the saved amount', i * 10000));
            Assert.AreEqual(ScheduleLine.Invoiced, TempScheduleBuffer.Invoiced, StrSubstNo('Built line %1 is invoiced like the saved line', i * 10000));
        end;
    end;

    [Test]
    procedure BuildSavesNothing()
    var
        TempScheduleBuffer: Record "CGR Lease Schedule Line" temporary;
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        WorkDate(20270301D);
        InitLease('HX27-NOSAVE', 3, 100.10);

        LeaseMgt.BuildSchedule('HX27-NOSAVE', TempScheduleBuffer);
        Assert.AreEqual(3, TempScheduleBuffer.Count(), 'The built schedule has one line per month');
        Assert.AreEqual(0, SavedLineCount('HX27-NOSAVE'), 'Building a schedule saves no schedule line');
    end;

    [Test]
    procedure BuildKeepsSavedSchedule()
    var
        TempScheduleBuffer: Record "CGR Lease Schedule Line" temporary;
        ScheduleLine: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        WorkDate(20270301D);
        InitLease('HX27-KEEP', 3, 100.10);
        LeaseMgt.CreateSchedule('HX27-KEEP');
        SetBaseRate('HX27-KEEP', 200);

        LeaseMgt.BuildSchedule('HX27-KEEP', TempScheduleBuffer);
        Assert.AreEqual(3, TempScheduleBuffer.Count(), 'The built schedule has one line per month');
        TempScheduleBuffer.Get('HX27-KEEP', 30000);
        Assert.AreEqual(206.00, TempScheduleBuffer.Amount, 'The built schedule uses the current base rate');
        Assert.AreEqual(3, SavedLineCount('HX27-KEEP'), 'The saved schedule keeps its lines');
        ScheduleLine.Get('HX27-KEEP', 10000);
        Assert.AreEqual(103.10, ScheduleLine.Amount, 'Saved line 10000 keeps its amount');
        ScheduleLine.Get('HX27-KEEP', 30000);
        Assert.AreEqual(103.11, ScheduleLine.Amount, 'Saved line 30000 keeps its amount');
    end;

    [Test]
    procedure BuildWorksForInvoicedLease()
    var
        TempScheduleBuffer: Record "CGR Lease Schedule Line" temporary;
        ScheduleLine: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        Ok: Boolean;
    begin
        WorkDate(20270301D);
        InitLease('HX27-INVOICED', 3, 100.10);
        LeaseMgt.CreateSchedule('HX27-INVOICED');
        LeaseMgt.InvoiceLine('HX27-INVOICED', 10000);
        Commit();

        TempScheduleBuffer.Init();
        TempScheduleBuffer."Contract No." := 'HX27-INVOICED';
        Ok := Codeunit.Run(Codeunit::"HX027 Build Runner", TempScheduleBuffer);
        Assert.IsTrue(Ok, 'A lease with invoiced lines can be built');
        TempScheduleBuffer.Reset();
        Assert.AreEqual(3, TempScheduleBuffer.Count(), 'The built schedule has one line per month');
        AssertStandardSchedule(TempScheduleBuffer, 'HX27-INVOICED');
        Assert.AreEqual(3, SavedLineCount('HX27-INVOICED'), 'The saved schedule keeps its lines');
        ScheduleLine.Get('HX27-INVOICED', 10000);
        Assert.IsTrue(ScheduleLine.Invoiced, 'The invoiced saved line stays invoiced');
    end;

    [Test]
    procedure BuildReplacesBuffer()
    var
        TempScheduleBuffer: Record "CGR Lease Schedule Line" temporary;
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        WorkDate(20270301D);
        InitLease('HX27-REPL-A', 3, 100.10);
        InitLease('HX27-REPL-E', 3, 200);

        LeaseMgt.BuildSchedule('HX27-REPL-A', TempScheduleBuffer);
        LeaseMgt.BuildSchedule('HX27-REPL-E', TempScheduleBuffer);
        TempScheduleBuffer.Reset();
        Assert.AreEqual(3, TempScheduleBuffer.Count(), 'The buffer holds only the second lease''s lines');
        TempScheduleBuffer.SetRange("Contract No.", 'HX27-REPL-E');
        Assert.AreEqual(3, TempScheduleBuffer.Count(), 'Every line belongs to the second lease');
    end;

    [Test]
    procedure BuildReplacesFilteredBuffer()
    var
        TempScheduleBuffer: Record "CGR Lease Schedule Line" temporary;
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        WorkDate(20270301D);
        InitLease('HX27-FILT-A', 3, 100.10);
        InitLease('HX27-FILT-E', 3, 200);

        LeaseMgt.BuildSchedule('HX27-FILT-A', TempScheduleBuffer);
        TempScheduleBuffer.SetRange("Contract No.", 'HX27-FILT-E');
        LeaseMgt.BuildSchedule('HX27-FILT-E', TempScheduleBuffer);
        TempScheduleBuffer.Reset();
        Assert.AreEqual(3, TempScheduleBuffer.Count(), 'The buffer holds only the second lease''s lines, also when it was filtered');
        TempScheduleBuffer.SetRange("Contract No.", 'HX27-FILT-E');
        Assert.AreEqual(3, TempScheduleBuffer.Count(), 'Every line belongs to the second lease');
    end;

    [Test]
    procedure BuildWithoutMonthsFails()
    var
        TempScheduleBuffer: Record "CGR Lease Schedule Line" temporary;
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        WorkDate(20270301D);
        InitLease('HX27-NOMONTHS', 0, 100.10);

        asserterror LeaseMgt.BuildSchedule('HX27-NOMONTHS', TempScheduleBuffer);
        Assert.ExpectedError('Lease HX27-NOMONTHS must run for at least one month.');
    end;

    [Test]
    procedure BuildOneMonthLease()
    var
        TempScheduleBuffer: Record "CGR Lease Schedule Line" temporary;
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        WorkDate(20270301D);
        InitLease('HX27-ONEMONTH', 1, 100.10);

        LeaseMgt.BuildSchedule('HX27-ONEMONTH', TempScheduleBuffer);
        Assert.AreEqual(1, TempScheduleBuffer.Count(), 'A one-month lease has one line');
        AssertLine(TempScheduleBuffer, 'HX27-ONEMONTH', 10000, 20270301D, 101.10);
    end;

    [Test]
    procedure CreateStillRefusesInvoicedLease()
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        WorkDate(20270301D);
        InitLease('HX27-REFUSE', 3, 100.10);
        LeaseMgt.CreateSchedule('HX27-REFUSE');
        LeaseMgt.InvoiceLine('HX27-REFUSE', 10000);

        asserterror LeaseMgt.CreateSchedule('HX27-REFUSE');
        Assert.ExpectedError('Lease HX27-REFUSE has invoiced schedule lines and cannot be rescheduled.');
    end;

    [Test]
    procedure CreateScheduleUnchanged()
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        WorkDate(20270301D);
        InitLease('HX27-CREATE', 3, 100.10);

        LeaseMgt.CreateSchedule('HX27-CREATE');
        Assert.AreEqual(3, SavedLineCount('HX27-CREATE'), 'CreateSchedule saves one line per month');
        AssertStandardSchedule(ScheduleLine, 'HX27-CREATE');
    end;

    [Test]
    procedure CreateReplacesUninvoicedSchedule()
    var
        TempRunBuffer: Record "CGR Lease Schedule Line" temporary;
        ScheduleLine: Record "CGR Lease Schedule Line";
        LeaseMgt: Codeunit "CGR Lease Mgt";
        Ok: Boolean;
    begin
        WorkDate(20270301D);
        InitLease('HX27-RECREATE', 3, 100.10);
        LeaseMgt.CreateSchedule('HX27-RECREATE');
        SetBaseRate('HX27-RECREATE', 200);
        Commit();

        TempRunBuffer.Init();
        TempRunBuffer."Contract No." := 'HX27-RECREATE';
        Ok := Codeunit.Run(Codeunit::"HX027 Create Runner", TempRunBuffer);
        Assert.IsTrue(Ok, 'A schedule without invoiced lines is created again');
        Assert.AreEqual(3, SavedLineCount('HX27-RECREATE'), 'The new schedule replaces the old one');
        AssertLine(ScheduleLine, 'HX27-RECREATE', 10000, 20270301D, 206.00);
        AssertLine(ScheduleLine, 'HX27-RECREATE', 20000, 20270401D, 206.00);
        AssertLine(ScheduleLine, 'HX27-RECREATE', 30000, 20270501D, 206.00);
    end;

    [Test]
    procedure CreateWithoutMonthsFails()
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        WorkDate(20270301D);
        InitLease('HX27-CMONTHS', 0, 100.10);

        asserterror LeaseMgt.CreateSchedule('HX27-CMONTHS');
        Assert.ExpectedError('Lease HX27-CMONTHS must run for at least one month.');
    end;

    local procedure InitLease(LeaseNo: Code[20]; Months: Integer; BaseRate: Decimal)
    var
        Contract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        ScheduleLine.SetRange("Contract No.", LeaseNo);
        ScheduleLine.DeleteAll();
        if Contract.Get(LeaseNo) then
            Contract.Delete();
        Contract.Init();
        Contract."No." := LeaseNo;
        Contract."Vehicle No." := 'HX027-V';
        Contract."Customer Name" := 'HX027 Customer';
        Contract."Start Date" := 20270301D;
        Contract.Months := Months;
        Contract."Base Rate" := BaseRate;
        Contract.Insert();
    end;

    local procedure SetBaseRate(LeaseNo: Code[20]; BaseRate: Decimal)
    var
        Contract: Record "CGR Lease Contract";
    begin
        Contract.Get(LeaseNo);
        Contract."Base Rate" := BaseRate;
        Contract.Modify();
    end;

    local procedure SavedLineCount(LeaseNo: Code[20]): Integer
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        ScheduleLine.SetRange("Contract No.", LeaseNo);
        exit(ScheduleLine.Count());
    end;

    local procedure AssertStandardSchedule(var ScheduleLine: Record "CGR Lease Schedule Line"; LeaseNo: Code[20])
    begin
        AssertLine(ScheduleLine, LeaseNo, 10000, 20270301D, 103.10);
        AssertLine(ScheduleLine, LeaseNo, 20000, 20270401D, 103.10);
        AssertLine(ScheduleLine, LeaseNo, 30000, 20270501D, 103.11);
    end;

    local procedure AssertLine(var ScheduleLine: Record "CGR Lease Schedule Line"; LeaseNo: Code[20]; LineNo: Integer; DueDate: Date; LineAmount: Decimal)
    begin
        Assert.IsTrue(ScheduleLine.Get(LeaseNo, LineNo), StrSubstNo('Line %1 of lease %2 exists', LineNo, LeaseNo));
        Assert.AreEqual(DueDate, ScheduleLine."Due Date", StrSubstNo('Due date of line %1', LineNo));
        Assert.AreEqual(LineAmount, ScheduleLine.Amount, StrSubstNo('Amount of line %1', LineNo));
        Assert.IsFalse(ScheduleLine.Invoiced, StrSubstNo('Line %1 is not invoiced', LineNo));
    end;
}
