codeunit 87100 "HX082 Schedule Import Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        RepeatTxt: Label 'Line %1 repeats the due date %2 of line %3.', Locked = true;

    [Test]
    procedure NonAdjacentRepeatRefused()
    var
        Runner: Codeunit "HX082 Import Runner";
        FiltersBefore: Text;
        Ok: Boolean;
    begin
        HX82Prepare();
        HX82InitLease('HX82-1');
        Runner.HX82SetLease('HX82-1');
        Runner.HX82AddLine(10000, 20270301D, 110);
        Runner.HX82AddLine(20000, 20270401D, 120);
        Runner.HX82AddLine(30000, 20270301D, 130);
        Runner.HX82SetAmountFilter(0, 200);
        FiltersBefore := Runner.HX82HeldFilters();
        Assert.AreNotEqual('', FiltersBefore, 'Precondition: the caller''s import lines carry an Amount filter');

        Commit();
        Ok := Runner.Run();
        Assert.IsFalse(Ok, 'An import whose line 30000 repeats the due date of line 10000 is refused');
        Assert.AreEqual(StrSubstNo(RepeatTxt, 30000, Format(20270301D, 0, 9), 10000), GetLastErrorText(), 'The refusal names the repeating line, the date and the earlier line');
        HX82AssertScheduleUnchanged('HX82-1');
        Assert.AreEqual(3, Runner.HX82HeldCount(), 'A refused import leaves the caller''s 3 import lines');
        Assert.AreEqual(FiltersBefore, Runner.HX82HeldFilters(), 'A refused import leaves the caller''s filters on the import lines');
        HX82AssertHeldLine(Runner, 10000, 20270301D, 110);
        HX82AssertHeldLine(Runner, 20000, 20270401D, 120);
        HX82AssertHeldLine(Runner, 30000, 20270301D, 130);
    end;

    [Test]
    procedure AdjacentRepeatRefused()
    var
        Runner: Codeunit "HX082 Import Runner";
        Ok: Boolean;
    begin
        HX82Prepare();
        HX82InitLease('HX82-2');
        Runner.HX82SetLease('HX82-2');
        Runner.HX82AddLine(10000, 20270401D, 110);
        Runner.HX82AddLine(20000, 20270401D, 120);

        Commit();
        Ok := Runner.Run();
        Assert.IsFalse(Ok, 'An import whose line 20000 repeats the due date of line 10000 is refused');
        Assert.AreEqual(StrSubstNo(RepeatTxt, 20000, Format(20270401D, 0, 9), 10000), GetLastErrorText(), 'The refusal names the repeating line, the date and the earlier line');
        HX82AssertScheduleUnchanged('HX82-2');
    end;

    [Test]
    procedure FirstRepeatNamed()
    var
        Runner: Codeunit "HX082 Import Runner";
        Ok: Boolean;
    begin
        HX82Prepare();
        HX82InitLease('HX82-3');
        Runner.HX82SetLease('HX82-3');
        Runner.HX82AddLine(10000, 20270501D, 110);
        Runner.HX82AddLine(20000, 20270501D, 120);
        Runner.HX82AddLine(30000, 20270501D, 130);

        Commit();
        Ok := Runner.Run();
        Assert.IsFalse(Ok, 'An import with three lines on one due date is refused');
        Assert.AreEqual(StrSubstNo(RepeatTxt, 20000, Format(20270501D, 0, 9), 10000), GetLastErrorText(), 'The refusal names the first repeating line and the earliest line with that date');
        HX82AssertScheduleUnchanged('HX82-3');
    end;

    [Test]
    procedure InterleavedRepeatsFirstNamed()
    var
        Runner: Codeunit "HX082 Import Runner";
        Ok: Boolean;
    begin
        HX82Prepare();
        HX82InitLease('HX82-11');
        Runner.HX82SetLease('HX82-11');
        Runner.HX82AddLine(10000, 20270301D, 110);
        Runner.HX82AddLine(20000, 20270401D, 120);
        Runner.HX82AddLine(30000, 20270401D, 130);
        Runner.HX82AddLine(40000, 20270301D, 140);

        Commit();
        Ok := Runner.Run();
        Assert.IsFalse(Ok, 'An import with two repeated due dates is refused');
        Assert.AreEqual(StrSubstNo(RepeatTxt, 30000, Format(20270401D, 0, 9), 20000), GetLastErrorText(), 'The refusal names the first repeating line in Line No. order (30000) and its earlier line (20000)');
        HX82AssertScheduleUnchanged('HX82-11');
    end;

    [Test]
    procedure ValidImportReplacesSchedule()
    var
        Contract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
        Runner: Codeunit "HX082 Import Runner";
        Ok: Boolean;
    begin
        HX82Prepare();
        HX82InitLease('HX82-4');
        Runner.HX82SetLease('HX82-4');
        Runner.HX82AddLine(10000, 20270501D, 150);
        Runner.HX82AddLine(20000, 20270301D, 130);
        Runner.HX82AddLine(30000, 20270601D, 160);
        Runner.HX82AddLine(40000, 20270401D, 140);

        Commit();
        Ok := Runner.Run();
        Assert.IsTrue(Ok, StrSubstNo('A valid import of 4 lines succeeds: %1', GetLastErrorText()));
        Assert.AreEqual(4, Runner.HX82Imported(), 'The import returns the number of schedule lines');
        Contract.Get('HX82-4');
        Assert.AreEqual(4, Contract.Months, 'Months of the lease equal the number of imported lines');
        Assert.AreEqual(4, HX82LineCount('HX82-4'), 'The schedule holds exactly the 4 imported lines');
        HX82AssertLine('HX82-4', 10000, 20270501D, 150);
        HX82AssertLine('HX82-4', 20000, 20270301D, 130);
        HX82AssertLine('HX82-4', 30000, 20270601D, 160);
        HX82AssertLine('HX82-4', 40000, 20270401D, 140);
        Assert.IsFalse(ScheduleLine.Get('HX82-4', 50000), 'No schedule line 50000 is left');
    end;

    [Test]
    procedure CallerLinesKept()
    var
        Contract: Record "CGR Lease Contract";
        Runner: Codeunit "HX082 Import Runner";
        FiltersBefore: Text;
        Ok: Boolean;
    begin
        HX82Prepare();
        HX82InitLease('HX82-5');
        Runner.HX82SetLease('HX82-5');
        Runner.HX82AddLine(5, 20270501D, 150);
        Runner.HX82AddLine(7, 20270301D, 130);
        Runner.HX82AddLine(11, 20270601D, 160);
        Runner.HX82AddLine(13, 20270401D, 140);
        Runner.HX82SetAmountFilter(0, 145);
        FiltersBefore := Runner.HX82HeldFilters();
        Assert.AreNotEqual('', FiltersBefore, 'Precondition: the caller''s import lines carry an Amount filter');

        Commit();
        Ok := Runner.Run();
        Assert.IsTrue(Ok, StrSubstNo('A valid import of 4 lines succeeds: %1', GetLastErrorText()));
        Assert.AreEqual(4, Runner.HX82Imported(), 'Every import line counts, whatever the caller''s filters');
        Contract.Get('HX82-5');
        Assert.AreEqual(4, Contract.Months, 'Months of the lease equal the number of imported lines');
        Assert.AreEqual(4, HX82LineCount('HX82-5'), 'The schedule holds exactly the 4 imported lines');
        HX82AssertLine('HX82-5', 10000, 20270501D, 150);
        HX82AssertLine('HX82-5', 20000, 20270301D, 130);
        HX82AssertLine('HX82-5', 30000, 20270601D, 160);
        HX82AssertLine('HX82-5', 40000, 20270401D, 140);
        Assert.AreEqual(4, Runner.HX82HeldCount(), 'The caller keeps its 4 import lines');
        Assert.AreEqual(FiltersBefore, Runner.HX82HeldFilters(), 'The caller keeps its filters on the import lines');
    end;

    [Test]
    procedure BlankDueDateRefused()
    var
        Runner: Codeunit "HX082 Import Runner";
        Ok: Boolean;
    begin
        HX82Prepare();
        HX82InitLease('HX82-6');
        Runner.HX82SetLease('HX82-6');
        Runner.HX82AddLine(10000, 20270301D, 110);
        Runner.HX82AddLine(20000, 0D, 120);

        Commit();
        Ok := Runner.Run();
        Assert.IsFalse(Ok, 'An import with a line without due date is refused');
        Assert.AreEqual(StrSubstNo('Line %1 of the import has no due date.', 20000), GetLastErrorText(), 'The refusal names the line without due date');
        HX82AssertScheduleUnchanged('HX82-6');
    end;

    [Test]
    procedure DueBeforeStartRefused()
    var
        Runner: Codeunit "HX082 Import Runner";
        Ok: Boolean;
    begin
        HX82Prepare();
        HX82InitLease('HX82-7');
        Runner.HX82SetLease('HX82-7');
        Runner.HX82AddLine(10000, 20270228D, 110);

        Commit();
        Ok := Runner.Run();
        Assert.IsFalse(Ok, 'An import with a line due before the lease starts is refused');
        Assert.AreEqual(StrSubstNo('Line %1 is due before lease %2 starts.', 10000, 'HX82-7'), GetLastErrorText(), 'The refusal names the line and the lease');
    end;

    [Test]
    procedure InvoicedLeaseRefused()
    var
        LeaseMgt: Codeunit "CGR Lease Mgt";
        Runner: Codeunit "HX082 Import Runner";
        Ok: Boolean;
    begin
        HX82Prepare();
        HX82InitLease('HX82-8');
        LeaseMgt.InvoiceLine('HX82-8', 10000);
        Runner.HX82SetLease('HX82-8');
        Runner.HX82AddLine(10000, 20270501D, 150);
        Runner.HX82AddLine(20000, 20270601D, 160);

        Commit();
        Ok := Runner.Run();
        Assert.IsFalse(Ok, 'A lease with invoiced schedule lines is not rescheduled');
        Assert.AreEqual('Lease HX82-8 has invoiced schedule lines and cannot be rescheduled.', GetLastErrorText(), 'The refusal names the lease');
    end;

    [Test]
    procedure MissingLeaseRaises()
    var
        Runner: Codeunit "HX082 Import Runner";
        Ok: Boolean;
    begin
        HX82Prepare();
        HX82RemoveLease('HX82-NONE');
        Runner.HX82SetLease('HX82-NONE');
        Runner.HX82AddLine(10000, 20270301D, 110);

        Commit();
        Ok := Runner.Run();
        Assert.IsFalse(Ok, 'An import for a lease that does not exist fails');
        Assert.AreEqual('The CGR Lease Contract does not exist. Identification fields and values: No.=''HX82-NONE''', GetLastErrorText(), 'The not-found error reaches the caller');
    end;

    [Test]
    procedure EmptyImportRefused()
    var
        Runner: Codeunit "HX082 Import Runner";
        Ok: Boolean;
    begin
        HX82Prepare();
        HX82InitLease('HX82-10');
        Runner.HX82SetLease('HX82-10');

        Commit();
        Ok := Runner.Run();
        Assert.IsFalse(Ok, 'An import without lines is refused');
        Assert.AreEqual('The import for lease HX82-10 has no lines.', GetLastErrorText(), 'The refusal names the lease');
    end;

    local procedure HX82AssertScheduleUnchanged(LeaseNo: Code[20])
    var
        Contract: Record "CGR Lease Contract";
    begin
        Contract.Get(LeaseNo);
        Assert.AreEqual(3, Contract.Months, StrSubstNo('A refused import keeps Months of %1', LeaseNo));
        Assert.AreEqual(3, HX82LineCount(LeaseNo), StrSubstNo('A refused import keeps the 3 schedule lines of %1', LeaseNo));
        HX82AssertLine(LeaseNo, 10000, 20270301D, 103);
        HX82AssertLine(LeaseNo, 20000, 20270401D, 103);
        HX82AssertLine(LeaseNo, 30000, 20270501D, 103);
    end;

    local procedure HX82AssertLine(LeaseNo: Code[20]; LineNo: Integer; DueDate: Date; LineAmount: Decimal)
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        Assert.IsTrue(ScheduleLine.Get(LeaseNo, LineNo), StrSubstNo('Schedule line %1 of %2 exists', LineNo, LeaseNo));
        Assert.AreEqual(DueDate, ScheduleLine."Due Date", StrSubstNo('Due date of schedule line %1 of %2', LineNo, LeaseNo));
        Assert.AreEqual(LineAmount, ScheduleLine.Amount, StrSubstNo('Amount of schedule line %1 of %2', LineNo, LeaseNo));
        Assert.IsFalse(ScheduleLine.Invoiced, StrSubstNo('Schedule line %1 of %2 is not invoiced', LineNo, LeaseNo));
    end;

    local procedure HX82AssertHeldLine(var Runner: Codeunit "HX082 Import Runner"; LineNo: Integer; DueDate: Date; LineAmount: Decimal)
    var
        HeldDueDate: Date;
        HeldAmount: Decimal;
    begin
        Assert.IsTrue(Runner.HX82HeldLine(LineNo, HeldDueDate, HeldAmount), StrSubstNo('The caller keeps import line %1', LineNo));
        Assert.AreEqual(DueDate, HeldDueDate, StrSubstNo('The caller''s import line %1 keeps its due date', LineNo));
        Assert.AreEqual(LineAmount, HeldAmount, StrSubstNo('The caller''s import line %1 keeps its amount', LineNo));
    end;

    local procedure HX82LineCount(LeaseNo: Code[20]): Integer
    var
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        ScheduleLine.SetRange("Contract No.", LeaseNo);
        exit(ScheduleLine.Count());
    end;

    local procedure HX82Prepare()
    var
        Setup: Record "CGR Setup";
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
    end;

    local procedure HX82RemoveLease(LeaseNo: Code[20])
    var
        Contract: Record "CGR Lease Contract";
        ScheduleLine: Record "CGR Lease Schedule Line";
    begin
        ScheduleLine.SetRange("Contract No.", LeaseNo);
        ScheduleLine.DeleteAll();
        if Contract.Get(LeaseNo) then
            Contract.Delete();
    end;

    local procedure HX82InitLease(LeaseNo: Code[20])
    var
        Contract: Record "CGR Lease Contract";
        LeaseMgt: Codeunit "CGR Lease Mgt";
    begin
        HX82RemoveLease(LeaseNo);
        Contract.Init();
        Contract."No." := LeaseNo;
        Contract."Vehicle No." := 'HX082-V';
        Contract."Customer Name" := 'HX082 Customer';
        Contract."Start Date" := 20270301D;
        Contract.Months := 3;
        Contract."Base Rate" := 100;
        Contract.Insert();
        LeaseMgt.CreateSchedule(LeaseNo);
    end;
}
