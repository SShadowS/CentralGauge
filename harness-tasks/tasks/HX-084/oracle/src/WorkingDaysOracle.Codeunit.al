codeunit 87140 "HX084 Working Days Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure SixthAndSeventhAreWorkingDays()
    var
        WorkingDays: Codeunit "CGR Working Days";
    begin
        InitHX84();
        Assert.AreEqual(20270707D, WorkingDays.AddWorkingDays(20270705D, 2), 'Two working days after Monday 5 July is Wednesday 7 July');
    end;

    [Test]
    procedure WeekendSkipped()
    var
        WorkingDays: Codeunit "CGR Working Days";
    begin
        InitHX84();
        Assert.AreEqual(20270712D, WorkingDays.AddWorkingDays(20270709D, 1), 'One working day after Friday 9 July is Monday 12 July');
    end;

    [Test]
    procedure HolidaySkipped()
    var
        WorkingDays: Codeunit "CGR Working Days";
    begin
        InitHX84();
        AddHX84NonWorkingDay(20270713D);
        Assert.IsFalse(WorkingDays.IsWorkingDay(20270713D), 'Precondition: Tuesday 13 July is a non-working day');
        Assert.AreEqual(20270714D, WorkingDays.AddWorkingDays(20270712D, 1), 'One working day after Monday 12 July skips the non-working Tuesday');
    end;

    [Test]
    procedure ZeroDaysReturnsFromDate()
    var
        WorkingDays: Codeunit "CGR Working Days";
    begin
        InitHX84();
        Assert.AreEqual(20270710D, WorkingDays.AddWorkingDays(20270710D, 0), 'Adding zero working days returns the start date, also on a Saturday');
    end;

    [Test]
    procedure FiveDaysAcrossWeekend()
    var
        WorkingDays: Codeunit "CGR Working Days";
    begin
        InitHX84();
        Assert.AreEqual(20270714D, WorkingDays.AddWorkingDays(20270707D, 5), 'Five working days after Wednesday 7 July is Wednesday 14 July');
    end;

    [Test]
    procedure FromSunday()
    var
        WorkingDays: Codeunit "CGR Working Days";
    begin
        InitHX84();
        Assert.AreEqual(20270712D, WorkingDays.AddWorkingDays(20270711D, 1), 'One working day after Sunday 11 July is Monday 12 July');
    end;

    [Test]
    procedure AcrossMonthEnd()
    var
        WorkingDays: Codeunit "CGR Working Days";
    begin
        InitHX84();
        Assert.AreEqual(20270802D, WorkingDays.AddWorkingDays(20270730D, 1), 'One working day after Friday 30 July is Monday 2 August');
    end;

    [Test]
    procedure NegativeDaysRefused()
    var
        Runner: Codeunit "HX084 Add Runner";
        Ok: Boolean;
    begin
        InitHX84();
        Runner.SetArgs(20270705D, -1);
        Commit();
        Ok := Runner.Run();
        Assert.IsFalse(Ok, 'Adding a negative number of working days fails');
        Assert.AreEqual('The number of working days to add must not be negative.', GetLastErrorText(), 'The refusal text');
    end;

    [Test]
    procedure IsWorkingDayAsToday()
    var
        WorkingDays: Codeunit "CGR Working Days";
    begin
        InitHX84();
        Assert.IsTrue(WorkingDays.IsWorkingDay(20270706D), 'Tuesday 6 July is a working day');
        Assert.IsFalse(WorkingDays.IsWorkingDay(20270710D), 'Saturday 10 July is not a working day');
    end;

    local procedure InitHX84()
    var
        Setup: Record "CGR Setup";
        NonWorkingDay: Record "CGR Non-Working Day";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270701D);
        Setup.GetOrCreate();
        Setup."Amount Rounding Precision" := 0.01;
        Setup."Default Branch Code" := '';
        Setup."Outbox Max Attempts" := 3;
        Setup."Suspend Rentals" := false;
        Setup.Modify();
        SessionContext.Reset();
        NonWorkingDay.SetRange("Non-Working Date", 20270701D, 20270831D);
        NonWorkingDay.DeleteAll();
    end;

    local procedure AddHX84NonWorkingDay(NonWorkingDate: Date)
    var
        NonWorkingDay: Record "CGR Non-Working Day";
    begin
        NonWorkingDay.Init();
        NonWorkingDay."Non-Working Date" := NonWorkingDate;
        NonWorkingDay.Description := 'HX084 holiday';
        NonWorkingDay.Insert();
    end;
}
