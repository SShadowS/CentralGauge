codeunit 80051 "CGR Working Days Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure WeekdaysCountedWithoutHolidays()
    var
        WorkingDays: Codeunit "CGR Working Days";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20270301D, 20270331D);
        Assert.AreEqual(5, WorkingDays.WorkingDaysBetween(20270301D, 20270307D), 'Mon-Sun has five working days');
        Assert.AreEqual(10, WorkingDays.WorkingDaysBetween(20270301D, 20270314D), 'Two full weeks have ten working days');
        Assert.AreEqual(1, WorkingDays.WorkingDaysBetween(20270301D, 20270301D), 'A single Monday is one working day');
        Assert.AreEqual(0, WorkingDays.WorkingDaysBetween(20270306D, 20270307D), 'A weekend has no working day');
    end;

    [Test]
    procedure HolidayIsNotAWorkingDay()
    var
        WorkingDays: Codeunit "CGR Working Days";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20270301D, 20270331D);
        Lib.AddNonWorkingDay(20270303D);
        Assert.IsFalse(WorkingDays.IsWorkingDay(20270303D), 'The holiday is not a working day');
        Assert.IsTrue(WorkingDays.IsWorkingDay(20270304D), 'The day after the holiday is a working day');
        Assert.IsFalse(WorkingDays.IsWorkingDay(20270306D), 'Saturday is not a working day');
        Assert.AreEqual(4, WorkingDays.WorkingDaysBetween(20270301D, 20270307D), 'Five weekdays minus the holiday');
    end;

    [Test]
    procedure NextWorkingDaySkipsWeekendAndHoliday()
    var
        WorkingDays: Codeunit "CGR Working Days";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20270301D, 20270331D);
        Assert.AreEqual(20270302D, WorkingDays.NextWorkingDay(20270301D), 'Monday is followed by Tuesday');
        Assert.AreEqual(20270308D, WorkingDays.NextWorkingDay(20270305D), 'Friday is followed by Monday');
        Lib.AddNonWorkingDay(20270308D);
        Assert.AreEqual(20270309D, WorkingDays.NextWorkingDay(20270305D), 'A Monday holiday moves to Tuesday');
    end;

    [Test]
    procedure ReversedRangeHasNoWorkingDays()
    var
        WorkingDays: Codeunit "CGR Working Days";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.01, '', 3);
        Lib.ClearNonWorkingDays(20270301D, 20270331D);
        Assert.AreEqual(0, WorkingDays.WorkingDaysBetween(20270307D, 20270301D), 'An end date before the start date counts nothing');
    end;
}
