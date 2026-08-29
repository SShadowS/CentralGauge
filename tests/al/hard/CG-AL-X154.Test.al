codeunit 89374 "CG-AL-X154 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        RateService: Codeunit "CG X154 Rate Service";
        SetupMgt: Codeunit "CG X154 Setup Mgt";
        StatementBuilder: Codeunit "CG X154 Statement Builder";

    // Companies are enumerated at runtime, never hardcoded, and every test
    // that touches the other company deletes what it seeded there BEFORE
    // asserting anything, then Commit()s that delete - so the cleanup is
    // durable even if a later assertion in the same test fails and raises
    // an error. A defensive clear also runs at the start of every
    // cross-company test in case a still-earlier run was aborted before it
    // could self-heal.

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

    local procedure ClearHomeRate()
    var
        RateSetup: Record "CG X154 Rate Setup";
    begin
        RateSetup.DeleteAll();
    end;

    local procedure ClearOtherRate(OtherName: Text[30])
    var
        RateSetup: Record "CG X154 Rate Setup";
    begin
        RateSetup.ChangeCompany(OtherName);
        RateSetup.DeleteAll();
    end;

    local procedure ClearHomeActivity()
    var
        Activity: Record "CG X154 Activity";
    begin
        Activity.DeleteAll();
    end;

    local procedure ClearOtherActivity(OtherName: Text[30])
    var
        Activity: Record "CG X154 Activity";
    begin
        Activity.ChangeCompany(OtherName);
        Activity.DeleteAll();
    end;

    local procedure ClearBoth(OtherName: Text[30])
    begin
        ClearHomeRate();
        ClearOtherRate(OtherName);
        ClearHomeActivity();
        ClearOtherActivity(OtherName);
        Commit();
    end;

    // BuildCharges prices EVERY company on the database, not just the two
    // graded below - on a container with a third company, an unconfigured
    // rate there must not make the statement itself error out. These two
    // helpers keep that container-topology detail out of the graded
    // assertions: every company gets a harmless placeholder rate, then the
    // two companies actually graded are overridden with their real values.

    local procedure SeedDefaultRateInEveryCompany(DefaultRate: Decimal)
    var
        Company: Record Company;
    begin
        if Company.FindSet() then
            repeat
                SetupMgt.SetServiceRate(Company.Name, DefaultRate);
            until Company.Next() = 0;
    end;

    local procedure ClearRateInEveryCompany()
    var
        Company: Record Company;
        RateSetup: Record "CG X154 Rate Setup";
    begin
        if Company.FindSet() then
            repeat
                RateSetup.ChangeCompany(Company.Name);
                RateSetup.DeleteAll();
            until Company.Next() = 0;
    end;

    [Test]
    procedure TheConsolidatedStatementChargesEachCompanyAtItsOwnRate()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        Charges: Dictionary of [Text, Decimal];
        HomeCharge: Decimal;
        OtherCharge: Decimal;
    begin
        OtherName := GetOtherCompanyName();
        HomeName := CompanyName();
        ClearBoth(OtherName);
        ClearRateInEveryCompany();
        Commit();
        RateService.Reset();

        SeedDefaultRateInEveryCompany(1.0);

        SetupMgt.SetServiceRate(HomeName, 12.5);
        SetupMgt.SetActivityQuantity(HomeName, 4);
        SetupMgt.SetServiceRate(OtherName, 7.25);
        SetupMgt.SetActivityQuantity(OtherName, 10);

        Charges := StatementBuilder.BuildCharges();
        HomeCharge := Charges.Get(HomeName);
        OtherCharge := Charges.Get(OtherName);

        ClearBoth(OtherName);
        ClearRateInEveryCompany();
        Commit();

        Assert.AreEqual(50.0, HomeCharge,
            'Expected the home company to be charged its own quantity times its own configured rate');
        Assert.AreEqual(72.5, OtherCharge,
            'Expected the other company to be charged its own quantity times its own configured rate, not the home company''s rate');
    end;

    [Test]
    procedure QueryingTheOtherCompanysRateFirstStillLeavesTheHomeCompanysRateCorrect()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        OtherRate: Decimal;
        HomeRate: Decimal;
    begin
        OtherName := GetOtherCompanyName();
        HomeName := CompanyName();
        ClearBoth(OtherName);
        RateService.Reset();

        SetupMgt.SetServiceRate(HomeName, 18.0);
        SetupMgt.SetServiceRate(OtherName, 3.5);

        OtherRate := RateService.GetServiceRate(OtherName);
        HomeRate := RateService.GetServiceRate(HomeName);

        ClearBoth(OtherName);

        Assert.AreEqual(3.5, OtherRate,
            'Expected the other company''s rate to reflect what it configured for itself');
        Assert.AreEqual(18.0, HomeRate,
            'Expected the home company''s rate to reflect what it configured for itself, unaffected by having just looked up another company''s rate');
    end;

    [Test]
    procedure QueryingTheHomeCompanysRateFirstStillLeavesTheOtherCompanysRateCorrect()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        HomeRate: Decimal;
        OtherRate: Decimal;
    begin
        OtherName := GetOtherCompanyName();
        HomeName := CompanyName();
        ClearBoth(OtherName);
        RateService.Reset();

        SetupMgt.SetServiceRate(HomeName, 9.9);
        SetupMgt.SetServiceRate(OtherName, 21.0);

        HomeRate := RateService.GetServiceRate(HomeName);
        OtherRate := RateService.GetServiceRate(OtherName);

        ClearBoth(OtherName);

        Assert.AreEqual(9.9, HomeRate,
            'Expected the home company''s rate to reflect what it configured for itself');
        Assert.AreEqual(21.0, OtherRate,
            'Expected the other company''s rate to reflect what it configured for itself, unaffected by having just looked up the home company''s rate');
    end;

    [Test]
    procedure PricingOnlyTheHomeCompanysOwnActivityReflectsItsOwnRate()
    var
        HomeName: Text[30];
        Rate: Decimal;
    begin
        HomeName := CompanyName();
        ClearHomeRate();
        RateService.Reset();

        SetupMgt.SetServiceRate(HomeName, 6.4);

        Rate := RateService.GetServiceRate(HomeName);

        ClearHomeRate();

        Assert.AreEqual(6.4, Rate,
            'Expected the home company''s own rate lookup to reflect what it configured for itself');
    end;

    [Test]
    procedure ChangingOneCompanysRateDoesNotChangeAnotherCompanysConfiguredRate()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        RateSetup: Record "CG X154 Rate Setup";
        OtherRateSetup: Record "CG X154 Rate Setup";
        HomeDirect: Decimal;
        OtherDirect: Decimal;
    begin
        OtherName := GetOtherCompanyName();
        HomeName := CompanyName();
        ClearBoth(OtherName);

        SetupMgt.SetServiceRate(HomeName, 15.0);
        SetupMgt.SetServiceRate(OtherName, 40.0);

        HomeDirect := SetupMgt.GetServiceRateDirect(HomeName);
        OtherDirect := SetupMgt.GetServiceRateDirect(OtherName);

        RateSetup.Get('RATE');
        OtherRateSetup.ChangeCompany(OtherName);
        OtherRateSetup.Get('RATE');

        ClearBoth(OtherName);

        Assert.AreEqual(15.0, HomeDirect,
            'Expected the home company''s directly configured rate to be unaffected by another company''s configured rate');
        Assert.AreEqual(40.0, OtherDirect,
            'Expected the other company''s directly configured rate to reflect what it configured for itself');
        Assert.AreEqual(15.0, RateSetup."Service Rate",
            'Expected the home company''s rate to be persisted with its own value on its own record');
        Assert.AreEqual(40.0, OtherRateSetup."Service Rate",
            'Expected the other company''s rate to be persisted with its own value on its own record');
    end;

    [Test]
    procedure ChangingOneCompanysActivityQuantityDoesNotChangeAnotherCompanysQuantity()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        Activity: Record "CG X154 Activity";
        OtherActivity: Record "CG X154 Activity";
        HomeQty: Decimal;
        OtherQty: Decimal;
    begin
        OtherName := GetOtherCompanyName();
        HomeName := CompanyName();
        ClearBoth(OtherName);

        SetupMgt.SetActivityQuantity(HomeName, 8);
        SetupMgt.SetActivityQuantity(OtherName, 33);

        HomeQty := SetupMgt.GetActivityQuantity(HomeName);
        OtherQty := SetupMgt.GetActivityQuantity(OtherName);

        Activity.Get('ACTIVITY');
        OtherActivity.ChangeCompany(OtherName);
        OtherActivity.Get('ACTIVITY');

        ClearBoth(OtherName);

        Assert.AreEqual(8.0, HomeQty,
            'Expected the home company''s activity quantity to be unaffected by another company''s activity');
        Assert.AreEqual(33.0, OtherQty,
            'Expected the other company''s activity quantity to reflect what was configured for it');
        Assert.AreEqual(8.0, Activity.Quantity,
            'Expected the home company''s activity quantity to be persisted on its own record');
        Assert.AreEqual(33.0, OtherActivity.Quantity,
            'Expected the other company''s activity quantity to be persisted on its own record');
    end;

    [Test]
    procedure ACompanyThatHasNotConfiguredARateIsTreatedAsZero()
    var
        HomeName: Text[30];
        Rate: Decimal;
    begin
        HomeName := CompanyName();
        ClearHomeRate();

        Rate := SetupMgt.GetServiceRateDirect(HomeName);

        Assert.AreEqual(0.0, Rate,
            'Expected no configured rate to read as zero rather than an arbitrary leftover value');
    end;

    [Test]
    procedure ACompanyThatHasNotConfiguredActivityIsTreatedAsZero()
    var
        HomeName: Text[30];
        Qty: Decimal;
    begin
        HomeName := CompanyName();
        ClearHomeActivity();

        Qty := SetupMgt.GetActivityQuantity(HomeName);

        Assert.AreEqual(0.0, Qty,
            'Expected no configured activity to read as zero rather than an arbitrary leftover value');
    end;

    [Test]
    procedure ResettingAndReconfiguringTheRateIsReflectedOnTheNextLookup()
    var
        HomeName: Text[30];
        RateBefore: Decimal;
        RateAfter: Decimal;
    begin
        HomeName := CompanyName();
        ClearHomeRate();
        RateService.Reset();

        SetupMgt.SetServiceRate(HomeName, 5.0);
        RateBefore := RateService.GetServiceRate(HomeName);

        RateService.Reset();
        SetupMgt.SetServiceRate(HomeName, 60.0);
        RateAfter := RateService.GetServiceRate(HomeName);

        ClearHomeRate();

        Assert.AreEqual(5.0, RateBefore,
            'Expected the first lookup to reflect the rate configured at that point');
        Assert.AreEqual(60.0, RateAfter,
            'Expected a fresh lookup after reconfiguring the rate to reflect the newly configured value');
    end;
}
