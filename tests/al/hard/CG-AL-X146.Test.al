codeunit 89366 "CG-AL-X146 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every test clears both tables
    // before seeding its own data.

    local procedure ClearAllData()
    var
        SalesEntry: Record "CG X146 Sales Entry";
        CommissionLine: Record "CG X146 Commission Line";
    begin
        SalesEntry.DeleteAll();
        CommissionLine.DeleteAll();
    end;

    local procedure SeedSalesEntry(var EntryNo: Integer; SalespersonCode: Code[20]; Amount: Decimal)
    var
        SalesEntry: Record "CG X146 Sales Entry";
    begin
        EntryNo += 1;
        SalesEntry.Init();
        SalesEntry."Entry No." := EntryNo;
        SalesEntry."Salesperson Code" := SalespersonCode;
        SalesEntry.Amount := Amount;
        SalesEntry."Posting Date" := WorkDate();
        SalesEntry.Insert();
    end;

    local procedure SeedCommissionLine(SalespersonCode: Code[20]; BaseAmount: Decimal; BonusShare: Decimal)
    var
        CommissionLine: Record "CG X146 Commission Line";
    begin
        CommissionLine.Init();
        CommissionLine."Salesperson Code" := SalespersonCode;
        CommissionLine."Base Amount" := BaseAmount;
        CommissionLine."Bonus Share" := BonusShare;
        CommissionLine.Insert();
    end;

    local procedure GetBaseAmount(SalespersonCode: Code[20]): Decimal
    var
        CommissionLine: Record "CG X146 Commission Line";
    begin
        CommissionLine.Get(SalespersonCode);
        exit(CommissionLine."Base Amount");
    end;

    local procedure GetBonusShare(SalespersonCode: Code[20]): Decimal
    var
        CommissionLine: Record "CG X146 Commission Line";
    begin
        CommissionLine.Get(SalespersonCode);
        exit(CommissionLine."Bonus Share");
    end;

    // Independently reconstructs the split every correct implementation
    // must produce: floor everyone's exact proportional share to the cent,
    // then hand out whatever the floors left on the table one cent at a
    // time to the salespeople closest to rounding up, tie-broken by the
    // lower salesperson code. This mirrors the distributor's own fix - it
    // is the definition of "correct" this oracle grades against, not a
    // re-implementation that happens to agree with one particular solution.
    local procedure ComputeExpectedShares(Base: array[10] of Decimal; SalespersonCode: array[10] of Code[20]; LineCount: Integer; PoolAmount: Decimal; var ExpectedShare: array[10] of Decimal)
    var
        Remainder: array[10] of Decimal;
        Awarded: array[10] of Boolean;
        BaseSum: Decimal;
        FloorSum: Decimal;
        RemainingResidual: Decimal;
        ExactShare: Decimal;
        WinnerIndex: Integer;
        i: Integer;
    begin
        BaseSum := 0;
        for i := 1 to LineCount do
            BaseSum += Base[i];

        FloorSum := 0;
        for i := 1 to LineCount do begin
            Awarded[i] := false;
            if (BaseSum = 0) or (Base[i] = 0) then begin
                ExpectedShare[i] := 0;
                Remainder[i] := 0;
            end else begin
                ExactShare := PoolAmount * Base[i] / BaseSum;
                ExpectedShare[i] := Round(ExactShare, 0.01, '<');
                Remainder[i] := ExactShare - ExpectedShare[i];
                FloorSum += ExpectedShare[i];
            end;
        end;

        if BaseSum = 0 then
            exit;

        RemainingResidual := PoolAmount - FloorSum;
        while RemainingResidual >= 0.005 do begin
            WinnerIndex := 0;
            for i := 1 to LineCount do
                if (Base[i] <> 0) and (not Awarded[i]) then
                    // AL's "or" does not short-circuit, so evaluating
                    // Remainder[WinnerIndex] in the same condition as
                    // "WinnerIndex = 0" indexes Remainder[0] on the first
                    // candidate - guard it with a nested if instead.
                    if WinnerIndex = 0 then
                        WinnerIndex := i
                    else
                        if (Remainder[i] > Remainder[WinnerIndex]) or
                           ((Remainder[i] = Remainder[WinnerIndex]) and (SalespersonCode[i] < SalespersonCode[WinnerIndex]))
                        then
                            WinnerIndex := i;
            ExpectedShare[WinnerIndex] += 0.01;
            Awarded[WinnerIndex] := true;
            RemainingResidual -= 0.01;
        end;
    end;

    [Test]
    procedure ASingleSalespersonsBaseAndShareReflectOnlyTheirOwnSales()
    var
        BaseCalculator: Codeunit "CG X146 Base Calculator";
        BonusDistributor: Codeunit "CG X146 Bonus Distributor";
        EntryNo: Integer;
    begin
        // [SCENARIO] A run with a single salesperson: their base is their
        // own sales total, and they receive the entire pool.
        ClearAllData();
        EntryNo := 0;
        SeedSalesEntry(EntryNo, 'SOLO', 120.50);
        SeedSalesEntry(EntryNo, 'SOLO', 80.25);
        SeedSalesEntry(EntryNo, 'SOLO', 45.00);

        BaseCalculator.BuildBases();
        Assert.AreEqual(245.75, GetBaseAmount('SOLO'), 'Expected a lone salesperson''s base to equal the sum of their own entries');

        BonusDistributor.DistributeBonus(500.00);
        Assert.AreEqual(500.00, GetBonusShare('SOLO'), 'Expected a lone salesperson to receive the entire pool');
    end;

    [Test]
    procedure TwoSalespeopleWithACleanlyDivisibleSplitEachGetTheirOwnExactShare()
    var
        BaseCalculator: Codeunit "CG X146 Base Calculator";
        BonusDistributor: Codeunit "CG X146 Bonus Distributor";
        EntryNo: Integer;
    begin
        // [SCENARIO] Two salespeople whose bases split the pool with no
        // leftover cent at all - this isolates whether each salesperson's
        // base reflects only their own entries, independent of how any
        // leftover cent gets placed (there isn't one here).
        ClearAllData();
        EntryNo := 0;
        SeedSalesEntry(EntryNo, 'ALICE', 180.00);
        SeedSalesEntry(EntryNo, 'ALICE', 120.00);
        SeedSalesEntry(EntryNo, 'BOBBY', 450.00);
        SeedSalesEntry(EntryNo, 'BOBBY', 250.00);

        BaseCalculator.BuildBases();
        Assert.AreEqual(300.00, GetBaseAmount('ALICE'), 'Expected ALICE''s base to reflect only her own entries, not BOBBY''s');
        Assert.AreEqual(700.00, GetBaseAmount('BOBBY'), 'Expected BOBBY''s base to reflect only his own entries, not ALICE''s');

        BonusDistributor.DistributeBonus(100.00);
        Assert.AreEqual(30.00, GetBonusShare('ALICE'), 'Expected ALICE''s share to depend only on her own recorded base');
        Assert.AreEqual(70.00, GetBonusShare('BOBBY'), 'Expected BOBBY''s share to depend only on his own recorded base');
    end;

    [Test]
    procedure InterleavedSalesEntriesStillYieldOneLinePerSalespersonWithTheirOwnTotal()
    var
        BaseCalculator: Codeunit "CG X146 Base Calculator";
        CommissionLine: Record "CG X146 Commission Line";
        EntryNo: Integer;
    begin
        // [SCENARIO] Entries for two salespeople are recorded in alternating
        // order rather than grouped together - each salesperson's base must
        // still equal only the sum of their own entries, however the
        // entries happened to be interleaved when they were recorded.
        ClearAllData();
        EntryNo := 0;
        SeedSalesEntry(EntryNo, 'INT-A', 100.00);
        SeedSalesEntry(EntryNo, 'INT-B', 40.00);
        SeedSalesEntry(EntryNo, 'INT-A', 60.00);
        SeedSalesEntry(EntryNo, 'INT-B', 25.00);

        BaseCalculator.BuildBases();

        Assert.AreEqual(160.00, GetBaseAmount('INT-A'), 'Expected a salesperson''s base to equal the sum of their own entries and nothing else');
        Assert.AreEqual(65.00, GetBaseAmount('INT-B'), 'Expected a salesperson''s base to equal the sum of their own entries and nothing else');
        CommissionLine.Reset();
        Assert.AreEqual(2, CommissionLine.Count(), 'Expected exactly one commission line per salesperson');
    end;

    [Test]
    procedure PoolSplitMatchesAlreadyRecordedBasesInProportion()
    var
        BonusDistributor: Codeunit "CG X146 Bonus Distributor";
    begin
        // [SCENARIO] Commission lines with bases already on record (no
        // rebuild involved) - the split must be exactly proportional to
        // those bases, with any leftover cents placed so every recorded
        // share stays within a cent of its exact proportional entitlement.
        ClearAllData();
        SeedCommissionLine('RX01', 161, 0);
        SeedCommissionLine('RX02', 169, 0);
        SeedCommissionLine('RX03', 308, 0);
        SeedCommissionLine('RX04', 358, 0);

        BonusDistributor.DistributeBonus(100.00);

        Assert.AreEqual(16.17, GetBonusShare('RX01'), 'Expected RX01''s share to be proportional to its recorded base');
        Assert.AreEqual(16.97, GetBonusShare('RX02'), 'Expected RX02''s share to be proportional to its recorded base');
        Assert.AreEqual(30.92, GetBonusShare('RX03'), 'Expected RX03''s share to be proportional to its recorded base');
        Assert.AreEqual(35.94, GetBonusShare('RX04'), 'Expected RX04''s share to be proportional to its recorded base');
    end;

    [Test]
    procedure MultiSalespersonSplitDependsOnlyOnEachOnesOwnRecordedSales()
    var
        BaseCalculator: Codeunit "CG X146 Base Calculator";
        BonusDistributor: Codeunit "CG X146 Bonus Distributor";
        EntryNo: Integer;
    begin
        // [SCENARIO] Four salespeople whose combined run leaves cents to
        // place. Pins the whole pipeline end to end: a base drawn from the
        // wrong entries, or a share placed on the wrong salesperson, both
        // show up here.
        ClearAllData();
        EntryNo := 0;
        SeedSalesEntry(EntryNo, 'CS01', 150.00);
        SeedSalesEntry(EntryNo, 'CS01', 70.00);
        SeedSalesEntry(EntryNo, 'CS02', 200.00);
        SeedSalesEntry(EntryNo, 'CS02', 55.00);
        SeedSalesEntry(EntryNo, 'CS03', 180.00);
        SeedSalesEntry(EntryNo, 'CS03', 90.00);
        SeedSalesEntry(EntryNo, 'CS04', 200.00);
        SeedSalesEntry(EntryNo, 'CS04', 130.00);

        BaseCalculator.BuildBases();
        Assert.AreEqual(220.00, GetBaseAmount('CS01'), 'Expected CS01''s base to equal only its own recorded entries');
        Assert.AreEqual(255.00, GetBaseAmount('CS02'), 'Expected CS02''s base to equal only its own recorded entries');
        Assert.AreEqual(270.00, GetBaseAmount('CS03'), 'Expected CS03''s base to equal only its own recorded entries');
        Assert.AreEqual(330.00, GetBaseAmount('CS04'), 'Expected CS04''s base to equal only its own recorded entries');

        BonusDistributor.DistributeBonus(100.00);
        Assert.AreEqual(20.46, GetBonusShare('CS01'), 'Expected CS01''s share to depend only on this run''s own bases');
        Assert.AreEqual(23.72, GetBonusShare('CS02'), 'Expected CS02''s share to depend only on this run''s own bases');
        Assert.AreEqual(25.12, GetBonusShare('CS03'), 'Expected CS03''s share to depend only on this run''s own bases');
        Assert.AreEqual(30.70, GetBonusShare('CS04'), 'Expected CS04''s share to depend only on this run''s own bases');
    end;

    [Test]
    procedure ASalespersonWhoseSalesNetToZeroAlwaysReceivesExactlyZero()
    var
        BaseCalculator: Codeunit "CG X146 Base Calculator";
        BonusDistributor: Codeunit "CG X146 Bonus Distributor";
        EntryNo: Integer;
    begin
        // [SCENARIO] ZFOC's sales net to nothing (a sale and a matching
        // return) while MAIN has genuine sales - ZFOC must receive exactly
        // zero even though MAIN's base is nonzero.
        ClearAllData();
        EntryNo := 0;
        SeedSalesEntry(EntryNo, 'MAIN', 300.00);
        SeedSalesEntry(EntryNo, 'MAIN', 200.00);
        SeedSalesEntry(EntryNo, 'ZFOC', 150.00);
        SeedSalesEntry(EntryNo, 'ZFOC', -150.00);

        BaseCalculator.BuildBases();
        Assert.AreEqual(500.00, GetBaseAmount('MAIN'), 'Expected MAIN''s base to equal only its own recorded entries');
        Assert.AreEqual(0.00, GetBaseAmount('ZFOC'), 'Expected a salesperson whose entries net to zero to have a zero base');

        BonusDistributor.DistributeBonus(100.00);
        Assert.AreEqual(100.00, GetBonusShare('MAIN'), 'Expected the only salesperson with a nonzero base to receive the entire pool');
        Assert.AreEqual(0.00, GetBonusShare('ZFOC'), 'Expected a salesperson with no net sales to receive exactly zero while another salesperson has sales to share');
    end;

    [Test]
    procedure RebuildingClearsAnyPriorRunsRecordedLines()
    var
        BaseCalculator: Codeunit "CG X146 Base Calculator";
        CommissionLine: Record "CG X146 Commission Line";
        EntryNo: Integer;
    begin
        // [SCENARIO] A commission line left over from an earlier run, for a
        // salesperson who has no entries in the current run, must not
        // survive a rebuild.
        ClearAllData();
        SeedCommissionLine('GHOST', 999.99, 888.88);
        EntryNo := 0;
        SeedSalesEntry(EntryNo, 'REAL1', 60.00);
        SeedSalesEntry(EntryNo, 'REAL1', 40.00);

        BaseCalculator.BuildBases();

        Assert.IsFalse(CommissionLine.Get('GHOST'), 'Expected a commission line from an earlier run to be gone after rebuilding for a run that does not include that salesperson');
        Assert.AreEqual(100.00, GetBaseAmount('REAL1'), 'Expected the current run''s own salesperson to have the correct base after rebuilding');
    end;

    [Test]
    procedure ARunWithNoSalesEntriesLeavesNothingToDistribute()
    var
        BaseCalculator: Codeunit "CG X146 Base Calculator";
        BonusDistributor: Codeunit "CG X146 Bonus Distributor";
        CommissionLine: Record "CG X146 Commission Line";
    begin
        // [SCENARIO] A run with no sales entries at all builds no
        // commission lines, and distributing a pool over none is a no-op.
        ClearAllData();

        BaseCalculator.BuildBases();
        CommissionLine.Reset();
        Assert.IsTrue(CommissionLine.IsEmpty(), 'Expected a run with no sales entries to build no commission lines');

        BonusDistributor.DistributeBonus(250.00);
        CommissionLine.Reset();
        Assert.IsTrue(CommissionLine.IsEmpty(), 'Expected distributing a pool with no commission lines to leave none behind');
    end;

    [Test]
    procedure DeterministicSweepAcrossManySalesRunsMatchesTheReferenceSplitAndSumsExactlyToThePool()
    var
        BaseCalculator: Codeunit "CG X146 Base Calculator";
        BonusDistributor: Codeunit "CG X146 Bonus Distributor";
        Any: Codeunit Any;
        SalespersonCode: array[10] of Code[20];
        ExpectedBase: array[10] of Decimal;
        ExpectedShare: array[10] of Decimal;
        SalespersonCount: Integer;
        PoolAmount: Decimal;
        EntryCount: Integer;
        EntryNo: Integer;
        EntryAmount: Decimal;
        SumOfShares: Decimal;
        Partition: Integer;
        i: Integer;
        j: Integer;
    begin
        Any.SetSeed(146);
        EntryNo := 0;

        for Partition := 1 to 8 do begin
            ClearAllData();
            SalespersonCount := Any.IntegerInRange(3, 9);
            PoolAmount := Any.IntegerInRange(500, 999999) / 100;

            for i := 1 to SalespersonCount do begin
                SalespersonCode[i] := StrSubstNo('SW%1P%2', Partition, i);
                ExpectedBase[i] := 0;
                EntryCount := Any.IntegerInRange(1, 3);
                for j := 1 to EntryCount do begin
                    EntryAmount := Any.IntegerInRange(100, 40000) / 100;
                    SeedSalesEntry(EntryNo, SalespersonCode[i], EntryAmount);
                    ExpectedBase[i] += EntryAmount;
                end;
            end;

            BaseCalculator.BuildBases();
            for i := 1 to SalespersonCount do
                Assert.AreEqual(
                  ExpectedBase[i], GetBaseAmount(SalespersonCode[i]),
                  StrSubstNo('Expected salesperson %1 of sales run %2 to have a base built only from their own entries', SalespersonCode[i], Partition));

            BonusDistributor.DistributeBonus(PoolAmount);
            ComputeExpectedShares(ExpectedBase, SalespersonCode, SalespersonCount, PoolAmount, ExpectedShare);

            SumOfShares := 0;
            for i := 1 to SalespersonCount do begin
                Assert.AreEqual(
                  ExpectedShare[i], GetBonusShare(SalespersonCode[i]),
                  StrSubstNo('Expected salesperson %1 of sales run %2 to receive a share that depends only on that run''s own bases', SalespersonCode[i], Partition));
                SumOfShares += GetBonusShare(SalespersonCode[i]);
            end;
            Assert.AreEqual(
              PoolAmount, SumOfShares,
              StrSubstNo('Expected the recorded shares of sales run %1 to sum to exactly the pool', Partition));
        end;
    end;
}
