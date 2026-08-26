codeunit 89317 "CG-AL-X123 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods (see
    // tests/al/hard/CG-AL-X065.Test.al for the same note), so every test
    // clears the table before seeding its own rows.

    local procedure ClearAllEntries()
    var
        LaborEntry: Record "CG X123 Labor Entry";
    begin
        LaborEntry.DeleteAll();
    end;

    local procedure SeedEntry(ProjectCode: Code[20]; Hours: Decimal)
    var
        LaborEntry: Record "CG X123 Labor Entry";
    begin
        LaborEntry.Init();
        LaborEntry."Project Code" := ProjectCode;
        LaborEntry.Hours := Hours;
        LaborEntry.Insert(true);
    end;

    local procedure InvalidateDataCache()
    var
        DecoyEntry: Record "CG X123 Labor Entry";
    begin
        // The seeding above leaves the table's result sets in the server
        // data cache, and a cached read costs zero SQL - the graded call
        // would measure nothing. A write bumps the table's version and
        // forces real statements again; the decoy entry belongs to a
        // project no graded call asks about.
        DecoyEntry.Init();
        DecoyEntry."Project Code" := 'PRJ-DECOY';
        DecoyEntry.Hours := 1;
        DecoyEntry.Insert(true);
        SelectLatestVersion();
    end;

    [Test]
    procedure TotalAddsUpEveryLoggedEntry()
    var
        ProjectHours: Codeunit "CG X123 Project Hours";
        Any: Codeunit Any;
        ProjectCode: Code[20];
        Hours1: Decimal;
        Hours2: Decimal;
        Hours3: Decimal;
    begin
        ClearAllEntries();
        ProjectCode := 'PRJ-A';
        Hours1 := Any.DecimalInRange(1, 40, 2);
        Hours2 := Any.DecimalInRange(1, 40, 2);
        Hours3 := Any.DecimalInRange(1, 40, 2);
        SeedEntry(ProjectCode, Hours1);
        SeedEntry(ProjectCode, Hours2);
        SeedEntry(ProjectCode, Hours3);

        Assert.AreEqual(Hours1 + Hours2 + Hours3, ProjectHours.TotalHoursBilled(ProjectCode),
            'Expected the total to add up every hour entry logged against the project');
    end;

    [Test]
    procedure EntriesFromOtherProjectsNeverContributeToTheTotal()
    var
        ProjectHours: Codeunit "CG X123 Project Hours";
        Any: Codeunit Any;
        HoursA: Decimal;
        HoursB: Decimal;
    begin
        ClearAllEntries();
        HoursA := Any.DecimalInRange(1, 40, 2);
        HoursB := Any.DecimalInRange(1, 40, 2);
        SeedEntry('PRJ-A', HoursA);
        SeedEntry('PRJ-B', HoursB);

        Assert.AreEqual(HoursA, ProjectHours.TotalHoursBilled('PRJ-A'),
            'Expected the project''s total to reflect only its own logged entries, not entries logged against a different project');
        Assert.AreEqual(HoursB, ProjectHours.TotalHoursBilled('PRJ-B'),
            'Expected the other project''s total to reflect only its own logged entries either, not entries logged against a different project');
    end;

    [Test]
    procedure CorrectionEntriesReduceTheTotal()
    var
        ProjectHours: Codeunit "CG X123 Project Hours";
        Any: Codeunit Any;
        ProjectCode: Code[20];
        LoggedHours: Decimal;
        CorrectionHours: Decimal;
    begin
        ClearAllEntries();
        ProjectCode := 'PRJ-C';
        LoggedHours := Any.DecimalInRange(20, 40, 2);
        CorrectionHours := Any.DecimalInRange(1, 15, 2);
        SeedEntry(ProjectCode, LoggedHours);
        SeedEntry(ProjectCode, -CorrectionHours);

        Assert.AreEqual(LoggedHours - CorrectionHours, ProjectHours.TotalHoursBilled(ProjectCode),
            'Expected a correction entry (negative hours) to reduce the total, not be ignored');
    end;

    [Test]
    procedure TotalIsZeroWhenNothingHasBeenLoggedForAProject()
    var
        ProjectHours: Codeunit "CG X123 Project Hours";
    begin
        ClearAllEntries();

        Assert.AreEqual(0.0, ProjectHours.TotalHoursBilled('PRJ-NONE'),
            'Expected exactly 0 for a project nothing has ever been logged against - not an error');
    end;

    [Test]
    procedure TotalStaysCheapNoMatterHowManyEntriesAreLogged()
    var
        ProjectHours: Codeunit "CG X123 Project Hours";
        Any: Codeunit Any;
        EntryCount: Integer;
        i: Integer;
        WarmTotal: Decimal;
        Total: Decimal;
        ExpectedTotal: Decimal;
        RowsBefore: BigInteger;
        RowsAfter: BigInteger;
        RowsUsed: BigInteger;
        RowsBudget: BigInteger;
        HoursPerEntry: Decimal;
    begin
        ClearAllEntries();

        // Warm-up on a small, unrelated project so first-touch metadata/plan
        // loading lands outside the measurement window below.
        SeedEntry('PRJ-WARM', 5.0);
        WarmTotal := ProjectHours.TotalHoursBilled('PRJ-WARM');
        Assert.AreEqual(5.0, WarmTotal, 'Expected the warm-up project''s total to still be correct');
        ClearAllEntries();

        // A project whose history has grown large - looking up its total
        // must stay just as cheap as looking up a brand-new project's.
        HoursPerEntry := 3.25;
        EntryCount := Any.IntegerInRange(160, 240);
        for i := 1 to EntryCount do
            SeedEntry('PRJ-BIG', HoursPerEntry);
        ExpectedTotal := EntryCount * HoursPerEntry;
        RowsBudget := 14;
        InvalidateDataCache();

        RowsBefore := SessionInformation.SqlRowsRead;
        Total := ProjectHours.TotalHoursBilled('PRJ-BIG');
        RowsAfter := SessionInformation.SqlRowsRead;
        RowsUsed := RowsAfter - RowsBefore;

        Assert.AreEqual(ExpectedTotal, Total,
            StrSubstNo('Expected the total for a heavily-logged project to still add up all %1 entries exactly, even once looking it up no longer crawls the whole history', EntryCount));
        Assert.IsTrue(RowsUsed <= RowsBudget,
            StrSubstNo('Expected looking up the total for a heavily-logged project to cost about the same as for a freshly started one: budget %1, actual %2 against %3 entries', RowsBudget, RowsUsed, EntryCount));
    end;
}
