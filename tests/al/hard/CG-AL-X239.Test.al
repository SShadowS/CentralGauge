codeunit 89461 "CG-AL-X239 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    // This oracle merges 5 independent modules' test suites into one
    // codeunit. Every test and helper procedure is prefixed with the module
    // it belongs to so identical helper names across the source suites cannot
    // collide. Assembled from already-gated donors; see NOTES.md.

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
        // The default test isolation persists writes between test methods
        // (measured, SOAP runner), so every test clears both tables before
        // seeding its own rows.
        // (measured 2026-08-20, SOAP runner), so every test clears both tables
        // before seeding its own rows.
        // The default test isolation persists writes between test methods, so
        // every test clears its own tables before seeding its own rows.

    // ==========================================================
    // X128 - donor CG-AL-X128
    // ==========================================================

    local procedure X128_GetOtherCompanyName(): Text[30]
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

    local procedure X128_ClearHomeSetup()
    var
        Setup: Record "CG X128 Collection Setup";
    begin
        Setup.DeleteAll();
    end;

    local procedure X128_ClearOtherCompanySetup(OtherName: Text[30])
    var
        Setup: Record "CG X128 Collection Setup";
    begin
        Setup.ChangeCompany(OtherName);
        Setup.DeleteAll();
    end;

    local procedure X128_ClearHomeGroupRate()
    var
        GroupRate: Record "CG X128 Group Rate";
    begin
        GroupRate.DeleteAll();
    end;

    local procedure X128_ClearOtherCompanyGroupRate(OtherName: Text[30])
    var
        GroupRate: Record "CG X128 Group Rate";
    begin
        GroupRate.ChangeCompany(OtherName);
        GroupRate.DeleteAll();
    end;

    local procedure X128_SeedOtherCompanySetup(OtherName: Text[30]; Grace: Integer; Fee: Decimal)
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

    local procedure X128_ReadOtherCompanySetup(OtherName: Text[30]; var Found: Boolean; var Grace: Integer; var Fee: Decimal)
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

    local procedure X128_ReadOtherCompanyGroupRate(OtherName: Text[30]; CurrencyCode: Code[10]; var Found: Boolean; var Rate: Decimal)
    var
        GroupRate: Record "CG X128 Group Rate";
    begin
        GroupRate.ChangeCompany(OtherName);
        Found := GroupRate.Get(CurrencyCode);
        if Found then
            Rate := GroupRate."Intercompany Rate";
    end;

    [Test]
    procedure X128_ChangingOneCompanysSettingsDoesNotOverwriteAnotherCompanysOwnSettings()
    var
        Policy: Codeunit "CG X128 Collection Policy";
        OtherName: Text[30];
        HomeGraceAfter: Integer;
        HomeFeeAfter: Decimal;
        OtherFoundAfter: Boolean;
        OtherGraceAfter: Integer;
        OtherFeeAfter: Decimal;
    begin
        OtherName := X128_GetOtherCompanyName();
        X128_ClearHomeSetup();
        X128_ClearOtherCompanySetup(OtherName);
        Commit();

        // The other company already configured its own settings.
        X128_SeedOtherCompanySetup(OtherName, 30, 2.5);

        // The home company independently configures its own settings.
        Policy.SetGracePeriodDays(45);
        Policy.SetLateFeePercent(9.9);

        HomeGraceAfter := Policy.GetGracePeriodDays();
        HomeFeeAfter := Policy.GetLateFeePercent();
        X128_ReadOtherCompanySetup(OtherName, OtherFoundAfter, OtherGraceAfter, OtherFeeAfter);

        // Clean up both companies before asserting anything, and commit that
        // cleanup, so this test never leaves data behind in the other
        // company regardless of whether the assertions below pass or fail.
        X128_ClearHomeSetup();
        X128_ClearOtherCompanySetup(OtherName);
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
    procedure X128_AnotherCompanyConfiguringItsOwnSettingsDoesNotChangeTheHomeCompanysSettings()
    var
        Policy: Codeunit "CG X128 Collection Policy";
        OtherName: Text[30];
        HomeGraceAfter: Integer;
        HomeFeeAfter: Decimal;
        OtherFoundAfter: Boolean;
        OtherGraceAfter: Integer;
        OtherFeeAfter: Decimal;
    begin
        OtherName := X128_GetOtherCompanyName();
        X128_ClearHomeSetup();
        X128_ClearOtherCompanySetup(OtherName);
        Commit();

        // The home company configures its own settings first.
        Policy.SetGracePeriodDays(21);
        Policy.SetLateFeePercent(3.3);

        // A different company now configures its own, different settings.
        X128_SeedOtherCompanySetup(OtherName, 60, 6.6);

        HomeGraceAfter := Policy.GetGracePeriodDays();
        HomeFeeAfter := Policy.GetLateFeePercent();
        X128_ReadOtherCompanySetup(OtherName, OtherFoundAfter, OtherGraceAfter, OtherFeeAfter);

        X128_ClearHomeSetup();
        X128_ClearOtherCompanySetup(OtherName);
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
    procedure X128_TheIntercompanyRateIsVisibleAndIdenticalInEveryCompany()
    var
        Treasury: Codeunit "CG X128 Treasury Rate";
        OtherName: Text[30];
        HomeRateAfter: Decimal;
        OtherFoundAfter: Boolean;
        OtherRateAfter: Decimal;
    begin
        OtherName := X128_GetOtherCompanyName();
        X128_ClearHomeGroupRate();
        X128_ClearOtherCompanyGroupRate(OtherName);
        Commit();

        // The rate is set once, from the home company, and must be the
        // same rate every company sees - it is not each company's own.
        Treasury.SetIntercompanyRate('EUR', 1.0937);

        HomeRateAfter := Treasury.GetIntercompanyRate('EUR');
        X128_ReadOtherCompanyGroupRate(OtherName, 'EUR', OtherFoundAfter, OtherRateAfter);

        X128_ClearHomeGroupRate();
        X128_ClearOtherCompanyGroupRate(OtherName);
        Commit();

        Assert.AreEqual(1.0937, HomeRateAfter,
            'Expected the home company to see the intercompany rate that was just set');
        Assert.IsTrue(OtherFoundAfter,
            'Expected the other company to see the same intercompany rate record');
        Assert.AreEqual(1.0937, OtherRateAfter,
            'Expected the other company to see the exact same intercompany rate, since it is shared across every company by design');
    end;

    [Test]
    procedure X128_SettingTheRateForOneCurrencyDoesNotAffectAnother()
    var
        Treasury: Codeunit "CG X128 Treasury Rate";
    begin
        X128_ClearHomeGroupRate();

        Treasury.SetIntercompanyRate('EUR', 1.0937);
        Treasury.SetIntercompanyRate('USD', 1.0);

        Assert.AreEqual(1.0937, Treasury.GetIntercompanyRate('EUR'),
            'Expected the EUR rate to be unaffected by setting a different currency''s rate');
        Assert.AreEqual(1.0, Treasury.GetIntercompanyRate('USD'),
            'Expected the USD rate to reflect what was just set for it');
        Assert.AreEqual(0.0, Treasury.GetIntercompanyRate('GBP'),
            'Expected no intercompany rate for a currency that was never configured');

        X128_ClearHomeGroupRate();
    end;

    [Test]
    procedure X128_SettingAndReadingBackTheGracePeriodAndLateFeeInOneCompanyWorks()
    var
        Policy: Codeunit "CG X128 Collection Policy";
        Policy2: Codeunit "CG X128 Collection Policy";
        Setup: Record "CG X128 Collection Setup";
    begin
        X128_ClearHomeSetup();

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

        X128_ClearHomeSetup();
    end;

    [Test]
    procedure X128_TheSettingsDefaultWhenNothingHasBeenConfiguredYet()
    var
        Policy: Codeunit "CG X128 Collection Policy";
    begin
        X128_ClearHomeSetup();

        Assert.AreEqual(14, Policy.GetGracePeriodDays(),
            'Expected a default grace period before anything has been configured');
        Assert.AreEqual(1.5, Policy.GetLateFeePercent(),
            'Expected a default late fee percentage before anything has been configured');

        X128_ClearHomeSetup();
    end;

    [Test]
    procedure X128_IsOverdueRespectsTheGracePeriodBoundaryExactly()
    var
        Policy: Codeunit "CG X128 Collection Policy";
    begin
        X128_ClearHomeSetup();
        Policy.SetGracePeriodDays(14);

        Assert.IsFalse(Policy.IsOverdue(14),
            'Expected an invoice exactly at the grace period boundary to not yet be overdue');
        Assert.IsTrue(Policy.IsOverdue(15),
            'Expected an invoice one day past the grace period boundary to be overdue');

        X128_ClearHomeSetup();
    end;

    [Test]
    procedure X128_CalculateLateFeeAppliesThePercentageToTheAmount()
    var
        Policy: Codeunit "CG X128 Collection Policy";
    begin
        X128_ClearHomeSetup();
        Policy.SetLateFeePercent(5);

        Assert.AreEqual(10.0, Policy.CalculateLateFee(200),
            'Expected the late fee to be the configured percentage of the overdue amount');
        Assert.AreEqual(0.0, Policy.CalculateLateFee(0),
            'Expected no late fee on a zero overdue amount');

        Policy.SetLateFeePercent(2.5);
        Assert.AreEqual(5.0, Policy.CalculateLateFee(200),
            'Expected the late fee to scale with a different configured percentage on the same overdue amount');

        X128_ClearHomeSetup();
    end;

    // ==========================================================
    // X137 - donor CG-AL-X137
    // ==========================================================

    local procedure X137_SeedImportLine(EntryNo: Integer; BatchNo: Code[20]; Amount: Integer)
    var
        ImportLine: Record "CG X137 Import Line";
    begin
        ImportLine.Init();
        ImportLine."Entry No." := EntryNo;
        ImportLine."Batch No." := BatchNo;
        ImportLine.Amount := Amount;
        ImportLine.Insert();
    end;

    local procedure X137_SeedPostedEntry(EntryNo: Integer; BatchNo: Code[20]; Amount: Integer)
    var
        PostedEntry: Record "CG X137 Posted Entry";
    begin
        PostedEntry.Init();
        PostedEntry."Entry No." := EntryNo;
        PostedEntry."Batch No." := BatchNo;
        PostedEntry.Amount := Amount;
        PostedEntry.Insert();
    end;

    local procedure X137_PostedExists(EntryNo: Integer): Boolean
    var
        PostedEntry: Record "CG X137 Posted Entry";
    begin
        exit(PostedEntry.Get(EntryNo));
    end;

    local procedure X137_PostedAmount(EntryNo: Integer): Integer
    var
        PostedEntry: Record "CG X137 Posted Entry";
    begin
        PostedEntry.Get(EntryNo);
        exit(PostedEntry.Amount);
    end;

    local procedure X137_CountPostedInBatch(BatchNo: Code[20]): Integer
    var
        PostedEntry: Record "CG X137 Posted Entry";
    begin
        PostedEntry.SetRange("Batch No.", BatchNo);
        exit(PostedEntry.Count());
    end;

    [Test]
    procedure X137_HappyPathPostsEveryGoodLine()
    var
        ImportLine: Record "CG X137 Import Line";
        PostedEntry: Record "CG X137 Posted Entry";
        Poster: Codeunit "CG X137 Batch Poster";
    begin
        ImportLine.DeleteAll();
        PostedEntry.DeleteAll();

        X137_SeedImportLine(1, 'B1', 50);
        X137_SeedImportLine(2, 'B1', 30);
        X137_SeedImportLine(3, 'B1', 20);

        Poster.PostBatch('B1');

        Assert.AreEqual(3, Poster.PostedCountLastRun(), 'All three lines in a clean batch should post.');
        Assert.AreEqual(0, Poster.SkippedCountLastRun(), 'Nothing should be skipped on a clean first run.');
        Assert.AreEqual(50, X137_PostedAmount(1), 'Line 1 amount must reach the ledger unchanged.');
        Assert.AreEqual(30, X137_PostedAmount(2), 'Line 2 amount must reach the ledger unchanged.');
        Assert.AreEqual(20, X137_PostedAmount(3), 'Line 3 amount must reach the ledger unchanged.');
    end;

    [Test]
    procedure X137_RetryAfterFixPostsEveryGoodLine()
    var
        ImportLine: Record "CG X137 Import Line";
        PostedEntry: Record "CG X137 Posted Entry";
        Poster: Codeunit "CG X137 Batch Poster";
    begin
        ImportLine.DeleteAll();
        PostedEntry.DeleteAll();

        X137_SeedImportLine(101, 'B1', 40);
        X137_SeedImportLine(102, 'B1', 25);
        X137_SeedImportLine(103, 'B1', 0); // invalid: a non-positive amount is rejected
        Commit();

        asserterror Poster.PostBatch('B1');

        ImportLine.Get(103);
        ImportLine.Amount := 15;
        ImportLine.Modify();
        Commit();

        Poster.PostBatch('B1');

        Assert.AreEqual(3, Poster.PostedCountLastRun(), 'The retry must post every line of the batch that is not yet in the ledger.');
        Assert.AreEqual(0, Poster.SkippedCountLastRun(), 'Nothing in this batch reached the ledger before the retry.');
        Assert.IsTrue(X137_PostedExists(101), 'Line 101 must reach the ledger once the batch is fixed and re-run.');
        Assert.IsTrue(X137_PostedExists(102), 'Line 102 must reach the ledger once the batch is fixed and re-run.');
        Assert.AreEqual(40, X137_PostedAmount(101), 'Line 101 must post with its original amount.');
        Assert.AreEqual(25, X137_PostedAmount(102), 'Line 102 must post with its original amount.');
        Assert.AreEqual(15, X137_PostedAmount(103), 'Line 103 must post with its corrected amount.');
        Assert.AreEqual(3, X137_CountPostedInBatch('B1'), 'The ledger must hold every line of the batch after the retry, no more and no fewer.');
    end;

    [Test]
    procedure X137_RepeatingACleanRunDoesNotDuplicate()
    var
        ImportLine: Record "CG X137 Import Line";
        PostedEntry: Record "CG X137 Posted Entry";
        Poster: Codeunit "CG X137 Batch Poster";
    begin
        ImportLine.DeleteAll();
        PostedEntry.DeleteAll();

        X137_SeedImportLine(201, 'B2', 60);
        X137_SeedImportLine(202, 'B2', 45);

        Poster.PostBatch('B2');
        Assert.AreEqual(2, Poster.PostedCountLastRun(), 'The first run should post both lines.');
        Assert.AreEqual(0, Poster.SkippedCountLastRun(), 'Nothing is posted yet before the first run.');

        Poster.PostBatch('B2');
        Assert.AreEqual(0, Poster.PostedCountLastRun(), 'Re-running an unchanged batch must not post its lines again.');
        Assert.AreEqual(2, Poster.SkippedCountLastRun(), 'Re-running an unchanged batch must report both lines as already handled.');

        Assert.AreEqual(2, X137_CountPostedInBatch('B2'), 'The ledger must still hold exactly one row per line, not duplicates.');
        Assert.AreEqual(60, X137_PostedAmount(201), 'Line 201 amount must be unaffected by the repeated run.');
        Assert.AreEqual(45, X137_PostedAmount(202), 'Line 202 amount must be unaffected by the repeated run.');
    end;

    [Test]
    procedure X137_PostingOneBatchLeavesAnotherBatchUntouched()
    var
        ImportLine: Record "CG X137 Import Line";
        PostedEntry: Record "CG X137 Posted Entry";
        Poster: Codeunit "CG X137 Batch Poster";
    begin
        ImportLine.DeleteAll();
        PostedEntry.DeleteAll();

        X137_SeedImportLine(301, 'B3', 12);
        X137_SeedImportLine(302, 'B3', 8);
        X137_SeedImportLine(401, 'B4', 99);
        X137_SeedPostedEntry(999, 'B4', 777);

        Poster.PostBatch('B3');

        Assert.AreEqual(2, Poster.PostedCountLastRun(), 'Posting one batch must post only that batch''s lines.');
        Assert.AreEqual(0, Poster.SkippedCountLastRun(), 'Nothing in this batch reached the ledger before this run.');
        Assert.AreEqual(12, X137_PostedAmount(301), 'Line 301 must post with its own amount.');
        Assert.AreEqual(8, X137_PostedAmount(302), 'Line 302 must post with its own amount.');
        Assert.IsFalse(X137_PostedExists(401), 'A line belonging to a different batch must not be posted by this run.');
        Assert.AreEqual(777, X137_PostedAmount(999), 'A previously posted line from another batch must be left untouched.');
        Assert.AreEqual(1, X137_CountPostedInBatch('B4'), 'The other batch''s ledger rows must be unaffected by posting this batch.');
    end;

    // ==========================================================
    // X140 - donor CG-AL-X140
    // ==========================================================

    local procedure X140_ClearAllData()
    var
        RebateHeader: Record "CG X140 Rebate Header";
        RebateLine: Record "CG X140 Rebate Line";
    begin
        RebateLine.DeleteAll();
        RebateHeader.DeleteAll();
    end;

    local procedure X140_SeedHeader(DocumentNo: Code[20]; TotalAmount: Decimal)
    var
        RebateHeader: Record "CG X140 Rebate Header";
    begin
        RebateHeader.Init();
        RebateHeader."No." := DocumentNo;
        RebateHeader."Rebate Description" := 'Test rebate';
        RebateHeader."Total Rebate Amount" := TotalAmount;
        RebateHeader.Insert();
    end;

    local procedure X140_SeedLine(DocumentNo: Code[20]; LineNo: Integer; ItemDescription: Text[100]; LineWeight: Decimal)
    var
        RebateLine: Record "CG X140 Rebate Line";
    begin
        RebateLine.Init();
        RebateLine."Document No." := DocumentNo;
        RebateLine."Line No." := LineNo;
        RebateLine."Item Description" := ItemDescription;
        RebateLine."Allocation Weight" := LineWeight;
        RebateLine.Insert();
    end;

    local procedure X140_SeedLineWithSentinel(DocumentNo: Code[20]; LineNo: Integer; LineWeight: Decimal; SentinelAmount: Decimal)
    var
        RebateLine: Record "CG X140 Rebate Line";
    begin
        RebateLine.Init();
        RebateLine."Document No." := DocumentNo;
        RebateLine."Line No." := LineNo;
        RebateLine."Allocation Weight" := LineWeight;
        RebateLine."Rebate Amount" := SentinelAmount;
        RebateLine.Insert();
    end;

    local procedure X140_GetLineAmount(DocumentNo: Code[20]; LineNo: Integer): Decimal
    var
        RebateLine: Record "CG X140 Rebate Line";
    begin
        RebateLine.Get(DocumentNo, LineNo);
        exit(RebateLine."Rebate Amount");
    end;

    // Independently reconstructs the allocation every correct implementation
    // must produce: floor everyone's exact proportional share to the cent,
    // then hand out whatever the floors left on the table one cent at a time
    // to the lines closest to rounding up, tie-broken by the lower line
    // number. A zero-weight line's remainder is always exactly zero, so it
    // never competes for a leftover cent. This mirrors the allocator's own
    // fix - it is the definition of "correct" this oracle grades against,
    // not a re-implementation that happens to agree with one particular
    // solution.
    local procedure X140_ComputeExpectedShares(Weight: array[10] of Decimal; LineNo: array[10] of Integer; LineCount: Integer; TotalAmount: Decimal; var ExpectedShare: array[10] of Decimal)
    var
        Remainder: array[10] of Decimal;
        Awarded: array[10] of Boolean;
        WeightSum: Decimal;
        FloorSum: Decimal;
        RemainingResidual: Decimal;
        ExactShare: Decimal;
        WinnerIndex: Integer;
        i: Integer;
    begin
        WeightSum := 0;
        for i := 1 to LineCount do
            WeightSum += Weight[i];

        FloorSum := 0;
        for i := 1 to LineCount do begin
            Awarded[i] := false;
            if (WeightSum = 0) or (Weight[i] = 0) then begin
                ExpectedShare[i] := 0;
                Remainder[i] := 0;
            end else begin
                ExactShare := TotalAmount * Weight[i] / WeightSum;
                ExpectedShare[i] := Round(ExactShare, 0.01, '<');
                Remainder[i] := ExactShare - ExpectedShare[i];
                FloorSum += ExpectedShare[i];
            end;
        end;

        if WeightSum = 0 then
            exit;

        RemainingResidual := TotalAmount - FloorSum;
        while RemainingResidual >= 0.005 do begin
            WinnerIndex := 0;
            for i := 1 to LineCount do
                if (Weight[i] <> 0) and (not Awarded[i]) then
                    // AL's "or" does not short-circuit, so evaluating
                    // Remainder[WinnerIndex] in the same condition as
                    // "WinnerIndex = 0" indexes Remainder[0] on the first
                    // candidate - guard it with a nested if instead.
                    if WinnerIndex = 0 then
                        WinnerIndex := i
                    else
                        if (Remainder[i] > Remainder[WinnerIndex]) or
                           ((Remainder[i] = Remainder[WinnerIndex]) and (LineNo[i] < LineNo[WinnerIndex]))
                        then
                            WinnerIndex := i;
            ExpectedShare[WinnerIndex] += 0.01;
            Awarded[WinnerIndex] := true;
            RemainingResidual -= 0.01;
        end;
    end;

    [Test]
    procedure X140_SingleNonzeroWeightLineGetsTheEntireTotal()
    var
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        X140_ClearAllData();
        X140_SeedHeader('SL01', 123.45);
        X140_SeedLine('SL01', 1, 'Widget', 7.5);

        Allocator.AllocateRebate('SL01');

        Assert.AreEqual(123.45, X140_GetLineAmount('SL01', 1), 'Expected a document with a single line to allocate its entire total to that line');
    end;

    [Test]
    procedure X140_TwoEvenlyWeightedLinesSplitCleanlyAndLeaveAnotherDocumentUntouched()
    var
        RebateHeader: Record "CG X140 Rebate Header";
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        X140_ClearAllData();
        X140_SeedHeader('EV01', 10.00);
        X140_SeedLine('EV01', 1, 'Widget A', 1);
        X140_SeedLine('EV01', 2, 'Widget B', 1);

        // A second, unrelated document is seeded with its own nonzero
        // sentinel amounts and left alone - allocating EV01 must not
        // touch it.
        X140_SeedHeader('EV02', 250.00);
        X140_SeedLineWithSentinel('EV02', 1, 1, 111.11);
        X140_SeedLineWithSentinel('EV02', 2, 1, 222.22);

        Allocator.AllocateRebate('EV01');

        Assert.AreEqual(5.00, X140_GetLineAmount('EV01', 1), 'Expected an even two-line split to allocate exactly half the total to each line');
        Assert.AreEqual(5.00, X140_GetLineAmount('EV01', 2), 'Expected an even two-line split to allocate exactly half the total to each line');
        Assert.AreEqual(10.00, Allocator.GetAllocatedTotal('EV01'), 'Expected the reconciliation total to equal the header total after allocating');

        RebateHeader.Get('EV02');
        Assert.IsFalse(RebateHeader.Allocated, 'Expected an untouched document to stay unallocated');
        Assert.AreEqual(111.11, X140_GetLineAmount('EV02', 1), 'Expected another document''s line amount to be left untouched by allocating a different document');
        Assert.AreEqual(222.22, X140_GetLineAmount('EV02', 2), 'Expected another document''s line amount to be left untouched by allocating a different document');
        // EV02's own lines (333.33) do not reconcile with its own header
        // total (250.00) by design - it was never allocated. Pinning the
        // reconciliation total against the lines' own sum here, not the
        // header total, catches a GetAllocatedTotal that just echoes the
        // header field instead of actually reading the lines.
        Assert.AreEqual(333.33, Allocator.GetAllocatedTotal('EV02'), 'Expected the reconciliation total to reflect the document''s own recorded line amounts');
    end;

    [Test]
    procedure X140_AZeroWeightLineAlwaysReceivesExactlyZero()
    var
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        // Weights chosen so every nonzero-weight line's exact share has a
        // distinct rounding remainder (no ties), so this fixture pins an
        // outcome that does not depend on any particular tie-break policy.
        X140_ClearAllData();
        X140_SeedHeader('ZL01', 77.77);
        X140_SeedLine('ZL01', 1, 'Item P', 2.3);
        X140_SeedLine('ZL01', 2, 'Item Q', 5.7);
        X140_SeedLine('ZL01', 3, 'Item R', 3.1);
        X140_SeedLine('ZL01', 4, 'Item S', 1.9);
        X140_SeedLine('ZL01', 5, 'Sample T (FOC)', 0);

        Allocator.AllocateRebate('ZL01');

        Assert.AreEqual(13.76, X140_GetLineAmount('ZL01', 1), 'Expected a weighted line''s allocated amount to depend only on the document''s weights and total');
        Assert.AreEqual(34.10, X140_GetLineAmount('ZL01', 2), 'Expected a weighted line''s allocated amount to depend only on the document''s weights and total');
        Assert.AreEqual(18.54, X140_GetLineAmount('ZL01', 3), 'Expected a weighted line''s allocated amount to depend only on the document''s weights and total');
        Assert.AreEqual(11.37, X140_GetLineAmount('ZL01', 4), 'Expected a weighted line''s allocated amount to depend only on the document''s weights and total');
        Assert.AreEqual(0.00, X140_GetLineAmount('ZL01', 5), 'Expected a line with no allocation weight to receive exactly zero');
        Assert.AreEqual(77.77, Allocator.GetAllocatedTotal('ZL01'), 'Expected the recorded amounts to sum to exactly the document total');
    end;

    [Test]
    procedure X140_ReorderingTheSameLinesNeverChangesTheirRebateAmount()
    var
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        X140_ClearAllData();

        // Document PM01: lines entered P, Q, R, S.
        X140_SeedHeader('PM01', 77.77);
        X140_SeedLine('PM01', 1, 'Item P', 2.3);
        X140_SeedLine('PM01', 2, 'Item Q', 5.7);
        X140_SeedLine('PM01', 3, 'Item R', 3.1);
        X140_SeedLine('PM01', 4, 'Item S', 1.9);

        // Document PM02: the exact same four items, same weights, same
        // total - only Item R and Item S swap which line number they
        // were entered on.
        X140_SeedHeader('PM02', 77.77);
        X140_SeedLine('PM02', 1, 'Item P', 2.3);
        X140_SeedLine('PM02', 2, 'Item Q', 5.7);
        X140_SeedLine('PM02', 3, 'Item S', 1.9);
        X140_SeedLine('PM02', 4, 'Item R', 3.1);

        Allocator.AllocateRebate('PM01');
        Allocator.AllocateRebate('PM02');

        // Item P and Item Q are entered in the same position on both
        // documents, so their assertions alone already pin an unambiguous
        // per-item split for this set of weights and total.
        Assert.AreEqual(13.76, X140_GetLineAmount('PM01', 1), 'Expected Item P''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(34.10, X140_GetLineAmount('PM01', 2), 'Expected Item Q''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(18.54, X140_GetLineAmount('PM01', 3), 'Expected Item R''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(11.37, X140_GetLineAmount('PM01', 4), 'Expected Item S''s allocated amount to depend only on the document''s weights and total, never on line order');

        Assert.AreEqual(13.76, X140_GetLineAmount('PM02', 1), 'Expected Item P''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(34.10, X140_GetLineAmount('PM02', 2), 'Expected Item Q''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(11.37, X140_GetLineAmount('PM02', 3), 'Expected Item S''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(18.54, X140_GetLineAmount('PM02', 4), 'Expected Item R''s allocated amount to depend only on the document''s weights and total, never on line order');

        // Item R and Item S get the same amount no matter which line
        // number they were entered on - the split must not depend on the
        // order the lines were imported in.
        Assert.AreEqual(X140_GetLineAmount('PM01', 3), X140_GetLineAmount('PM02', 4), 'Expected Item R to receive the same rebate amount whichever line number it was entered on');
        Assert.AreEqual(X140_GetLineAmount('PM01', 4), X140_GetLineAmount('PM02', 3), 'Expected Item S to receive the same rebate amount whichever line number it was entered on');

        Assert.AreEqual(77.77, Allocator.GetAllocatedTotal('PM01'), 'Expected the recorded amounts to sum to exactly the document total');
        Assert.AreEqual(77.77, Allocator.GetAllocatedTotal('PM02'), 'Expected the recorded amounts to sum to exactly the document total');
    end;

    [Test]
    procedure X140_ALineWithNoWeightAtAllOnTheWholeDocumentIsLeftUnallocated()
    var
        RebateHeader: Record "CG X140 Rebate Header";
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        X140_ClearAllData();
        X140_SeedHeader('NW01', 50.00);
        X140_SeedLineWithSentinel('NW01', 1, 0, 555.55);
        X140_SeedLineWithSentinel('NW01', 2, 0, 444.44);

        Allocator.AllocateRebate('NW01');

        RebateHeader.Get('NW01');
        Assert.IsFalse(RebateHeader.Allocated, 'Expected a document with no weight on any line to be left unallocated');
        Assert.AreEqual(555.55, X140_GetLineAmount('NW01', 1), 'Expected a line''s existing amount to be left untouched when the document has no weight to allocate');
        Assert.AreEqual(444.44, X140_GetLineAmount('NW01', 2), 'Expected a line''s existing amount to be left untouched when the document has no weight to allocate');
    end;

    [Test]
    procedure X140_SuccessfulAllocationMarksTheDocumentAllocated()
    var
        RebateHeader: Record "CG X140 Rebate Header";
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        X140_ClearAllData();
        X140_SeedHeader('MK01', 40.00);
        X140_SeedLine('MK01', 1, 'Widget A', 1);
        X140_SeedLine('MK01', 2, 'Widget B', 1);

        Allocator.AllocateRebate('MK01');

        RebateHeader.Get('MK01');
        Assert.IsTrue(RebateHeader.Allocated, 'Expected a document with at least one weighted line to be marked allocated');
    end;

    [Test]
    procedure X140_DeterministicSweepMatchesTheReferenceAllocationAcrossManyPartitions()
    var
        Allocator: Codeunit "CG X140 Rebate Allocator";
        Any: Codeunit Any;
        LineNo: array[10] of Integer;
        Weight: array[10] of Decimal;
        ExpectedShare: array[10] of Decimal;
        DocumentNo: Code[20];
        TotalAmount: Decimal;
        SumOfAmounts: Decimal;
        LineCount: Integer;
        Partition: Integer;
        i: Integer;
    begin
        Any.SetSeed(140);

        for Partition := 1 to 8 do begin
            X140_ClearAllData();
            DocumentNo := 'SW' + Format(Partition);
            LineCount := Any.IntegerInRange(3, 9);
            TotalAmount := Any.IntegerInRange(100, 99999) / 100;
            X140_SeedHeader(DocumentNo, TotalAmount);

            for i := 1 to LineCount do begin
                LineNo[i] := i;
                // Roughly every fourth line on a sweep partition is a
                // free-of-charge sample carrying no allocation weight.
                if i mod 4 = 0 then
                    Weight[i] := 0
                else
                    Weight[i] := Any.DecimalInRange(1, 500, 3);
                X140_SeedLine(DocumentNo, i, StrSubstNo('Sweep line %1', i), Weight[i]);
            end;

            Allocator.AllocateRebate(DocumentNo);
            X140_ComputeExpectedShares(Weight, LineNo, LineCount, TotalAmount, ExpectedShare);

            SumOfAmounts := 0;
            for i := 1 to LineCount do begin
                Assert.AreEqual(
                  ExpectedShare[i], X140_GetLineAmount(DocumentNo, LineNo[i]),
                  StrSubstNo('Expected line %1 of sweep partition %2 to depend only on that document''s own weights and total', LineNo[i], Partition));
                SumOfAmounts += X140_GetLineAmount(DocumentNo, LineNo[i]);
            end;
            Assert.AreEqual(
              TotalAmount, SumOfAmounts,
              StrSubstNo('Expected the recorded amounts on sweep partition %1 to sum to exactly its total', Partition));
        end;
    end;

    // ==========================================================
    // X147 - donor CG-AL-X147
    // ==========================================================

    local procedure X147_ClearAll()
    var
        AttrDefault: Record "CG X147 Attribute Default";
        AssignmentEntry: Record "CG X147 Assignment Entry";
    begin
        AttrDefault.DeleteAll();
        AssignmentEntry.DeleteAll();
    end;

    local procedure X147_SeedEntityValue(EntityType: Enum "CG X147 Entity Type"; EntityNo: Code[20]; AttributeCode: Code[20]; NewValue: Code[20])
    var
        Resolver: Codeunit "CG X147 Attribute Resolver";
    begin
        Resolver.SetEntityValue(EntityType, EntityNo, AttributeCode, NewValue);
    end;

    local procedure X147_SeedTypeValue(EntityType: Enum "CG X147 Entity Type"; AttributeCode: Code[20]; NewValue: Code[20])
    var
        Resolver: Codeunit "CG X147 Attribute Resolver";
    begin
        Resolver.SetTypeValue(EntityType, AttributeCode, NewValue);
    end;

    local procedure X147_AssertResolvesTo(EntityType: Enum "CG X147 Entity Type"; EntityNo: Code[20]; AttributeCode: Code[20]; ExpectedValue: Code[20]; MessagePrefix: Text)
    var
        Resolver: Codeunit "CG X147 Attribute Resolver";
        Poster: Codeunit "CG X147 Assignment Poster";
        AssignmentEntry: Record "CG X147 Assignment Entry";
    begin
        Assert.AreEqual(ExpectedValue, Resolver.ResolveValue(EntityType, EntityNo, AttributeCode), MessagePrefix + ' - resolved value');

        Poster.PostAssignment(EntityType, EntityNo, AttributeCode);

        AssignmentEntry.SetRange("Entity Type", EntityType);
        AssignmentEntry.SetRange("Entity No.", EntityNo);
        AssignmentEntry.SetRange("Attribute Code", AttributeCode);
        Assert.IsTrue(AssignmentEntry.FindFirst(), MessagePrefix + ' - assignment recorded');
        Assert.AreEqual(ExpectedValue, AssignmentEntry."Resolved Value", MessagePrefix + ' - assignment value');
    end;

    local procedure X147_AssertResolvesToNothing(EntityType: Enum "CG X147 Entity Type"; EntityNo: Code[20]; AttributeCode: Code[20]; MessagePrefix: Text)
    var
        Resolver: Codeunit "CG X147 Attribute Resolver";
        Poster: Codeunit "CG X147 Assignment Poster";
        AssignmentEntry: Record "CG X147 Assignment Entry";
    begin
        Assert.AreEqual('', Resolver.ResolveValue(EntityType, EntityNo, AttributeCode), MessagePrefix + ' - resolved value');

        Poster.PostAssignment(EntityType, EntityNo, AttributeCode);

        AssignmentEntry.SetRange("Entity Type", EntityType);
        AssignmentEntry.SetRange("Entity No.", EntityNo);
        AssignmentEntry.SetRange("Attribute Code", AttributeCode);
        Assert.IsFalse(AssignmentEntry.FindFirst(), MessagePrefix + ' - no assignment recorded');
    end;

    [Test]
    procedure X147_EntityWithItsOwnValueResolvesToIt()
    begin
        X147_ClearAll();
        X147_SeedEntityValue("CG X147 Entity Type"::Customer, 'CUST1', 'TIER', 'GOLD');

        X147_AssertResolvesTo("CG X147 Entity Type"::Customer, 'CUST1', 'TIER', 'GOLD', 'An entity with its own value for an attribute resolves to it');
    end;

    [Test]
    procedure X147_SettingAnEntitysValueAgainLeavesTheNewValueInForce()
    begin
        X147_ClearAll();
        X147_SeedEntityValue("CG X147 Entity Type"::Customer, 'CUST8', 'TIER', 'GOLD');
        X147_SeedEntityValue("CG X147 Entity Type"::Customer, 'CUST8', 'TIER', 'SILVER');

        X147_AssertResolvesTo("CG X147 Entity Type"::Customer, 'CUST8', 'TIER', 'SILVER', 'An entity whose own value is set a second time resolves to the newer value');
    end;

    [Test]
    procedure X147_EntityRelyingOnTheStandardValueForItsTypeResolvesToIt()
    begin
        X147_ClearAll();
        X147_SeedTypeValue("CG X147 Entity Type"::Customer, 'TIER', 'STANDARD');

        X147_AssertResolvesTo("CG X147 Entity Type"::Customer, 'CUST2', 'TIER', 'STANDARD', 'An entity with no value of its own resolves to the standard value set for its type');
    end;

    [Test]
    procedure X147_EntityWithItsOwnValueIsUnaffectedByItsTypesStandardValue()
    begin
        X147_ClearAll();
        X147_SeedTypeValue("CG X147 Entity Type"::Customer, 'TIER', 'STANDARD');
        X147_SeedEntityValue("CG X147 Entity Type"::Customer, 'CUST3', 'TIER', 'PLATINUM');

        X147_AssertResolvesTo("CG X147 Entity Type"::Customer, 'CUST3', 'TIER', 'PLATINUM', 'An entity with its own value resolves to it even when a standard value exists for its type');
    end;

    [Test]
    procedure X147_EntityWithNeitherItsOwnNorAStandardValueResolvesToNothing()
    begin
        X147_ClearAll();

        X147_AssertResolvesToNothing("CG X147 Entity Type"::Customer, 'CUST4', 'TIER', 'An entity with no value of its own and no standard value for its type resolves to nothing');
    end;

    [Test]
    procedure X147_EntityDoesNotInheritAnotherTypesStandardValue()
    begin
        X147_ClearAll();
        X147_SeedTypeValue("CG X147 Entity Type"::Customer, 'TIER', 'STANDARD-C');

        X147_AssertResolvesToNothing("CG X147 Entity Type"::Vendor, 'VEND1', 'TIER', 'An entity does not resolve to a standard value set for a different entity type');
    end;

    [Test]
    procedure X147_TwoAttributesOnTheSameTypeResolveIndependently()
    begin
        X147_ClearAll();
        X147_SeedTypeValue("CG X147 Entity Type"::Customer, 'TIER', 'STANDARD-TIER');
        X147_SeedTypeValue("CG X147 Entity Type"::Customer, 'REGION', 'STANDARD-REGION');

        X147_AssertResolvesTo("CG X147 Entity Type"::Customer, 'CUST5', 'TIER', 'STANDARD-TIER', 'An entity resolves the standard value for one attribute');
        X147_AssertResolvesTo("CG X147 Entity Type"::Customer, 'CUST5', 'REGION', 'STANDARD-REGION', 'An entity resolves the standard value for a different attribute independently');
    end;

    [Test]
    procedure X147_SeveralEntitiesEachResolveTheirOwnCase()
    var
        AttrDefault: Record "CG X147 Attribute Default";
    begin
        X147_ClearAll();
        X147_SeedEntityValue("CG X147 Entity Type"::Customer, 'SENTINEL', 'TIER', 'SENT-VAL');
        X147_SeedTypeValue("CG X147 Entity Type"::Customer, 'TIER', 'STANDARD-C');
        X147_SeedEntityValue("CG X147 Entity Type"::Customer, 'CUST6', 'TIER', 'OVERRIDE-C');
        X147_SeedTypeValue("CG X147 Entity Type"::Vendor, 'TIER', 'STANDARD-V');

        X147_AssertResolvesTo("CG X147 Entity Type"::Customer, 'CUST7', 'TIER', 'STANDARD-C', 'A customer with no value of its own resolves to its type''s standard value');
        X147_AssertResolvesTo("CG X147 Entity Type"::Customer, 'CUST6', 'TIER', 'OVERRIDE-C', 'A customer with its own value resolves to it, not to its type''s standard value');
        X147_AssertResolvesTo("CG X147 Entity Type"::Vendor, 'VEND2', 'TIER', 'STANDARD-V', 'A vendor with no value of its own resolves to its own type''s standard value, not the customer''s');

        Assert.IsTrue(AttrDefault.Get("CG X147 Entity Type"::Customer, 'SENTINEL', 'TIER'), 'An unrelated entity''s own value must survive');
        Assert.AreEqual('SENT-VAL', AttrDefault.Value, 'An unrelated entity''s own value must be unchanged');
    end;

    // ==========================================================
    // X157 - donor CG-AL-X157
    // ==========================================================

    local procedure X157_ClearAll()
    var
        CostCenter: Record "CG X157 Cost Center";
        CostEntry: Record "CG X157 Cost Entry";
        StatementLine: Record "CG X157 Statement Line";
    begin
        CostCenter.DeleteAll();
        CostEntry.DeleteAll();
        StatementLine.DeleteAll();
    end;

    local procedure X157_SeedCostCenter(CostCenterCode: Code[20])
    var
        CostCenter: Record "CG X157 Cost Center";
    begin
        CostCenter.Init();
        CostCenter."Code" := CostCenterCode;
        CostCenter.Insert();
    end;

    local procedure X157_SeedEntry(CostCenterCode: Code[20]; PostingDate: Date; Amount: Decimal)
    var
        CostEntry: Record "CG X157 Cost Entry";
    begin
        CostEntry.Init();
        CostEntry."Cost Center Code" := CostCenterCode;
        CostEntry."Posting Date" := PostingDate;
        CostEntry.Amount := Amount;
        CostEntry.Insert();
    end;

    local procedure X157_AssertStatementLine(CostCenterCode: Code[20]; PeriodStart: Date; ExpectedAmount: Decimal; MessagePrefix: Text)
    var
        StatementLine: Record "CG X157 Statement Line";
    begin
        Assert.IsTrue(StatementLine.Get(CostCenterCode, PeriodStart), MessagePrefix + ' - statement row exists');
        Assert.AreEqual(ExpectedAmount, StatementLine.Amount, MessagePrefix + ' - statement row amount');
    end;

    [Test]
    procedure X157_SinglePeriodWindowMatchingAllActivityReportsTheFullTotal()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260120D, 50);

        Result := Statement.GetPeriodAmount('CC1', 20260101D, 20260131D);

        Assert.AreEqual(150, Result, 'A window that covers a cost center''s only activity reports that activity''s full total');
    end;

    [Test]
    procedure X157_BuildStatementForOneCostCenterLeavesAnothersRowsAlone()
    var
        Statement: Codeunit "CG X157 Period Statement";
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedCostCenter('CC2');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC2', 20260115D, 70);

        Statement.BuildStatement('CC1', 20260101D, 20260131D);
        Statement.BuildStatement('CC2', 20260101D, 20260131D);

        X157_AssertStatementLine('CC1', 20260101D, 100, 'Another cost center''s statement rows must survive building this one''s');
        X157_AssertStatementLine('CC2', 20260101D, 70, 'The freshly built cost center''s own row must carry its own amount');
    end;

    [Test]
    procedure X157_StatementSpanningYearEndCarriesEachMonthsOwnFigure()
    var
        Statement: Codeunit "CG X157 Period Statement";
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20261210D, 90);
        X157_SeedEntry('CC1', 20270115D, 35);

        Statement.BuildStatement('CC1', 20261201D, 20270131D);

        X157_AssertStatementLine('CC1', 20261201D, 90, 'The December period of a statement spanning year end carries December''s own figure');
        X157_AssertStatementLine('CC1', 20270101D, 35, 'The January period of a statement spanning year end carries January''s own figure');
    end;

    [Test]
    procedure X157_MidYearWindowReportsOnlyThatMonthsActivity()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260120D, 50);
        X157_SeedEntry('CC1', 20260205D, 30);
        X157_SeedEntry('CC1', 20260225D, 70);
        X157_SeedEntry('CC1', 20260315D, 40);

        Result := Statement.GetPeriodAmount('CC1', 20260201D, 20260228D);

        Assert.AreEqual(100, Result, 'A mid-year window must report only that window''s own activity, not the cost center''s entire history');
    end;

    [Test]
    procedure X157_NonAlignedWindowReportsOnlyActivityWithinItsExactDates()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260120D, 50);
        X157_SeedEntry('CC1', 20260205D, 30);
        X157_SeedEntry('CC1', 20260225D, 70);
        X157_SeedEntry('CC1', 20260315D, 40);

        Result := Statement.GetPeriodAmount('CC1', 20260115D, 20260215D);

        Assert.AreEqual(80, Result, 'A window that does not line up with calendar month boundaries must still report only the activity that actually falls within it');
    end;

    [Test]
    procedure X157_StatementRowsCarryEachPeriodsOwnFigure()
    var
        Statement: Codeunit "CG X157 Period Statement";
        StatementLine: Record "CG X157 Statement Line";
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260120D, 50);
        X157_SeedEntry('CC1', 20260205D, 30);
        X157_SeedEntry('CC1', 20260225D, 70);
        X157_SeedEntry('CC1', 20260315D, 40);

        Statement.BuildStatement('CC1', 20260101D, 20260331D);

        StatementLine.SetRange("Cost Center Code", 'CC1');
        Assert.AreEqual(3, StatementLine.Count(), 'A statement spanning three calendar months produces exactly three rows');
        X157_AssertStatementLine('CC1', 20260101D, 150, 'The first month''s row');
        X157_AssertStatementLine('CC1', 20260201D, 100, 'The second month''s row');
        X157_AssertStatementLine('CC1', 20260301D, 40, 'The third month''s row');
    end;

    [Test]
    procedure X157_WindowWithNoActivityReportsZero()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260205D, 30);
        X157_SeedEntry('CC1', 20260315D, 40);

        Result := Statement.GetPeriodAmount('CC1', 20260401D, 20260430D);

        Assert.AreEqual(0, Result, 'A window with no activity in it must report zero, even though the cost center has activity elsewhere');
    end;

    [Test]
    procedure X157_AnotherCostCentersActivityDoesNotAffectThisOnesFigure()
    var
        Statement: Codeunit "CG X157 Period Statement";
        ResultCC1: Decimal;
        ResultCC2: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedCostCenter('CC2');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC2', 20260110D, 9999);

        ResultCC1 := Statement.GetPeriodAmount('CC1', 20260101D, 20260131D);
        ResultCC2 := Statement.GetPeriodAmount('CC2', 20260101D, 20260131D);

        Assert.AreEqual(100, ResultCC1, 'A cost center''s own figure must not include another cost center''s activity');
        Assert.AreEqual(9999, ResultCC2, 'The other cost center''s own figure must be unaffected by resolving the first one''s figure');
    end;

    [Test]
    procedure X157_ActivityOnTheWindowsFirstAndLastDayIsIncluded()
    var
        Statement: Codeunit "CG X157 Period Statement";
        Result: Decimal;
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20251231D, 20);
        X157_SeedEntry('CC1', 20260101D, 100);
        X157_SeedEntry('CC1', 20260131D, 50);
        X157_SeedEntry('CC1', 20260201D, 30);

        Result := Statement.GetPeriodAmount('CC1', 20260101D, 20260131D);

        Assert.AreEqual(150, Result, 'Activity dated exactly on either edge of the window must be included, and activity just outside either edge must be excluded');
    end;

    [Test]
    procedure X157_RebuildingAStatementReplacesThePreviousRows()
    var
        Statement: Codeunit "CG X157 Period Statement";
        StatementLine: Record "CG X157 Statement Line";
    begin
        X157_ClearAll();
        X157_SeedCostCenter('CC1');
        X157_SeedEntry('CC1', 20260110D, 100);
        X157_SeedEntry('CC1', 20260120D, 50);
        X157_SeedEntry('CC1', 20260205D, 30);
        X157_SeedEntry('CC1', 20260225D, 70);
        X157_SeedEntry('CC1', 20260315D, 40);

        Statement.BuildStatement('CC1', 20260101D, 20260331D);
        Statement.BuildStatement('CC1', 20260201D, 20260228D);

        StatementLine.SetRange("Cost Center Code", 'CC1');
        Assert.AreEqual(1, StatementLine.Count(), 'Rebuilding a statement for a narrower window must replace the previous rows, not add to them');
        Assert.IsFalse(StatementLine.Get('CC1', 20260101D), 'A row from the earlier, wider statement must not survive a rebuild');
        Assert.IsFalse(StatementLine.Get('CC1', 20260301D), 'A row from the earlier, wider statement must not survive a rebuild');
        X157_AssertStatementLine('CC1', 20260201D, 100, 'The rebuilt statement''s only row');
    end;
}
