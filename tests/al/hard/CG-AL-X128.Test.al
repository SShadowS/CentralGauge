codeunit 89322 "CG-AL-X128 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // Companies are enumerated at runtime, never hardcoded, and every test
    // that touches the other company deletes what it seeded there BEFORE
    // asserting anything, then Commit()s that delete - so the cleanup is
    // durable even if a later assertion in the same test fails and raises
    // an error (an error only rolls back the CURRENT, still-open
    // transaction; a prior Commit() cannot be undone by it). A defensive
    // clear also runs at the START of every cross-company test in case a
    // still-earlier run was aborted before it could self-heal.

    local procedure GetOtherCompanyName(): Text[30]
    var
        Company: Record Company;
        HereName: Text[30];
    begin
        HereName := CompanyName();
        Company.SetFilter(Name, '<>%1', HereName);
        if Company.FindFirst() then
            exit(Company.Name);
        Error('Expected at least one other company to exist on this container to verify cross-company isolation');
    end;

    local procedure ClearHomeSetup()
    var
        Setup: Record "CG X128 Collection Setup";
    begin
        Setup.DeleteAll();
    end;

    local procedure ClearOtherCompanySetup(OtherName: Text[30])
    var
        Setup: Record "CG X128 Collection Setup";
    begin
        Setup.ChangeCompany(OtherName);
        Setup.DeleteAll();
    end;

    local procedure ClearHomeGroupRate()
    var
        GroupRate: Record "CG X128 Group Rate";
    begin
        GroupRate.DeleteAll();
    end;

    local procedure ClearOtherCompanyGroupRate(OtherName: Text[30])
    var
        GroupRate: Record "CG X128 Group Rate";
    begin
        GroupRate.ChangeCompany(OtherName);
        GroupRate.DeleteAll();
    end;

    local procedure SeedOtherCompanySetup(OtherName: Text[30]; Grace: Integer; Fee: Decimal)
    var
        Setup: Record "CG X128 Collection Setup";
        Found: Boolean;
    begin
        Setup.ChangeCompany(OtherName);
        Found := Setup.Get('SETUP');
        if not Found then begin
            Setup.Init();
            Setup."Primary Key" := 'SETUP';
        end;
        Setup."Grace Period Days" := Grace;
        Setup."Late Fee Percent" := Fee;
        if Found then
            Setup.Modify()
        else
            Setup.Insert();
    end;

    local procedure ReadOtherCompanySetup(OtherName: Text[30]; var Found: Boolean; var Grace: Integer; var Fee: Decimal)
    var
        Setup: Record "CG X128 Collection Setup";
    begin
        Setup.ChangeCompany(OtherName);
        Found := Setup.Get('SETUP');
        if Found then begin
            Grace := Setup."Grace Period Days";
            Fee := Setup."Late Fee Percent";
        end;
    end;

    local procedure ReadOtherCompanyGroupRate(OtherName: Text[30]; CurrencyCode: Code[10]; var Found: Boolean; var Rate: Decimal)
    var
        GroupRate: Record "CG X128 Group Rate";
    begin
        GroupRate.ChangeCompany(OtherName);
        Found := GroupRate.Get(CurrencyCode);
        if Found then
            Rate := GroupRate."Intercompany Rate";
    end;

    [Test]
    procedure ChangingOneCompanysSettingsDoesNotOverwriteAnotherCompanysOwnSettings()
    var
        Policy: Codeunit "CG X128 Collection Policy";
        OtherName: Text[30];
        HomeGraceAfter: Integer;
        HomeFeeAfter: Decimal;
        OtherFoundAfter: Boolean;
        OtherGraceAfter: Integer;
        OtherFeeAfter: Decimal;
    begin
        OtherName := GetOtherCompanyName();
        ClearHomeSetup();
        ClearOtherCompanySetup(OtherName);
        Commit();

        // The other company already configured its own settings.
        SeedOtherCompanySetup(OtherName, 30, 2.5);

        // The home company independently configures its own settings.
        Policy.SetGracePeriodDays(45);
        Policy.SetLateFeePercent(9.9);

        HomeGraceAfter := Policy.GetGracePeriodDays();
        HomeFeeAfter := Policy.GetLateFeePercent();
        ReadOtherCompanySetup(OtherName, OtherFoundAfter, OtherGraceAfter, OtherFeeAfter);

        // Clean up both companies before asserting anything, and commit that
        // cleanup, so this test never leaves data behind in the other
        // company regardless of whether the assertions below pass or fail.
        ClearHomeSetup();
        ClearOtherCompanySetup(OtherName);
        Commit();

        Assert.AreEqual(45, HomeGraceAfter,
            'Expected the home company grace period to reflect what was just configured for it');
        Assert.AreEqual(9.9, HomeFeeAfter,
            'Expected the home company late fee percentage to reflect what was just configured for it');
        Assert.IsTrue(OtherFoundAfter,
            'Expected the other company to still have its own collection settings');
        Assert.AreEqual(30, OtherGraceAfter,
            'Expected the other company grace period to remain the value it configured for itself, unaffected by the home company change');
        Assert.AreEqual(2.5, OtherFeeAfter,
            'Expected the other company late fee percentage to remain the value it configured for itself, unaffected by the home company change');
    end;

    [Test]
    procedure AnotherCompanyConfiguringItsOwnSettingsDoesNotChangeTheHomeCompanysSettings()
    var
        Policy: Codeunit "CG X128 Collection Policy";
        OtherName: Text[30];
        HomeGraceAfter: Integer;
        HomeFeeAfter: Decimal;
        OtherFoundAfter: Boolean;
        OtherGraceAfter: Integer;
        OtherFeeAfter: Decimal;
    begin
        OtherName := GetOtherCompanyName();
        ClearHomeSetup();
        ClearOtherCompanySetup(OtherName);
        Commit();

        // The home company configures its own settings first.
        Policy.SetGracePeriodDays(21);
        Policy.SetLateFeePercent(3.3);

        // A different company now configures its own, different settings.
        SeedOtherCompanySetup(OtherName, 60, 6.6);

        HomeGraceAfter := Policy.GetGracePeriodDays();
        HomeFeeAfter := Policy.GetLateFeePercent();
        ReadOtherCompanySetup(OtherName, OtherFoundAfter, OtherGraceAfter, OtherFeeAfter);

        ClearHomeSetup();
        ClearOtherCompanySetup(OtherName);
        Commit();

        Assert.AreEqual(21, HomeGraceAfter,
            'Expected the home company grace period to remain the value it configured for itself, unaffected by another company''s change');
        Assert.AreEqual(3.3, HomeFeeAfter,
            'Expected the home company late fee percentage to remain the value it configured for itself, unaffected by another company''s change');
        Assert.IsTrue(OtherFoundAfter,
            'Expected the other company to have its own collection settings');
        Assert.AreEqual(60, OtherGraceAfter,
            'Expected the other company grace period to reflect what it configured for itself');
        Assert.AreEqual(6.6, OtherFeeAfter,
            'Expected the other company late fee percentage to reflect what it configured for itself');
    end;

    [Test]
    procedure TheIntercompanyRateIsVisibleAndIdenticalInEveryCompany()
    var
        Treasury: Codeunit "CG X128 Treasury Rate";
        OtherName: Text[30];
        HomeRateAfter: Decimal;
        OtherFoundAfter: Boolean;
        OtherRateAfter: Decimal;
    begin
        OtherName := GetOtherCompanyName();
        ClearHomeGroupRate();
        ClearOtherCompanyGroupRate(OtherName);
        Commit();

        // The rate is set once, from the home company, and must be the
        // same rate every company sees - it is not each company's own.
        Treasury.SetIntercompanyRate('EUR', 1.0937);

        HomeRateAfter := Treasury.GetIntercompanyRate('EUR');
        ReadOtherCompanyGroupRate(OtherName, 'EUR', OtherFoundAfter, OtherRateAfter);

        ClearHomeGroupRate();
        ClearOtherCompanyGroupRate(OtherName);
        Commit();

        Assert.AreEqual(1.0937, HomeRateAfter,
            'Expected the home company to see the intercompany rate that was just set');
        Assert.IsTrue(OtherFoundAfter,
            'Expected the other company to see the same intercompany rate record');
        Assert.AreEqual(1.0937, OtherRateAfter,
            'Expected the other company to see the exact same intercompany rate, since it is shared across every company by design');
    end;

    [Test]
    procedure SettingTheRateForOneCurrencyDoesNotAffectAnother()
    var
        Treasury: Codeunit "CG X128 Treasury Rate";
    begin
        ClearHomeGroupRate();

        Treasury.SetIntercompanyRate('EUR', 1.0937);
        Treasury.SetIntercompanyRate('USD', 1.0);

        Assert.AreEqual(1.0937, Treasury.GetIntercompanyRate('EUR'),
            'Expected the EUR rate to be unaffected by setting a different currency''s rate');
        Assert.AreEqual(1.0, Treasury.GetIntercompanyRate('USD'),
            'Expected the USD rate to reflect what was just set for it');
        Assert.AreEqual(0.0, Treasury.GetIntercompanyRate('GBP'),
            'Expected no intercompany rate for a currency that was never configured');

        ClearHomeGroupRate();
    end;

    [Test]
    procedure SettingAndReadingBackTheGracePeriodAndLateFeeInOneCompanyWorks()
    var
        Policy: Codeunit "CG X128 Collection Policy";
        Policy2: Codeunit "CG X128 Collection Policy";
        Setup: Record "CG X128 Collection Setup";
    begin
        ClearHomeSetup();

        Policy.SetGracePeriodDays(50);
        Policy.SetLateFeePercent(4.25);

        Assert.AreEqual(50, Policy.GetGracePeriodDays(),
            'Expected the grace period to be exactly what was just configured');
        Assert.AreEqual(4.25, Policy.GetLateFeePercent(),
            'Expected the late fee percentage to be exactly what was just configured');
        Assert.AreEqual(50, Policy2.GetGracePeriodDays(),
            'Expected a separate part of the application to see the same grace period that was just configured, not a value private to whatever configured it');
        Setup.FindFirst();
        Assert.AreEqual(50, Setup."Grace Period Days",
            'Expected the configured grace period to be persisted on the collection settings record itself');
        Assert.AreEqual(4.25, Setup."Late Fee Percent",
            'Expected the configured late fee percentage to be persisted on the collection settings record itself');

        ClearHomeSetup();
    end;

    [Test]
    procedure TheSettingsDefaultWhenNothingHasBeenConfiguredYet()
    var
        Policy: Codeunit "CG X128 Collection Policy";
    begin
        ClearHomeSetup();

        Assert.AreEqual(14, Policy.GetGracePeriodDays(),
            'Expected a default grace period before anything has been configured');
        Assert.AreEqual(1.5, Policy.GetLateFeePercent(),
            'Expected a default late fee percentage before anything has been configured');

        ClearHomeSetup();
    end;

    [Test]
    procedure IsOverdueRespectsTheGracePeriodBoundaryExactly()
    var
        Policy: Codeunit "CG X128 Collection Policy";
    begin
        ClearHomeSetup();
        Policy.SetGracePeriodDays(14);

        Assert.IsFalse(Policy.IsOverdue(14),
            'Expected an invoice exactly at the grace period boundary to not yet be overdue');
        Assert.IsTrue(Policy.IsOverdue(15),
            'Expected an invoice one day past the grace period boundary to be overdue');

        ClearHomeSetup();
    end;

    [Test]
    procedure CalculateLateFeeAppliesThePercentageToTheAmount()
    var
        Policy: Codeunit "CG X128 Collection Policy";
    begin
        ClearHomeSetup();
        Policy.SetLateFeePercent(5);

        Assert.AreEqual(10.0, Policy.CalculateLateFee(200),
            'Expected the late fee to be the configured percentage of the overdue amount');
        Assert.AreEqual(0.0, Policy.CalculateLateFee(0),
            'Expected no late fee on a zero overdue amount');

        Policy.SetLateFeePercent(2.5);
        Assert.AreEqual(5.0, Policy.CalculateLateFee(200),
            'Expected the late fee to scale with a different configured percentage on the same overdue amount');

        ClearHomeSetup();
    end;
}
