codeunit 89377 "CG-AL-X157 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods, so
    // every test clears its own tables before seeding its own rows.

    local procedure ClearAll()
    var
        CostCenter: Record "CG X157 Cost Center";
        CostEntry: Record "CG X157 Cost Entry";
        StatementLine: Record "CG X157 Statement Line";
    begin
        CostCenter.DeleteAll();
        CostEntry.DeleteAll();
        StatementLine.DeleteAll();
    end;

    local procedure SeedCostCenter(CostCenterCode: Code[20])
    var
        CostCenter: Record "CG X157 Cost Center";
    begin
        CostCenter.Init();
        CostCenter."Code" := CostCenterCode;
        CostCenter.Insert();
    end;

    local procedure SeedEntry(CostCenterCode: Code[20]; PostingDate: Date; Amount: Decimal)
    var
        CostEntry: Record "CG X157 Cost Entry";
    begin
        CostEntry.Init();
        CostEntry."Cost Center Code" := CostCenterCode;
        CostEntry."Posting Date" := PostingDate;
        CostEntry.Amount := Amount;
        CostEntry.Insert();
    end;

    local procedure AssertStatementLine(CostCenterCode: Code[20]; PeriodStart: Date; ExpectedAmount: Decimal; MessagePrefix: Text)
    var
        StatementLine: Record "CG X157 Statement Line";
    begin
        Assert.IsTrue(StatementLine.Get(CostCenterCode, PeriodStart), MessagePrefix + ' - statement row exists');
        Assert.AreEqual(ExpectedAmount, StatementLine.Amount, MessagePrefix + ' - statement row amount');
    end;

    [Test]
    procedure SinglePeriodWindowMatchingAllActivityReportsTheFullTotal()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        ClearAll();
        SeedCostCenter('CC1');
        SeedEntry('CC1', 20260110D, 100);
        SeedEntry('CC1', 20260120D, 50);

        Result := Statement.GetPeriodAmount('CC1', 20260101D, 20260131D);

        Assert.AreEqual(150, Result, 'A window that covers a cost center''s only activity reports that activity''s full total');
    end;

    [Test]
    procedure MidYearWindowReportsOnlyThatMonthsActivity()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        ClearAll();
        SeedCostCenter('CC1');
        SeedEntry('CC1', 20260110D, 100);
        SeedEntry('CC1', 20260120D, 50);
        SeedEntry('CC1', 20260205D, 30);
        SeedEntry('CC1', 20260225D, 70);
        SeedEntry('CC1', 20260315D, 40);

        Result := Statement.GetPeriodAmount('CC1', 20260201D, 20260228D);

        Assert.AreEqual(100, Result, 'A mid-year window must report only that window''s own activity, not the cost center''s entire history');
    end;

    [Test]
    procedure NonAlignedWindowReportsOnlyActivityWithinItsExactDates()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        ClearAll();
        SeedCostCenter('CC1');
        SeedEntry('CC1', 20260110D, 100);
        SeedEntry('CC1', 20260120D, 50);
        SeedEntry('CC1', 20260205D, 30);
        SeedEntry('CC1', 20260225D, 70);
        SeedEntry('CC1', 20260315D, 40);

        Result := Statement.GetPeriodAmount('CC1', 20260115D, 20260215D);

        Assert.AreEqual(80, Result, 'A window that does not line up with calendar month boundaries must still report only the activity that actually falls within it');
    end;

    [Test]
    procedure StatementRowsCarryEachPeriodsOwnFigure()
    var
        Statement: Codeunit "CG X157 Period Statement";
        StatementLine: Record "CG X157 Statement Line";
    begin
        ClearAll();
        SeedCostCenter('CC1');
        SeedEntry('CC1', 20260110D, 100);
        SeedEntry('CC1', 20260120D, 50);
        SeedEntry('CC1', 20260205D, 30);
        SeedEntry('CC1', 20260225D, 70);
        SeedEntry('CC1', 20260315D, 40);

        Statement.BuildStatement('CC1', 20260101D, 20260331D);

        StatementLine.SetRange("Cost Center Code", 'CC1');
        Assert.AreEqual(3, StatementLine.Count(), 'A statement spanning three calendar months produces exactly three rows');
        AssertStatementLine('CC1', 20260101D, 150, 'The first month''s row');
        AssertStatementLine('CC1', 20260201D, 100, 'The second month''s row');
        AssertStatementLine('CC1', 20260301D, 40, 'The third month''s row');
    end;

    [Test]
    procedure WindowWithNoActivityReportsZero()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        ClearAll();
        SeedCostCenter('CC1');
        SeedEntry('CC1', 20260110D, 100);
        SeedEntry('CC1', 20260205D, 30);
        SeedEntry('CC1', 20260315D, 40);

        Result := Statement.GetPeriodAmount('CC1', 20260401D, 20260430D);

        Assert.AreEqual(0, Result, 'A window with no activity in it must report zero, even though the cost center has activity elsewhere');
    end;

    [Test]
    procedure AnotherCostCentersActivityDoesNotAffectThisOnesFigure()
    var
        Statement: Codeunit "CG X157 Period Statement";
        ResultCC1: Decimal;
        ResultCC2: Decimal;
    begin
        ClearAll();
        SeedCostCenter('CC1');
        SeedCostCenter('CC2');
        SeedEntry('CC1', 20260110D, 100);
        SeedEntry('CC2', 20260110D, 9999);

        ResultCC1 := Statement.GetPeriodAmount('CC1', 20260101D, 20260131D);
        ResultCC2 := Statement.GetPeriodAmount('CC2', 20260101D, 20260131D);

        Assert.AreEqual(100, ResultCC1, 'A cost center''s own figure must not include another cost center''s activity');
        Assert.AreEqual(9999, ResultCC2, 'The other cost center''s own figure must be unaffected by resolving the first one''s figure');
    end;

    [Test]
    procedure ActivityOnTheWindowsFirstAndLastDayIsIncluded()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        ClearAll();
        SeedCostCenter('CC1');
        SeedEntry('CC1', 20251231D, 20);
        SeedEntry('CC1', 20260101D, 100);
        SeedEntry('CC1', 20260131D, 50);
        SeedEntry('CC1', 20260201D, 30);

        Result := Statement.GetPeriodAmount('CC1', 20260101D, 20260131D);

        Assert.AreEqual(150, Result, 'Activity dated exactly on either edge of the window must be included, and activity just outside either edge must be excluded');
    end;

    [Test]
    procedure RebuildingAStatementReplacesThePreviousRows()
    var
        Statement: Codeunit "CG X157 Period Statement";
        StatementLine: Record "CG X157 Statement Line";
    begin
        ClearAll();
        SeedCostCenter('CC1');
        SeedEntry('CC1', 20260110D, 100);
        SeedEntry('CC1', 20260120D, 50);
        SeedEntry('CC1', 20260205D, 30);
        SeedEntry('CC1', 20260225D, 70);
        SeedEntry('CC1', 20260315D, 40);

        Statement.BuildStatement('CC1', 20260101D, 20260331D);
        Statement.BuildStatement('CC1', 20260201D, 20260228D);

        StatementLine.SetRange("Cost Center Code", 'CC1');
        Assert.AreEqual(1, StatementLine.Count(), 'Rebuilding a statement for a narrower window must replace the previous rows, not add to them');
        Assert.IsFalse(StatementLine.Get('CC1', 20260101D), 'A row from the earlier, wider statement must not survive a rebuild');
        Assert.IsFalse(StatementLine.Get('CC1', 20260301D), 'A row from the earlier, wider statement must not survive a rebuild');
        AssertStatementLine('CC1', 20260201D, 100, 'The rebuilt statement''s only row');
    end;
}
