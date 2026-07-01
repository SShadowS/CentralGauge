codeunit 80296 "CG-AL-X007 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure ClearCurrentCompanyEntries()
    var
        Entry: Record "CG X007 Entry";
    begin
        Entry.DeleteAll();
    end;

    local procedure ClearCompanyEntries(TargetCompany: Text[30])
    var
        Entry: Record "CG X007 Entry";
    begin
        Entry.ChangeCompany(TargetCompany);
        Entry.DeleteAll();
    end;

    local procedure CreateCompanyIfNeeded(TargetCompany: Text[30])
    var
        Company: Record Company;
    begin
        if Company.Get(TargetCompany) then
            exit;
        Company.Init();
        Company.Name := TargetCompany;
        Company.Insert(true);
    end;

    local procedure SeedEntry(TargetCompany: Text[30]; EntryCode: Code[20]; Amount: Integer)
    var
        Entry: Record "CG X007 Entry";
    begin
        Entry.ChangeCompany(TargetCompany);
        if Entry.Get(EntryCode) then
            Entry.Delete();
        Entry.Init();
        Entry."Code" := EntryCode;
        Entry.Amount := Amount;
        Entry.Insert();
    end;

    local procedure CleanupCompany(TargetCompany: Text[30])
    var
        Company: Record Company;
        Entry: Record "CG X007 Entry";
    begin
        Entry.ChangeCompany(TargetCompany);
        Entry.DeleteAll();
        if Company.Get(TargetCompany) then
            Company.Delete(true);
    end;

    [Test]
    procedure SumsAcrossCurrentEmptyAndSecondCompany()
    var
        Entry: Record "CG X007 Entry";
        Summer: Codeunit "CG X007 Summer";
        Companies: List of [Text[30]];
        Total: Integer;
        SecondCompany: Text[30];
        EmptyCompany: Text[30];
    begin
        // [GIVEN] self-heal: a prior run's trap-failure aborts the test
        // procedure on assertion failure and never reaches end-of-test
        // cleanup, which can leave companies + entries behind on the shared
        // container. Wipe every company this test touches before seeding so
        // SeedEntry can never hit a primary-key collision from stale state.
        SecondCompany := 'CG X007 CO2';
        EmptyCompany := 'CG X007 CO3';
        CreateCompanyIfNeeded(SecondCompany);
        CreateCompanyIfNeeded(EmptyCompany);
        ClearCompanyEntries(SecondCompany);
        ClearCompanyEntries(EmptyCompany);
        Commit();

        // [GIVEN] the current company has entries summing to 100
        ClearCurrentCompanyEntries();
        Entry.Init();
        Entry."Code" := 'CUR1';
        Entry.Amount := 40;
        Entry.Insert();
        Entry.Init();
        Entry."Code" := 'CUR2';
        Entry.Amount := 60;
        Entry.Insert();

        // [GIVEN] a second company with entries summing to 30
        SeedEntry(SecondCompany, 'SEC1', 30);

        // [GIVEN] a third company that exists but has no entries at all
        // (already ensured + cleared during self-heal above)
        Commit();

        // [WHEN] summing across the current company, the empty company, and
        // the second company
        Companies.Add(CompanyName());
        Companies.Add(EmptyCompany);
        Companies.Add(SecondCompany);
        Total := Summer.SumAcrossCompanies(Companies);

        // [THEN] the total is the true cross-company sum: 100 + 0 + 30
        Assert.AreEqual(
          130, Total,
          'Total must be the sum of Amount across current, empty, and second companies');

        CleanupCompany(SecondCompany);
        CleanupCompany(EmptyCompany);
        ClearCurrentCompanyEntries();
    end;

    [Test]
    procedure EmptyCompanyAloneSumsToZero()
    var
        Entry: Record "CG X007 Entry";
        Summer: Codeunit "CG X007 Summer";
        Companies: List of [Text[30]];
        Total: Integer;
        EmptyCompany: Text[30];
    begin
        // [GIVEN] self-heal: a prior run's trap-failure aborts the test
        // procedure on assertion failure and never reaches end-of-test
        // cleanup, which can leave entries behind on the shared container.
        // Wipe this company's entries before the test relies on it being
        // genuinely empty.
        EmptyCompany := 'CG X007 CO3';
        CreateCompanyIfNeeded(EmptyCompany);
        ClearCompanyEntries(EmptyCompany);
        Commit();

        // [GIVEN] the current company has entries that must NOT leak into a
        // result that only asks about a different, empty company
        ClearCurrentCompanyEntries();
        Entry.Init();
        Entry."Code" := 'CUR1';
        Entry.Amount := 999;
        Entry.Insert();

        // [GIVEN] a company that exists but has no entries (already ensured
        // + cleared during self-heal above)
        CreateCompanyIfNeeded(EmptyCompany);
        Commit();

        // [WHEN] summing across only the empty company
        Companies.Add(EmptyCompany);
        Total := Summer.SumAcrossCompanies(Companies);

        // [THEN] the total is zero
        Assert.AreEqual(0, Total, 'Sum over a single empty company must be zero');

        CleanupCompany(EmptyCompany);
        ClearCurrentCompanyEntries();
    end;
}
