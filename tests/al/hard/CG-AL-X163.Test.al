codeunit 89383 "CG-AL-X163 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        LedgerMgt: Codeunit "CG X163 Ledger Mgt";
        GroupTotals: Codeunit "CG X163 Group Totals";

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

    local procedure ClearHomeLedger()
    var
        Ledger: Record "CG X163 Branch Ledger";
    begin
        Ledger.DeleteAll();
    end;

    local procedure ClearOtherLedger(OtherName: Text[30])
    var
        Ledger: Record "CG X163 Branch Ledger";
    begin
        Ledger.ChangeCompany(OtherName);
        Ledger.DeleteAll();
    end;

    local procedure ClearQueryLog()
    var
        QueryLog: Record "CG X163 Query Log";
    begin
        QueryLog.DeleteAll();
    end;

    local procedure ClearBoth(OtherName: Text[30])
    begin
        ClearHomeLedger();
        ClearOtherLedger(OtherName);
        ClearQueryLog();
        Commit();
    end;

    [Test]
    procedure TheGroupTotalCombinesEachBranchsOwnAmountForAnAccount()
    var
        OtherName: Text[30];
        Total: Decimal;
    begin
        OtherName := GetOtherCompanyName();
        ClearBoth(OtherName);

        LedgerMgt.SetAmount(CompanyName(), 'ACCT-A', 40.5);
        LedgerMgt.SetAmount(OtherName, 'ACCT-A', 27.25);

        Total := GroupTotals.GetGroupTotal('ACCT-A');

        ClearBoth(OtherName);

        Assert.AreEqual(67.75, Total,
            'Expected the group total for the account to combine every branch''s own configured amount for it');
    end;

    [Test]
    procedure AnAccountHeldOnlyByTheOtherBranchStillContributesItsFullAmount()
    var
        OtherName: Text[30];
        Total: Decimal;
    begin
        OtherName := GetOtherCompanyName();
        ClearBoth(OtherName);

        LedgerMgt.SetAmount(OtherName, 'ACCT-B', 18.75);

        Total := GroupTotals.GetGroupTotal('ACCT-B');

        ClearBoth(OtherName);

        Assert.AreEqual(18.75, Total,
            'Expected an account configured only on the other branch to still contribute its full amount to the group total');
    end;

    [Test]
    procedure AnAccountHeldOnlyByTheHomeBranchStillContributesItsFullAmount()
    var
        OtherName: Text[30];
        Total: Decimal;
    begin
        OtherName := GetOtherCompanyName();
        ClearBoth(OtherName);

        LedgerMgt.SetAmount(CompanyName(), 'ACCT-C', 30.0);

        Total := GroupTotals.GetGroupTotal('ACCT-C');

        ClearBoth(OtherName);

        Assert.AreEqual(30.0, Total,
            'Expected an account configured only on the home branch to still contribute its full amount to the group total');
    end;

    [Test]
    procedure TheGroupTotalForOneAccountIsNotContaminatedByAnotherAccountInTheSameBranch()
    var
        OtherName: Text[30];
        Total: Decimal;
    begin
        OtherName := GetOtherCompanyName();
        ClearBoth(OtherName);

        LedgerMgt.SetAmount(CompanyName(), 'ACCT-P', 12.0);
        LedgerMgt.SetAmount(CompanyName(), 'ACCT-Q', 999.0);

        Total := GroupTotals.GetGroupTotal('ACCT-P');

        ClearBoth(OtherName);

        Assert.AreEqual(12.0, Total,
            'Expected the group total for one account to be unaffected by a different account configured in the same branch');
    end;

    [Test]
    procedure AnAccountWithNoConfiguredAmountAnywhereTotalsToZero()
    var
        OtherName: Text[30];
        Total: Decimal;
    begin
        OtherName := GetOtherCompanyName();
        ClearBoth(OtherName);

        Total := GroupTotals.GetGroupTotal('ACCT-Z');

        ClearBoth(OtherName);

        Assert.AreEqual(0.0, Total,
            'Expected an account with no configured amount on any branch to total to zero');
    end;

    [Test]
    procedure EachBranchsConfiguredAmountIsStoredOnItsOwnRecordUnaffectedByTheOtherBranch()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        HomeLedger: Record "CG X163 Branch Ledger";
        OtherLedger: Record "CG X163 Branch Ledger";
        HomeDirect: Decimal;
        OtherDirect: Decimal;
    begin
        OtherName := GetOtherCompanyName();
        HomeName := CompanyName();
        ClearBoth(OtherName);

        LedgerMgt.SetAmount(HomeName, 'ACCT-M', 17.0);
        LedgerMgt.SetAmount(OtherName, 'ACCT-M', 9.0);

        HomeDirect := LedgerMgt.GetAmountDirect(HomeName, 'ACCT-M');
        OtherDirect := LedgerMgt.GetAmountDirect(OtherName, 'ACCT-M');

        HomeLedger.Get('ACCT-M');
        OtherLedger.ChangeCompany(OtherName);
        OtherLedger.Get('ACCT-M');

        ClearBoth(OtherName);

        Assert.AreEqual(17.0, HomeDirect,
            'Expected the home branch''s configured amount to be unaffected by the other branch''s configured amount for the same account');
        Assert.AreEqual(9.0, OtherDirect,
            'Expected the other branch''s configured amount to reflect what it configured for itself');
        Assert.AreEqual(17.0, HomeLedger.Amount,
            'Expected the home branch''s amount to be persisted with its own value on its own record');
        Assert.AreEqual(9.0, OtherLedger.Amount,
            'Expected the other branch''s amount to be persisted with its own value on its own record');
    end;

    [Test]
    procedure ABranchWithNoConfiguredAmountForAGivenAccountIsTreatedAsZero()
    var
        OtherName: Text[30];
        Direct: Decimal;
    begin
        OtherName := GetOtherCompanyName();
        ClearBoth(OtherName);

        Direct := LedgerMgt.GetAmountDirect(CompanyName(), 'ACCT-N');

        Assert.AreEqual(0.0, Direct,
            'Expected no configured amount for an account on a branch to read as zero rather than an arbitrary leftover value');
    end;
}
