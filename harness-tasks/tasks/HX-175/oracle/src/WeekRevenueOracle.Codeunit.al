codeunit 88585 "HX175 Week Revenue Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";

    [Test]
    procedure MidYearWeeksSummed()
    var
        WeekRevenue: Record "CGR Vehicle Week Revenue";
        WeeklyRevenueMgt: Codeunit "CGR Weekly Revenue Mgt";
    begin
        InitVehicle('HX175-A1');
        InitVehicle('HX175-B1');
        InsertEntry('HX175-A1', 20270310D, 100);
        InsertEntry('HX175-A1', 20270314D, 50);
        InsertEntry('HX175-A1', 20270315D, 70);
        InsertEntry('HX175-B1', 20270311D, 999);
        WeekRevenue.Init();
        WeekRevenue."Vehicle No." := 'HX175-A1';
        WeekRevenue.Year := 2027;
        WeekRevenue."Week No." := 20;
        WeekRevenue.Amount := 555;
        WeekRevenue.Insert();
        WeekRevenue.Init();
        WeekRevenue."Vehicle No." := 'HX175-B1';
        WeekRevenue.Year := 2027;
        WeekRevenue."Week No." := 30;
        WeekRevenue.Amount := 777;
        WeekRevenue.Insert();

        WeeklyRevenueMgt.BuildWeekRevenue('HX175-A1');
        WeeklyRevenueMgt.BuildWeekRevenue('HX175-A1');

        WeekRevenue.Reset();
        WeekRevenue.SetRange("Vehicle No.", 'HX175-A1');
        Assert.AreEqual(2, WeekRevenue.Count(), 'One row per week with entries, old rows replaced');
        Assert.IsTrue(WeekRevenue.Get('HX175-A1', 2027, 10), 'Week 10 of 2027 has a row');
        Assert.AreEqual(150, WeekRevenue.Amount, 'Week 10 sums Wednesday and Sunday');
        Assert.AreEqual(2, WeekRevenue."Entry Count", 'Week 10 counts two entries');
        Assert.AreEqual(20270308D, WeekRevenue."Week Start", 'Week 10 starts on Monday 8 March');
        Assert.IsTrue(WeekRevenue.Get('HX175-A1', 2027, 11), 'Week 11 of 2027 has a row');
        Assert.AreEqual(70, WeekRevenue.Amount, 'Week 11 holds the Monday entry');
        Assert.AreEqual(1, WeekRevenue."Entry Count", 'Week 11 counts one entry');
        Assert.AreEqual(20270315D, WeekRevenue."Week Start", 'Week 11 starts on Monday 15 March');
        WeekRevenue.Reset();
        WeekRevenue.SetRange("Vehicle No.", 'HX175-B1');
        Assert.AreEqual(1, WeekRevenue.Count(), 'Another vehicle is not built and keeps its rows');
        Assert.IsTrue(WeekRevenue.Get('HX175-B1', 2027, 30), 'Another vehicle keeps its built row');
        Assert.AreEqual(777, WeekRevenue.Amount, 'Another vehicle keeps its built amount');
    end;

    [Test]
    procedure NewYearWeekReportedOnce()
    var
        WeekRevenue: Record "CGR Vehicle Week Revenue";
        Runner: Codeunit "HX175 Week Revenue Runner";
        Ok: Boolean;
    begin
        InitVehicle('HX175-A2');
        InsertEntry('HX175-A2', 20261228D, 100);
        InsertEntry('HX175-A2', 20270101D, 40);
        InsertEntry('HX175-A2', 20270103D, 10);
        InsertEntry('HX175-A2', 20270104D, 25);
        Commit();

        Runner.SetBuild('HX175-A2');
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'Building the weeks around New Year succeeds: ' + GetLastErrorText());
        WeekRevenue.SetRange("Vehicle No.", 'HX175-A2');
        Assert.AreEqual(2, WeekRevenue.Count(), 'The New Year week is one row, the next week another');
        Assert.IsTrue(WeekRevenue.Get('HX175-A2', 2026, 53), 'The week of 28 December 2026 is week 53 of 2026');
        Assert.AreEqual(150, WeekRevenue.Amount, 'The New Year week holds all its days');
        Assert.AreEqual(3, WeekRevenue."Entry Count", 'The New Year week counts three entries');
        Assert.AreEqual(20261228D, WeekRevenue."Week Start", 'The New Year week starts on Monday 28 December 2026');
        Assert.IsFalse(WeekRevenue.Get('HX175-A2', 2027, 53), 'No week 53 of 2027');
        Assert.IsTrue(WeekRevenue.Get('HX175-A2', 2027, 1), 'Week 1 of 2027 has a row');
        Assert.AreEqual(25, WeekRevenue.Amount, 'Week 1 of 2027 holds only 4 January');
        Assert.AreEqual(1, WeekRevenue."Entry Count", 'Week 1 of 2027 counts one entry');
        Assert.AreEqual(20270104D, WeekRevenue."Week Start", 'Week 1 of 2027 starts on Monday 4 January');
    end;

    [Test]
    procedure NewYearWeekOpensNextYear()
    var
        WeekRevenue: Record "CGR Vehicle Week Revenue";
        Runner: Codeunit "HX175 Week Revenue Runner";
        Ok: Boolean;
    begin
        InitVehicle('HX175-A5');
        InsertEntry('HX175-A5', 20251229D, 60);
        InsertEntry('HX175-A5', 20260102D, 20);
        Commit();

        Runner.SetBuild('HX175-A5');
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'Building the weeks around New Year 2026 succeeds: ' + GetLastErrorText());
        WeekRevenue.SetRange("Vehicle No.", 'HX175-A5');
        Assert.AreEqual(1, WeekRevenue.Count(), 'The New Year week is one row');
        WeekRevenue.SetRange(Year, 2025);
        Assert.AreEqual(0, WeekRevenue.Count(), 'No row is reported under 2025');
        Assert.IsTrue(WeekRevenue.Get('HX175-A5', 2026, 1), 'The week of 29 December 2025 is week 1 of 2026');
        Assert.AreEqual(80, WeekRevenue.Amount, 'The New Year week holds all its days');
        Assert.AreEqual(2, WeekRevenue."Entry Count", 'The New Year week counts two entries');
        Assert.AreEqual(20251229D, WeekRevenue."Week Start", 'The New Year week starts on Monday 29 December 2025');
    end;

    [Test]
    procedure YearWithoutWeek53Listed()
    var
        TempWeekBuffer: Record "CGR Vehicle Week Revenue" temporary;
        WeeklyRevenueMgt: Codeunit "CGR Weekly Revenue Mgt";
        Runner: Codeunit "HX175 Week Revenue Runner";
        Ok: Boolean;
    begin
        InitVehicle('HX175-A3');
        InsertEntry('HX175-A3', 20270101D, 40);
        InsertEntry('HX175-A3', 20270104D, 25);
        InsertEntry('HX175-A3', 20270310D, 100);
        InitVehicle('HX175-B3');
        InsertEntry('HX175-B3', 20270112D, 333);
        WeeklyRevenueMgt.BuildWeekRevenue('HX175-A3');
        WeeklyRevenueMgt.BuildWeekRevenue('HX175-B3');
        Commit();

        Runner.SetList('HX175-A3', 2027);
        Ok := Runner.Run();

        Assert.IsTrue(Ok, 'Listing 2027 succeeds: ' + GetLastErrorText());
        Runner.GetWeeks(TempWeekBuffer);
        Assert.AreEqual(52, TempWeekBuffer.Count(), '2027 lists 52 weeks');
        TempWeekBuffer.FindFirst();
        Assert.AreEqual(1, TempWeekBuffer."Week No.", 'The list starts with week 1');
        Assert.AreEqual(2027, TempWeekBuffer.Year, 'Week 1 is listed under 2027');
        Assert.AreEqual('HX175-A3', TempWeekBuffer."Vehicle No.", 'Rows carry the vehicle');
        Assert.AreEqual(20270104D, TempWeekBuffer."Week Start", 'Week 1 of 2027 starts on Monday 4 January');
        Assert.AreEqual(25, TempWeekBuffer.Amount, 'Week 1 of 2027 holds only 4 January');
        Assert.AreEqual(1, TempWeekBuffer."Entry Count", 'Week 1 of 2027 counts one entry');
        TempWeekBuffer.FindLast();
        Assert.AreEqual(52, TempWeekBuffer."Week No.", 'The list ends with week 52');
        TempWeekBuffer.SetRange("Week No.", 2);
        TempWeekBuffer.FindFirst();
        Assert.AreEqual(0, TempWeekBuffer.Amount, 'A week without a row of this vehicle is listed at 0');
        Assert.AreEqual(0, TempWeekBuffer."Entry Count", 'A week without a row of this vehicle counts 0 entries');
        TempWeekBuffer.SetRange("Week No.", 10);
        TempWeekBuffer.FindFirst();
        Assert.AreEqual(100, TempWeekBuffer.Amount, 'Week 10 shows its built amount');
        Assert.AreEqual(1, TempWeekBuffer."Entry Count", 'Week 10 shows its built count');
    end;

    [Test]
    procedure YearWithWeek53Listed()
    var
        TempWeekBuffer: Record "CGR Vehicle Week Revenue" temporary;
        WeeklyRevenueMgt: Codeunit "CGR Weekly Revenue Mgt";
    begin
        InitVehicle('HX175-A4');
        InsertEntry('HX175-A4', 20260610D, 30);
        InsertEntry('HX175-A4', 20261228D, 100);
        InsertEntry('HX175-A4', 20270101D, 40);
        InsertEntry('HX175-A4', 20270103D, 10);
        WeeklyRevenueMgt.BuildWeekRevenue('HX175-A4');

        WeeklyRevenueMgt.GetYearWeeks('HX175-A4', 2026, TempWeekBuffer);

        Assert.AreEqual(53, TempWeekBuffer.Count(), '2026 lists 53 weeks');
        TempWeekBuffer.FindLast();
        Assert.AreEqual(53, TempWeekBuffer."Week No.", 'The list ends with week 53');
        Assert.AreEqual(2026, TempWeekBuffer.Year, 'Week 53 is listed under 2026');
        Assert.AreEqual(20261228D, TempWeekBuffer."Week Start", 'Week 53 of 2026 starts on Monday 28 December');
        Assert.AreEqual(150, TempWeekBuffer.Amount, 'Week 53 of 2026 holds all days of the New Year week');
        Assert.AreEqual(3, TempWeekBuffer."Entry Count", 'Week 53 of 2026 counts three entries');
    end;

    local procedure InitVehicle(VehicleNo: Code[20])
    var
        LedgerEntry: Record "CGR Rental Ledger Entry";
        WeekRevenue: Record "CGR Vehicle Week Revenue";
    begin
        WorkDate(20270301D);
        LedgerEntry.SetRange("Vehicle No.", VehicleNo);
        LedgerEntry.DeleteAll();
        WeekRevenue.SetRange("Vehicle No.", VehicleNo);
        WeekRevenue.DeleteAll();
    end;

    local procedure InsertEntry(VehicleNo: Code[20]; PostingDate: Date; Amount: Decimal)
    var
        LedgerEntry: Record "CGR Rental Ledger Entry";
    begin
        LedgerEntry.Init();
        LedgerEntry."Vehicle No." := VehicleNo;
        LedgerEntry."Posting Date" := PostingDate;
        LedgerEntry.Amount := Amount;
        LedgerEntry.Insert();
    end;
}
