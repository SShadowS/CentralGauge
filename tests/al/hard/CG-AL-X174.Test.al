codeunit 89394 "CG-AL-X174 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        Consolidator: Codeunit "CG X162 Consolidator";
        SetupMgt: Codeunit "CG X162 Setup Mgt";
        LedgerMgt: Codeunit "CG X163 Ledger Mgt";
        GroupTotals: Codeunit "CG X163 Group Totals";

    // === Shared helper ===

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

    // === Shared helpers: wallet module (CG X160) ===

    local procedure ClearX160Data()
    var
        Wallet: Record "CG X160 Wallet";
        WalletEntry: Record "CG X160 Wallet Entry";
    begin
        Wallet.DeleteAll();
        WalletEntry.DeleteAll();
    end;

    local procedure SeedWallet(No: Code[20]; Balance: Decimal)
    var
        Wallet: Record "CG X160 Wallet";
    begin
        Wallet.Init();
        Wallet."No." := No;
        Wallet.Balance := Balance;
        Wallet."Total Charged" := 0;
        Wallet.Insert();
    end;

    // Seeds a wallet with a nonzero "Total Charged" sentinel set directly on
    // the record, standing in for charges recorded by earlier, unrelated
    // work - a wallet this test never expects to be charged must still show
    // exactly this figure afterwards.
    local procedure SeedWalletWithTotalChargedSentinel(No: Code[20]; Balance: Decimal; TotalChargedSentinel: Decimal)
    var
        Wallet: Record "CG X160 Wallet";
    begin
        Wallet.Init();
        Wallet."No." := No;
        Wallet.Balance := Balance;
        Wallet."Total Charged" := TotalChargedSentinel;
        Wallet.Insert();
    end;

    local procedure EntryCountFor(WalletNo: Code[20]): Integer
    var
        WalletEntry: Record "CG X160 Wallet Entry";
    begin
        WalletEntry.SetRange("Wallet No.", WalletNo);
        exit(WalletEntry.Count());
    end;

    local procedure GetLastEntry(WalletNo: Code[20]; var WalletEntry: Record "CG X160 Wallet Entry")
    begin
        WalletEntry.SetRange("Wallet No.", WalletNo);
        Assert.IsTrue(WalletEntry.FindLast(), StrSubstNo('Expected at least one ledger entry for wallet %1', WalletNo));
    end;

    // === Shared helpers: meter collection module (CG X162) ===

    local procedure ClearCollectedReadings()
    var
        CollectedReading: Record "CG X162 Collected Reading";
    begin
        CollectedReading.DeleteAll();
    end;

    local procedure ClearHomeMeterReadings()
    var
        MeterReading: Record "CG X162 Meter Reading";
    begin
        MeterReading.DeleteAll();
    end;

    local procedure ClearOtherMeterReadings(OtherName: Text[30])
    var
        MeterReading: Record "CG X162 Meter Reading";
    begin
        MeterReading.ChangeCompany(OtherName);
        MeterReading.DeleteAll();
    end;

    // Used only by the two adapted meter-collection regression tests below,
    // which exercise the cross-company consolidator directly.
    local procedure ClearMeterCollectionFixture(OtherName: Text[30])
    begin
        ClearHomeMeterReadings();
        ClearOtherMeterReadings(OtherName);
        ClearCollectedReadings();
        Commit();
    end;

    // Used by every settlement test below - the settlement never runs the
    // consolidator itself, it only reads whatever the collected list
    // already holds, so a single-company clear is all any of them need.
    local procedure ClearMeterCollectionHomeData()
    begin
        ClearHomeMeterReadings();
        ClearCollectedReadings();
    end;

    local procedure SeedCollectedReading(SourceCompany: Text[30]; MeterNo: Code[10]; Qty: Decimal)
    var
        CollectedReading: Record "CG X162 Collected Reading";
    begin
        CollectedReading.Init();
        CollectedReading."Source Company" := SourceCompany;
        CollectedReading."Meter No." := MeterNo;
        CollectedReading.Quantity := Qty;
        CollectedReading.Insert();
    end;

    // === Shared helpers: branch ledger module (CG X163) ===

    local procedure ClearX163HomeLedger()
    var
        Ledger: Record "CG X163 Branch Ledger";
    begin
        Ledger.DeleteAll();
    end;

    local procedure ClearX163OtherLedger(OtherName: Text[30])
    var
        Ledger: Record "CG X163 Branch Ledger";
    begin
        Ledger.ChangeCompany(OtherName);
        Ledger.DeleteAll();
    end;

    local procedure ClearX163QueryLog()
    var
        QueryLog: Record "CG X163 Query Log";
    begin
        QueryLog.DeleteAll();
    end;

    local procedure ClearX163Fixture(OtherName: Text[30])
    begin
        ClearX163HomeLedger();
        ClearX163OtherLedger(OtherName);
        ClearX163QueryLog();
        Commit();
    end;

    // === Shared helpers: settlement module (CG X174) ===

    local procedure ClearX174Data()
    var
        SettlementLine: Record "CG X174 Settlement Line";
        OwnerMap: Record "CG X174 Owner Map";
    begin
        SettlementLine.DeleteAll();
        OwnerMap.DeleteAll();
    end;

    local procedure SeedOwnerMap(MeterNo: Code[10]; WalletNo: Code[20])
    var
        OwnerMap: Record "CG X174 Owner Map";
    begin
        OwnerMap.Init();
        OwnerMap."Meter No." := MeterNo;
        OwnerMap."Wallet No." := WalletNo;
        OwnerMap.Insert();
    end;

    local procedure GetSettlementShare(PeriodCode: Code[20]; WalletNo: Code[20]): Decimal
    var
        SettlementLine: Record "CG X174 Settlement Line";
    begin
        SettlementLine.Get(PeriodCode, WalletNo);
        exit(SettlementLine."Cost Share");
    end;

    local procedure GetSettlementUsage(PeriodCode: Code[20]; WalletNo: Code[20]): Decimal
    var
        SettlementLine: Record "CG X174 Settlement Line";
    begin
        SettlementLine.Get(PeriodCode, WalletNo);
        exit(SettlementLine.Usage);
    end;

    local procedure CountSettlementLinesForPeriod(PeriodCode: Code[20]): Integer
    var
        SettlementLine: Record "CG X174 Settlement Line";
    begin
        SettlementLine.SetRange("Period Code", PeriodCode);
        exit(SettlementLine.Count());
    end;

    // A wallet's exact proportional share of the pool, before any cent gets
    // placed anywhere - the contract every correct settlement must track,
    // independent of which specific wallet a leftover cent lands on.
    local procedure ExactProportionalShare(PoolAmount: Decimal; Usage: Decimal; TotalUsage: Decimal): Decimal
    begin
        if TotalUsage = 0 then
            exit(0);
        exit(PoolAmount * Usage / TotalUsage);
    end;

    // Grades the invariant the description actually licenses - "each
    // owner's share tracking their usage share" - not any one algorithm's
    // choice of which wallet absorbs a leftover cent. A correct settlement
    // may place a period's leftover cents on any wallet(s) it likes, as
    // long as every wallet's own recorded share stays within a cent of its
    // exact proportional value; the actual discriminator against the
    // starter's drifting sum is the separate exact-total assertion each
    // caller makes after summing every wallet's recorded share.
    local procedure AssertShareWithinACentOfExactProportion(ActualShare: Decimal; PoolAmount: Decimal; Usage: Decimal; TotalUsage: Decimal; Context: Text)
    var
        ExactShare: Decimal;
    begin
        ExactShare := ExactProportionalShare(PoolAmount, Usage, TotalUsage);
        Assert.IsTrue(Abs(ActualShare - ExactShare) <= 0.01,
            StrSubstNo('Expected %1''s recorded cost share to track its own usage share of the pool to within a cent (exact proportional value %2, recorded %3)', Context, ExactShare, ActualShare));
    end;

    // ============================================================
    // Wallet module tests (CG X160 regression)
    // ============================================================

    [Test]
    procedure ChargingAWalletReducesItsBalanceAndUpdatesItsTotalCharged()
    var
        Wallet: Record "CG X160 Wallet";
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
        Entry: Record "CG X160 Wallet Entry";
    begin
        ClearX160Data();
        SeedWallet('CW-01', 500);

        WalletMgt.PostCharge('CW-01', 120);

        Wallet.Get('CW-01');
        Assert.AreEqual(380.0, Wallet.Balance, 'Expected the charge to reduce the wallet''s balance');
        Assert.AreEqual(120.0, Wallet."Total Charged", 'Expected the charge to add to the wallet''s running total');
        GetLastEntry('CW-01', Entry);
        Assert.AreEqual(120.0, Entry.Amount, 'Expected the ledger entry to record the charged amount');
    end;

    [Test]
    procedure ChargingMoreThanAWalletsBalanceIsRefused()
    var
        WalletMgt: Codeunit "CG X160 Wallet Mgt";
    begin
        ClearX160Data();
        SeedWallet('CW-02', 100);

        asserterror WalletMgt.PostCharge('CW-02', 100.01);

        Assert.ExpectedError('CW-02');
    end;

    // ============================================================
    // Meter collection module tests (CG X162 regression)
    // ============================================================

    [Test]
    procedure TheCollectedTotalAddsUpEveryReadingFromEveryCompany()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        CollectedReading: Record "CG X162 Collected Reading";
        Total: Decimal;
    begin
        OtherName := GetOtherCompanyName();
        HomeName := CompanyName();
        ClearMeterCollectionFixture(OtherName);

        SetupMgt.SetMeterReading(HomeName, 'H1', 5);
        SetupMgt.SetMeterReading(HomeName, 'H2', 3);
        SetupMgt.SetMeterReading(OtherName, 'O1', 9);
        SetupMgt.SetMeterReading(OtherName, 'O2', 2);

        Consolidator.CollectReadings();

        if CollectedReading.FindSet() then
            repeat
                Total += CollectedReading.Quantity;
            until CollectedReading.Next() = 0;

        ClearMeterCollectionFixture(OtherName);

        Assert.AreEqual(19.0, Total,
            'Expected the collected list''s total quantity to equal the sum of every reading collected from every company');
    end;

    [Test]
    procedure ReadingsFromTheOtherCompanyAreFiledUnderTheCompanyTheyCameFrom()
    var
        OtherName: Text[30];
        HomeName: Text[30];
        CollectedReading: Record "CG X162 Collected Reading";
        FiledUnderOther: Boolean;
        MisfiledUnderHome: Boolean;
        OtherQty: Decimal;
    begin
        OtherName := GetOtherCompanyName();
        HomeName := CompanyName();
        ClearMeterCollectionFixture(OtherName);

        SetupMgt.SetMeterReading(HomeName, 'H1', 5);
        SetupMgt.SetMeterReading(OtherName, 'O1', 9);

        Consolidator.CollectReadings();

        FiledUnderOther := CollectedReading.Get(OtherName, 'O1');
        if FiledUnderOther then
            OtherQty := CollectedReading.Quantity;
        MisfiledUnderHome := CollectedReading.Get(HomeName, 'O1');

        ClearMeterCollectionFixture(OtherName);

        Assert.IsTrue(FiledUnderOther,
            'Expected the reading recorded by the other company to be filed in the collected list under the other company');
        Assert.AreEqual(9.0, OtherQty,
            'Expected the reading filed under the other company to keep its own recorded quantity');
        Assert.IsFalse(MisfiledUnderHome,
            'Expected the reading recorded by the other company not to be filed under this company');
    end;

    // ============================================================
    // Branch ledger module tests (CG X163 regression)
    // ============================================================

    [Test]
    procedure TheGroupTotalCombinesEachBranchsOwnAmountForAnAccount()
    var
        OtherName: Text[30];
        Total: Decimal;
    begin
        OtherName := GetOtherCompanyName();
        ClearX163Fixture(OtherName);

        LedgerMgt.SetAmount(CompanyName(), 'ACCT-A', 40.5);
        LedgerMgt.SetAmount(OtherName, 'ACCT-A', 27.25);

        Total := GroupTotals.GetGroupTotal('ACCT-A');

        ClearX163Fixture(OtherName);

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
        ClearX163Fixture(OtherName);

        LedgerMgt.SetAmount(OtherName, 'ACCT-B', 18.75);

        Total := GroupTotals.GetGroupTotal('ACCT-B');

        ClearX163Fixture(OtherName);

        Assert.AreEqual(18.75, Total,
            'Expected an account configured only on the other branch to still contribute its full amount to the group total');
    end;

    // ============================================================
    // Settlement glue tests (CG X174)
    // ============================================================

    [Test]
    procedure UsageFromMultipleMetersMappedToTheSameWalletIsAggregatedBeforeSettling()
    var
        SettlementMgt: Codeunit "CG X174 Settlement Mgt";
        HomeName: Text[30];
    begin
        HomeName := CompanyName();
        ClearX160Data();
        ClearMeterCollectionHomeData();
        ClearX174Data();
        SeedWallet('MM-W1', 1000);
        SeedOwnerMap('MM-A1', 'MM-W1');
        SeedOwnerMap('MM-A2', 'MM-W1');
        SeedCollectedReading(HomeName, 'MM-A1', 30);
        SeedCollectedReading(HomeName, 'MM-A2', 15);

        SettlementMgt.SettlePeriod('MM01', 90.00);

        Assert.AreEqual(45.0, GetSettlementUsage('MM01', 'MM-W1'),
            'Expected the wallet''s recorded usage to combine the usage from every meter mapped to it');
        Assert.AreEqual(90.00, GetSettlementShare('MM01', 'MM-W1'),
            'Expected the sole wallet on the period to receive the entire cost pool once its meters'' usage is combined');
    end;

    [Test]
    procedure AReadingFromAMeterWithNoRecordedOwnerContributesNothingToTheSettlement()
    var
        SettlementMgt: Codeunit "CG X174 Settlement Mgt";
        HomeName: Text[30];
    begin
        HomeName := CompanyName();
        ClearX160Data();
        ClearMeterCollectionHomeData();
        ClearX174Data();
        SeedWallet('UM-W1', 1000);
        SeedOwnerMap('UM-A1', 'UM-W1');
        SeedCollectedReading(HomeName, 'UM-A1', 40);
        // No owner is recorded for this meter at all - a much larger reading
        // than the mapped one, so if it were counted it would swamp the
        // mapped wallet's share instead of leaving it alone.
        SeedCollectedReading(HomeName, 'UM-UNMAP', 999);

        SettlementMgt.SettlePeriod('UM01', 100.00);

        Assert.AreEqual(100.00, GetSettlementShare('UM01', 'UM-W1'),
            'Expected the mapped wallet to receive the full cost pool, unaffected by usage from a meter with no recorded owner');
    end;

    [Test]
    procedure SettlementLinesRecordEachWalletsUsageAndItsComputedCostShare()
    var
        SettlementMgt: Codeunit "CG X174 Settlement Mgt";
        HomeName: Text[30];
    begin
        HomeName := CompanyName();
        ClearX160Data();
        ClearMeterCollectionHomeData();
        ClearX174Data();
        SeedWallet('SL-W1', 1000);
        SeedWallet('SL-W2', 1000);
        SeedOwnerMap('SL-A1', 'SL-W1');
        SeedOwnerMap('SL-A2', 'SL-W2');
        SeedCollectedReading(HomeName, 'SL-A1', 30);
        SeedCollectedReading(HomeName, 'SL-A2', 20);

        SettlementMgt.SettlePeriod('SL01', 500.00);

        Assert.AreEqual(30.0, GetSettlementUsage('SL01', 'SL-W1'), 'Expected the settlement line to record this wallet''s own usage');
        Assert.AreEqual(20.0, GetSettlementUsage('SL01', 'SL-W2'), 'Expected the other wallet''s settlement line to record its own usage');
        Assert.AreEqual(300.00, GetSettlementShare('SL01', 'SL-W1'), 'Expected the settlement line to record this wallet''s computed cost share');
        Assert.AreEqual(200.00, GetSettlementShare('SL01', 'SL-W2'), 'Expected the other wallet''s settlement line to record its own computed cost share');
        Assert.AreEqual(2, CountSettlementLinesForPeriod('SL01'), 'Expected exactly one settlement line per wallet with usage in the period');
    end;

    [Test]
    procedure ResettlingAPeriodReplacesItsSettlementLinesRatherThanAddingMoreOfThem()
    var
        SettlementMgt: Codeunit "CG X174 Settlement Mgt";
        HomeName: Text[30];
        CollectedReading: Record "CG X162 Collected Reading";
    begin
        HomeName := CompanyName();
        ClearX160Data();
        ClearMeterCollectionHomeData();
        ClearX174Data();
        SeedWallet('RS-W1', 1000);
        SeedWallet('RS-W2', 1000);
        SeedOwnerMap('RS-A1', 'RS-W1');
        SeedOwnerMap('RS-A2', 'RS-W2');
        SeedCollectedReading(HomeName, 'RS-A1', 10);
        SeedCollectedReading(HomeName, 'RS-A2', 10);

        SettlementMgt.SettlePeriod('RS01', 200.00);

        Assert.AreEqual(100.00, GetSettlementShare('RS01', 'RS-W1'), 'Expected the first settlement run''s even split');
        Assert.AreEqual(100.00, GetSettlementShare('RS01', 'RS-W2'), 'Expected the first settlement run''s even split');
        Assert.AreEqual(2, CountSettlementLinesForPeriod('RS01'), 'Expected one settlement line per wallet after the first run');

        // The meters' usage changes before the period is settled again.
        CollectedReading.Get(HomeName, 'RS-A1');
        CollectedReading.Quantity := 30;
        CollectedReading.Modify();

        SettlementMgt.SettlePeriod('RS01', 200.00);

        Assert.AreEqual(2, CountSettlementLinesForPeriod('RS01'),
            'Expected resettling the same period to leave exactly one settlement line per wallet, not add more of them');
        Assert.AreEqual(150.00, GetSettlementShare('RS01', 'RS-W1'),
            'Expected the resettled line to reflect the newly recorded usage, not the usage from the previous run');
        Assert.AreEqual(50.00, GetSettlementShare('RS01', 'RS-W2'),
            'Expected the other wallet''s resettled line to reflect its share of the newly recorded usage');
    end;

    [Test]
    procedure SettlingOnePeriodNeverTouchesAnotherPeriodsSettlementLines()
    var
        SettlementMgt: Codeunit "CG X174 Settlement Mgt";
        HomeName: Text[30];
    begin
        HomeName := CompanyName();
        ClearX160Data();
        ClearMeterCollectionHomeData();
        ClearX174Data();
        SeedWallet('CP-W1', 1000);
        SeedWallet('CP-W2', 1000);
        SeedOwnerMap('CP-A1', 'CP-W1');
        SeedOwnerMap('CP-A2', 'CP-W2');
        SeedCollectedReading(HomeName, 'CP-A1', 10);
        SeedCollectedReading(HomeName, 'CP-A2', 15);

        SettlementMgt.SettlePeriod('CPA', 100.00);
        SettlementMgt.SettlePeriod('CPB', 300.00);

        Assert.AreEqual(40.00, GetSettlementShare('CPA', 'CP-W1'), 'Expected the first period''s settlement to be unaffected by settling a second period afterwards');
        Assert.AreEqual(60.00, GetSettlementShare('CPA', 'CP-W2'), 'Expected the first period''s settlement to be unaffected by settling a second period afterwards');
        Assert.AreEqual(120.00, GetSettlementShare('CPB', 'CP-W1'), 'Expected the second period''s own settlement to reflect its own cost pool');
        Assert.AreEqual(180.00, GetSettlementShare('CPB', 'CP-W2'), 'Expected the second period''s own settlement to reflect its own cost pool');
        Assert.AreEqual(2, CountSettlementLinesForPeriod('CPA'), 'Expected the first period to still hold only its own two settlement lines');
        Assert.AreEqual(2, CountSettlementLinesForPeriod('CPB'), 'Expected the second period to hold only its own two settlement lines');
    end;

    [Test]
    procedure AWalletWithNoUsageAmongWalletsThatDoHaveUsageIsNeverCharged()
    var
        SettlementMgt: Codeunit "CG X174 Settlement Mgt";
        Wallet: Record "CG X160 Wallet";
        HomeName: Text[30];
    begin
        HomeName := CompanyName();
        ClearX160Data();
        ClearMeterCollectionHomeData();
        ClearX174Data();
        SeedWallet('ZU-W1', 500);
        // Simulates a wallet that already carried a nonzero running total
        // from earlier, unrelated charges before this settlement runs.
        SeedWalletWithTotalChargedSentinel('ZU-W2', 500, 42.00);
        SeedWallet('ZU-W3', 500);
        SeedOwnerMap('ZU-A1', 'ZU-W1');
        SeedOwnerMap('ZU-A2', 'ZU-W2');
        SeedOwnerMap('ZU-A3', 'ZU-W3');
        SeedCollectedReading(HomeName, 'ZU-A1', 50);
        SeedCollectedReading(HomeName, 'ZU-A2', 0);
        SeedCollectedReading(HomeName, 'ZU-A3', 50);

        SettlementMgt.SettlePeriod('ZU01', 100.00);

        Assert.AreEqual(0.00, GetSettlementShare('ZU01', 'ZU-W2'), 'Expected a wallet with no usage in the period to receive a cost share of exactly zero');
        Assert.AreEqual(0, EntryCountFor('ZU-W2'), 'Expected a wallet with no usage in the period to receive no ledger entries at all');
        Wallet.Get('ZU-W2');
        Assert.AreEqual(500.0, Wallet.Balance, 'Expected an uncharged wallet''s balance to be left exactly as it was');
        Assert.AreEqual(42.00, Wallet."Total Charged", 'Expected an uncharged wallet''s running total to be left exactly as it was, not reset or added to');

        Assert.AreEqual(50.00, GetSettlementShare('ZU01', 'ZU-W1'), 'Expected the other wallets to still be settled and charged normally');
        Assert.AreEqual(50.00, GetSettlementShare('ZU01', 'ZU-W3'), 'Expected the other wallets to still be settled and charged normally');
        Assert.AreEqual(1, EntryCountFor('ZU-W1'), 'Expected a wallet with usage in the period to receive exactly one ledger entry');
        Assert.AreEqual(1, EntryCountFor('ZU-W3'), 'Expected a wallet with usage in the period to receive exactly one ledger entry');
    end;

    // ============================================================
    // Settlement allocation tests (CG X174 core)
    // ============================================================

    [Test]
    procedure AnAdversarialUsageMixStillChargesEveryWalletExactlyItsShareOfThePool()
    var
        SettlementMgt: Codeunit "CG X174 Settlement Mgt";
        Wallet: Record "CG X160 Wallet";
        HomeName: Text[30];
        WalletNo: array[5] of Code[20];
        MeterNo: array[5] of Code[10];
        Usage: array[5] of Integer;
        BalanceBefore: array[5] of Decimal;
        TotalUsage: Decimal;
        ActualShare: Decimal;
        SumOfShares: Decimal;
        GrandCharged: Decimal;
        i: Integer;
    begin
        HomeName := CompanyName();
        ClearX160Data();
        ClearMeterCollectionHomeData();
        ClearX174Data();

        WalletNo[1] := 'AD-W1'; MeterNo[1] := 'AD-A1'; Usage[1] := 14;
        WalletNo[2] := 'AD-W2'; MeterNo[2] := 'AD-A2'; Usage[2] := 13;
        WalletNo[3] := 'AD-W3'; MeterNo[3] := 'AD-A3'; Usage[3] := 33;
        WalletNo[4] := 'AD-W4'; MeterNo[4] := 'AD-A4'; Usage[4] := 13;
        WalletNo[5] := 'AD-W5'; MeterNo[5] := 'AD-A5'; Usage[5] := 11;

        TotalUsage := 0;
        for i := 1 to 5 do begin
            SeedWallet(WalletNo[i], 1000);
            SeedOwnerMap(MeterNo[i], WalletNo[i]);
            SeedCollectedReading(HomeName, MeterNo[i], Usage[i]);
            BalanceBefore[i] := 1000;
            TotalUsage += Usage[i];
        end;

        SettlementMgt.SettlePeriod('ADV01', 100.00);

        SumOfShares := 0;
        GrandCharged := 0;
        for i := 1 to 5 do begin
            ActualShare := GetSettlementShare('ADV01', WalletNo[i]);
            AssertShareWithinACentOfExactProportion(ActualShare, 100.00, Usage[i], TotalUsage,
                StrSubstNo('wallet %1', WalletNo[i]));
            SumOfShares += ActualShare;

            Wallet.Get(WalletNo[i]);
            Assert.AreEqual(BalanceBefore[i] - ActualShare, Wallet.Balance,
                StrSubstNo('Expected wallet %1''s balance to be reduced by exactly its recorded cost share', WalletNo[i]));
            Assert.AreEqual(ActualShare, Wallet."Total Charged",
                StrSubstNo('Expected wallet %1''s running charged total to equal exactly its recorded cost share', WalletNo[i]));
            GrandCharged += Wallet."Total Charged";
        end;

        Assert.AreEqual(100.00, SumOfShares, 'Expected every wallet''s recorded cost share on this period to add up to exactly the period''s cost pool');
        Assert.AreEqual(100.00, GrandCharged, 'Expected the total actually charged across every wallet to add up to exactly the period''s cost pool');
    end;

    [Test]
    procedure ASecondAdversarialUsageMixAlsoAddsUpToExactlyThePool()
    var
        SettlementMgt: Codeunit "CG X174 Settlement Mgt";
        Wallet: Record "CG X160 Wallet";
        HomeName: Text[30];
        WalletNo: array[6] of Code[20];
        MeterNo: array[6] of Code[10];
        Usage: array[6] of Integer;
        TotalUsage: Decimal;
        ActualShare: Decimal;
        SumOfShares: Decimal;
        i: Integer;
    begin
        HomeName := CompanyName();
        ClearX160Data();
        ClearMeterCollectionHomeData();
        ClearX174Data();

        WalletNo[1] := 'SD-W1'; MeterNo[1] := 'SD-A1'; Usage[1] := 7;
        WalletNo[2] := 'SD-W2'; MeterNo[2] := 'SD-A2'; Usage[2] := 11;
        WalletNo[3] := 'SD-W3'; MeterNo[3] := 'SD-A3'; Usage[3] := 5;
        WalletNo[4] := 'SD-W4'; MeterNo[4] := 'SD-A4'; Usage[4] := 19;
        WalletNo[5] := 'SD-W5'; MeterNo[5] := 'SD-A5'; Usage[5] := 8;
        WalletNo[6] := 'SD-W6'; MeterNo[6] := 'SD-A6'; Usage[6] := 3;

        TotalUsage := 0;
        for i := 1 to 6 do begin
            SeedWallet(WalletNo[i], 1000);
            SeedOwnerMap(MeterNo[i], WalletNo[i]);
            SeedCollectedReading(HomeName, MeterNo[i], Usage[i]);
            TotalUsage += Usage[i];
        end;

        SettlementMgt.SettlePeriod('SEC01', 150.00);

        SumOfShares := 0;
        for i := 1 to 6 do begin
            ActualShare := GetSettlementShare('SEC01', WalletNo[i]);
            AssertShareWithinACentOfExactProportion(ActualShare, 150.00, Usage[i], TotalUsage,
                StrSubstNo('wallet %1', WalletNo[i]));
            SumOfShares += ActualShare;

            Wallet.Get(WalletNo[i]);
            Assert.AreEqual(ActualShare, Wallet."Total Charged",
                StrSubstNo('Expected wallet %1 to actually be charged exactly its recorded cost share', WalletNo[i]));
        end;
        Assert.AreEqual(150.00, SumOfShares, 'Expected every wallet''s recorded cost share on this second usage mix to still add up to exactly the period''s cost pool');
    end;

    [Test]
    procedure AnEvenUsageSplitAddsUpToExactlyThePool()
    var
        SettlementMgt: Codeunit "CG X174 Settlement Mgt";
        Wallet: Record "CG X160 Wallet";
        HomeName: Text[30];
        WalletNo: array[4] of Code[20];
        MeterNo: array[4] of Code[10];
        i: Integer;
    begin
        HomeName := CompanyName();
        ClearX160Data();
        ClearMeterCollectionHomeData();
        ClearX174Data();

        WalletNo[1] := 'EV-W1'; MeterNo[1] := 'EV-A1';
        WalletNo[2] := 'EV-W2'; MeterNo[2] := 'EV-A2';
        WalletNo[3] := 'EV-W3'; MeterNo[3] := 'EV-A3';
        WalletNo[4] := 'EV-W4'; MeterNo[4] := 'EV-A4';

        for i := 1 to 4 do begin
            SeedWallet(WalletNo[i], 1000);
            SeedOwnerMap(MeterNo[i], WalletNo[i]);
            SeedCollectedReading(HomeName, MeterNo[i], 25);
        end;

        SettlementMgt.SettlePeriod('EVN01', 100.00);

        for i := 1 to 4 do begin
            Assert.AreEqual(25.00, GetSettlementShare('EVN01', WalletNo[i]),
                StrSubstNo('Expected an even usage split to give wallet %1 exactly one quarter of the pool', WalletNo[i]));
            Wallet.Get(WalletNo[i]);
            Assert.AreEqual(25.00, Wallet."Total Charged",
                StrSubstNo('Expected wallet %1 to actually be charged exactly its even quarter share', WalletNo[i]));
        end;
    end;

    [Test]
    procedure DeterministicSweepStillConservesThePoolAcrossManyPartitions()
    var
        SettlementMgt: Codeunit "CG X174 Settlement Mgt";
        Any: Codeunit Any;
        Wallet: Record "CG X160 Wallet";
        HomeName: Text[30];
        WalletNo: array[12] of Code[20];
        Usage: array[12] of Decimal;
        BalanceBefore: array[12] of Decimal;
        TotalChargedBefore: array[12] of Decimal;
        PeriodCode: Code[20];
        PoolAmount: Decimal;
        TotalUsage: Decimal;
        ActualShare: Decimal;
        SumOfShares: Decimal;
        WalletCount: Integer;
        Partition: Integer;
        i: Integer;
    begin
        HomeName := CompanyName();
        Any.SetSeed(174);

        // All seven possible sweep wallets are seeded once, generously
        // funded, and reused across every partition below - only the owner
        // map and the collected readings are cleared and reseeded per
        // partition. A wallet's balance and running total carry over
        // between partitions, so every ledger check below compares against
        // a before-snapshot taken at the start of that same partition, not
        // against zero.
        ClearX160Data();
        for i := 1 to 7 do
            SeedWallet('SW' + Format(i), 50000);

        for Partition := 1 to 5 do begin
            ClearMeterCollectionHomeData();
            ClearX174Data();

            PeriodCode := 'SWP' + Format(Partition);
            WalletCount := Any.IntegerInRange(3, 7);
            PoolAmount := Any.IntegerInRange(100, 99999) / 100;

            TotalUsage := 0;
            for i := 1 to WalletCount do begin
                WalletNo[i] := 'SW' + Format(i);
                Usage[i] := Any.IntegerInRange(1, 60);
                TotalUsage += Usage[i];
                SeedOwnerMap('SWM' + Format(i), WalletNo[i]);
                SeedCollectedReading(HomeName, 'SWM' + Format(i), Usage[i]);
                Wallet.Get(WalletNo[i]);
                BalanceBefore[i] := Wallet.Balance;
                TotalChargedBefore[i] := Wallet."Total Charged";
            end;

            SettlementMgt.SettlePeriod(PeriodCode, PoolAmount);

            SumOfShares := 0;
            for i := 1 to WalletCount do begin
                ActualShare := GetSettlementShare(PeriodCode, WalletNo[i]);
                AssertShareWithinACentOfExactProportion(ActualShare, PoolAmount, Usage[i], TotalUsage,
                    StrSubstNo('wallet %1 of sweep partition %2', WalletNo[i], Partition));
                SumOfShares += ActualShare;

                Wallet.Get(WalletNo[i]);
                Assert.AreEqual(BalanceBefore[i] - ActualShare, Wallet.Balance,
                    StrSubstNo('Expected wallet %1''s balance on sweep partition %2 to be reduced by exactly its recorded cost share', WalletNo[i], Partition));
                Assert.AreEqual(TotalChargedBefore[i] + ActualShare, Wallet."Total Charged",
                    StrSubstNo('Expected wallet %1''s running charged total on sweep partition %2 to grow by exactly its recorded cost share', WalletNo[i], Partition));
            end;
            Assert.AreEqual(PoolAmount, SumOfShares,
                StrSubstNo('Expected the recorded cost shares on sweep partition %1 to add up to exactly its own cost pool', Partition));
        end;
    end;
}
