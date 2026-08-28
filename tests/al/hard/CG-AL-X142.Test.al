codeunit 89362 "CG-AL-X142 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // === Shared helpers: rebate allocation module (CG X140) ===

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every test clears both tables
    // before seeding its own rows. Renamed from the donor's ClearAllData to
    // avoid colliding with the ledger module's own helper of the same name.
    local procedure ClearX140Data()
    var
        RebateHeader: Record "CG X140 Rebate Header";
        RebateLine: Record "CG X140 Rebate Line";
    begin
        RebateLine.DeleteAll();
        RebateHeader.DeleteAll();
    end;

    local procedure SeedHeader(DocumentNo: Code[20]; TotalAmount: Decimal)
    var
        RebateHeader: Record "CG X140 Rebate Header";
    begin
        RebateHeader.Init();
        RebateHeader."No." := DocumentNo;
        RebateHeader."Rebate Description" := 'Test rebate';
        RebateHeader."Total Rebate Amount" := TotalAmount;
        RebateHeader.Insert();
    end;

    local procedure SeedLine(DocumentNo: Code[20]; LineNo: Integer; ItemDescription: Text[100]; LineWeight: Decimal)
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

    local procedure SeedLineWithSentinel(DocumentNo: Code[20]; LineNo: Integer; LineWeight: Decimal; SentinelAmount: Decimal)
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

    local procedure GetLineAmount(DocumentNo: Code[20]; LineNo: Integer): Decimal
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
    local procedure ComputeExpectedShares(Weight: array[10] of Decimal; LineNo: array[10] of Integer; LineCount: Integer; TotalAmount: Decimal; var ExpectedShare: array[10] of Decimal)
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

    // === Shared helpers: ledger module (CG X118) ===

    // Renamed from the donor's ClearAllData to avoid colliding with the
    // rebate allocation module's own helper of the same name.
    local procedure ClearX118Data()
    var
        JournalLine: Record "CG X118 Journal Line";
        Account: Record "CG X118 Account";
        Currency: Record "CG X118 Currency";
    begin
        JournalLine.DeleteAll();
        Account.DeleteAll();
        Currency.DeleteAll();
    end;

    local procedure SeedCurrency(CurrencyCode: Code[10]; RoundingPrecision: Decimal)
    var
        Currency: Record "CG X118 Currency";
    begin
        Currency.Init();
        Currency."Code" := CurrencyCode;
        Currency."Rounding Precision" := RoundingPrecision;
        Currency.Insert();
    end;

    local procedure SeedAccount(AccountNo: Code[20]; CurrencyCode: Code[10])
    var
        Account: Record "CG X118 Account";
    begin
        Account.Init();
        Account."No." := AccountNo;
        Account."Currency Code" := CurrencyCode;
        Account.Insert();
    end;

    local procedure CreateLine(var JournalLine: Record "CG X118 Journal Line"; EntryNo: Integer; AccountNo: Code[20])
    begin
        JournalLine.Init();
        JournalLine."Entry No." := EntryNo;
        JournalLine.Insert(true);
        JournalLine.Validate("Account No.", AccountNo);
        JournalLine.Modify(true);
    end;

    local procedure SetAmountThenCounterAccount(var JournalLine: Record "CG X118 Journal Line"; AmountValue: Decimal; CounterAccountNo: Code[20])
    begin
        JournalLine.Validate(Amount, AmountValue);
        JournalLine.Validate("Counter Account No.", CounterAccountNo);
        JournalLine.Modify(true);
    end;

    // Re-reads the entry from the table and checks all three facts a
    // balanced entry must satisfy: the recorded amount is exactly what was
    // entered (never itself adjusted), the balancing amount is its exact
    // opposite, and the two therefore net to exactly zero - so a rewrite
    // that "balances" by adjusting Amount instead of Balancing Amount, or
    // by zeroing both, cannot pass alongside a genuine fix. Also reused
    // below by the settlement module's own tests, since a settled ledger
    // entry is the same record shape whichever module wrote it.
    local procedure AssertBalances(EntryNo: Integer; ExpectedAmount: Decimal)
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        JournalLine.Get(EntryNo);
        Assert.AreEqual(
          ExpectedAmount, JournalLine.Amount,
          StrSubstNo('Expected journal entry %1 to keep its recorded amount unchanged', EntryNo));
        Assert.AreEqual(
          -ExpectedAmount, JournalLine."Balancing Amount",
          StrSubstNo('Expected journal entry %1''s balancing amount to be the exact opposite of its amount', EntryNo));
        Assert.AreEqual(
          0.0, JournalLine.Amount + JournalLine."Balancing Amount",
          StrSubstNo('Expected journal entry %1''s amount and balancing amount to net to exactly zero', EntryNo));
    end;

    // Confirms a settled ledger entry recorded the account pair it was
    // booked with - a settlement rewrite that never validates "Account No."
    // at all would otherwise leave every booked entry with the field blank,
    // and AssertBalances alone would not notice since it only checks Amount
    // and Balancing Amount.
    local procedure AssertLedgerAccounts(EntryNo: Integer; ExpectedAccountNo: Code[20]; ExpectedCounterAccountNo: Code[20])
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        JournalLine.Get(EntryNo);
        Assert.AreEqual(
          ExpectedAccountNo, JournalLine."Account No.",
          StrSubstNo('Expected ledger entry %1 to record the account it was booked to', EntryNo));
        Assert.AreEqual(
          ExpectedCounterAccountNo, JournalLine."Counter Account No.",
          StrSubstNo('Expected ledger entry %1 to record the counter account it was booked against', EntryNo));
    end;

    // === Shared helpers: project labor-hours module (CG X123) ===

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

    // === Shared helpers: royalty statement module (CG X078) ===

    local procedure SeedPerformance(EntryNo: Integer; AgreementNo: Code[20]; PlayName: Text[50]; Category: Code[20]; Audience: Integer)
    var
        Performance: Record "CG X078 Performance";
    begin
        Performance.Init();
        Performance."Entry No." := EntryNo;
        Performance."Agreement No." := AgreementNo;
        Performance."Play Name" := PlayName;
        Performance.Category := Category;
        Performance.Audience := Audience;
        Performance.Insert();
    end;

    local procedure VerifyLine(var StatementLine: Record "CG X078 Statement Line" temporary; LineNo: Integer; PlayName: Text[50]; Category: Code[20]; Audience: Integer; Amount: Decimal; Credits: Integer)
    begin
        Assert.IsTrue(StatementLine.Get(LineNo), StrSubstNo('Expected the statement to contain line %1', LineNo));
        Assert.AreEqual(PlayName, StatementLine."Play Name", StrSubstNo('Expected the play name copied onto line %1', LineNo));
        Assert.AreEqual(Category, StatementLine.Category, StrSubstNo('Expected the category copied onto line %1', LineNo));
        Assert.AreEqual(Audience, StatementLine.Audience, StrSubstNo('Expected the audience copied onto line %1', LineNo));
        Assert.AreEqual(Amount, StatementLine.Amount, StrSubstNo('Expected the fee for line %1 (%2, audience %3)', LineNo, Category, Audience));
        Assert.AreEqual(Credits, StatementLine.Credits, StrSubstNo('Expected the loyalty credits for line %1 (%2, audience %3)', LineNo, Category, Audience));
    end;

    local procedure IndependentAmount(Category: Code[20]; Audience: Integer): Decimal
    begin
        if Category = 'TRAGEDY' then begin
            if Audience > 30 then
                exit(400.0 + 10 * (Audience - 30));
            exit(400.0);
        end;
        if Audience > 20 then
            exit(300.0 + 3 * Audience + 100 + 5 * (Audience - 20));
        exit(300.0 + 3 * Audience);
    end;

    local procedure IndependentCredits(Category: Code[20]; Audience: Integer): Integer
    var
        Credits: Integer;
    begin
        if Audience > 30 then
            Credits := Audience - 30;
        if Category = 'COMEDY' then
            Credits += Audience div 5;
        exit(Credits);
    end;

    // ============================================================
    // Rebate allocation module tests
    // ============================================================

    [Test]
    procedure SingleNonzeroWeightLineGetsTheEntireTotal()
    var
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        ClearX140Data();
        SeedHeader('SL01', 123.45);
        SeedLine('SL01', 1, 'Widget', 7.5);

        Allocator.AllocateRebate('SL01');

        Assert.AreEqual(123.45, GetLineAmount('SL01', 1), 'Expected a document with a single line to allocate its entire total to that line');
    end;

    [Test]
    procedure TwoEvenlyWeightedLinesSplitCleanlyAndLeaveAnotherDocumentUntouched()
    var
        RebateHeader: Record "CG X140 Rebate Header";
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        ClearX140Data();
        SeedHeader('EV01', 10.00);
        SeedLine('EV01', 1, 'Widget A', 1);
        SeedLine('EV01', 2, 'Widget B', 1);

        // A second, unrelated document is seeded with its own nonzero
        // sentinel amounts and left alone - allocating EV01 must not
        // touch it.
        SeedHeader('EV02', 250.00);
        SeedLineWithSentinel('EV02', 1, 1, 111.11);
        SeedLineWithSentinel('EV02', 2, 1, 222.22);

        Allocator.AllocateRebate('EV01');

        Assert.AreEqual(5.00, GetLineAmount('EV01', 1), 'Expected an even two-line split to allocate exactly half the total to each line');
        Assert.AreEqual(5.00, GetLineAmount('EV01', 2), 'Expected an even two-line split to allocate exactly half the total to each line');
        Assert.AreEqual(10.00, Allocator.GetAllocatedTotal('EV01'), 'Expected the reconciliation total to equal the header total after allocating');

        RebateHeader.Get('EV02');
        Assert.IsFalse(RebateHeader.Allocated, 'Expected an untouched document to stay unallocated');
        Assert.AreEqual(111.11, GetLineAmount('EV02', 1), 'Expected another document''s line amount to be left untouched by allocating a different document');
        Assert.AreEqual(222.22, GetLineAmount('EV02', 2), 'Expected another document''s line amount to be left untouched by allocating a different document');
        // EV02's own lines (333.33) do not reconcile with its own header
        // total (250.00) by design - it was never allocated. Pinning the
        // reconciliation total against the lines' own sum here, not the
        // header total, catches a GetAllocatedTotal that just echoes the
        // header field instead of actually reading the lines.
        Assert.AreEqual(333.33, Allocator.GetAllocatedTotal('EV02'), 'Expected the reconciliation total to reflect the document''s own recorded line amounts');
    end;

    [Test]
    procedure AZeroWeightLineAlwaysReceivesExactlyZero()
    var
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        // Weights chosen so every nonzero-weight line's exact share has a
        // distinct rounding remainder (no ties), so this fixture pins an
        // outcome that does not depend on any particular tie-break policy.
        ClearX140Data();
        SeedHeader('ZL01', 77.77);
        SeedLine('ZL01', 1, 'Item P', 2.3);
        SeedLine('ZL01', 2, 'Item Q', 5.7);
        SeedLine('ZL01', 3, 'Item R', 3.1);
        SeedLine('ZL01', 4, 'Item S', 1.9);
        SeedLine('ZL01', 5, 'Sample T (FOC)', 0);

        Allocator.AllocateRebate('ZL01');

        Assert.AreEqual(13.76, GetLineAmount('ZL01', 1), 'Expected a weighted line''s allocated amount to depend only on the document''s weights and total');
        Assert.AreEqual(34.10, GetLineAmount('ZL01', 2), 'Expected a weighted line''s allocated amount to depend only on the document''s weights and total');
        Assert.AreEqual(18.54, GetLineAmount('ZL01', 3), 'Expected a weighted line''s allocated amount to depend only on the document''s weights and total');
        Assert.AreEqual(11.37, GetLineAmount('ZL01', 4), 'Expected a weighted line''s allocated amount to depend only on the document''s weights and total');
        Assert.AreEqual(0.00, GetLineAmount('ZL01', 5), 'Expected a line with no allocation weight to receive exactly zero');
        Assert.AreEqual(77.77, Allocator.GetAllocatedTotal('ZL01'), 'Expected the recorded amounts to sum to exactly the document total');
    end;

    [Test]
    procedure ReorderingTheSameLinesNeverChangesTheirRebateAmount()
    var
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        ClearX140Data();

        // Document PM01: lines entered P, Q, R, S.
        SeedHeader('PM01', 77.77);
        SeedLine('PM01', 1, 'Item P', 2.3);
        SeedLine('PM01', 2, 'Item Q', 5.7);
        SeedLine('PM01', 3, 'Item R', 3.1);
        SeedLine('PM01', 4, 'Item S', 1.9);

        // Document PM02: the exact same four items, same weights, same
        // total - only Item R and Item S swap which line number they
        // were entered on.
        SeedHeader('PM02', 77.77);
        SeedLine('PM02', 1, 'Item P', 2.3);
        SeedLine('PM02', 2, 'Item Q', 5.7);
        SeedLine('PM02', 3, 'Item S', 1.9);
        SeedLine('PM02', 4, 'Item R', 3.1);

        Allocator.AllocateRebate('PM01');
        Allocator.AllocateRebate('PM02');

        // Item P and Item Q are entered in the same position on both
        // documents, so their assertions alone already pin an unambiguous
        // per-item split for this set of weights and total.
        Assert.AreEqual(13.76, GetLineAmount('PM01', 1), 'Expected Item P''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(34.10, GetLineAmount('PM01', 2), 'Expected Item Q''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(18.54, GetLineAmount('PM01', 3), 'Expected Item R''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(11.37, GetLineAmount('PM01', 4), 'Expected Item S''s allocated amount to depend only on the document''s weights and total, never on line order');

        Assert.AreEqual(13.76, GetLineAmount('PM02', 1), 'Expected Item P''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(34.10, GetLineAmount('PM02', 2), 'Expected Item Q''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(11.37, GetLineAmount('PM02', 3), 'Expected Item S''s allocated amount to depend only on the document''s weights and total, never on line order');
        Assert.AreEqual(18.54, GetLineAmount('PM02', 4), 'Expected Item R''s allocated amount to depend only on the document''s weights and total, never on line order');

        // Item R and Item S get the same amount no matter which line
        // number they were entered on - the split must not depend on the
        // order the lines were imported in.
        Assert.AreEqual(GetLineAmount('PM01', 3), GetLineAmount('PM02', 4), 'Expected Item R to receive the same rebate amount whichever line number it was entered on');
        Assert.AreEqual(GetLineAmount('PM01', 4), GetLineAmount('PM02', 3), 'Expected Item S to receive the same rebate amount whichever line number it was entered on');

        Assert.AreEqual(77.77, Allocator.GetAllocatedTotal('PM01'), 'Expected the recorded amounts to sum to exactly the document total');
        Assert.AreEqual(77.77, Allocator.GetAllocatedTotal('PM02'), 'Expected the recorded amounts to sum to exactly the document total');
    end;

    [Test]
    procedure ALineWithNoWeightAtAllOnTheWholeDocumentIsLeftUnallocated()
    var
        RebateHeader: Record "CG X140 Rebate Header";
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        ClearX140Data();
        SeedHeader('NW01', 50.00);
        SeedLineWithSentinel('NW01', 1, 0, 555.55);
        SeedLineWithSentinel('NW01', 2, 0, 444.44);

        Allocator.AllocateRebate('NW01');

        RebateHeader.Get('NW01');
        Assert.IsFalse(RebateHeader.Allocated, 'Expected a document with no weight on any line to be left unallocated');
        Assert.AreEqual(555.55, GetLineAmount('NW01', 1), 'Expected a line''s existing amount to be left untouched when the document has no weight to allocate');
        Assert.AreEqual(444.44, GetLineAmount('NW01', 2), 'Expected a line''s existing amount to be left untouched when the document has no weight to allocate');
    end;

    [Test]
    procedure SuccessfulAllocationMarksTheDocumentAllocated()
    var
        RebateHeader: Record "CG X140 Rebate Header";
        Allocator: Codeunit "CG X140 Rebate Allocator";
    begin
        ClearX140Data();
        SeedHeader('MK01', 40.00);
        SeedLine('MK01', 1, 'Widget A', 1);
        SeedLine('MK01', 2, 'Widget B', 1);

        Allocator.AllocateRebate('MK01');

        RebateHeader.Get('MK01');
        Assert.IsTrue(RebateHeader.Allocated, 'Expected a document with at least one weighted line to be marked allocated');
    end;

    [Test]
    procedure DeterministicSweepMatchesTheReferenceAllocationAcrossManyPartitions()
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
            ClearX140Data();
            DocumentNo := 'SW' + Format(Partition);
            LineCount := Any.IntegerInRange(3, 9);
            TotalAmount := Any.IntegerInRange(100, 99999) / 100;
            SeedHeader(DocumentNo, TotalAmount);

            for i := 1 to LineCount do begin
                LineNo[i] := i;
                // Roughly every fourth line on a sweep partition is a
                // free-of-charge sample carrying no allocation weight.
                if i mod 4 = 0 then
                    Weight[i] := 0
                else
                    Weight[i] := Any.DecimalInRange(1, 500, 3);
                SeedLine(DocumentNo, i, StrSubstNo('Sweep line %1', i), Weight[i]);
            end;

            Allocator.AllocateRebate(DocumentNo);
            ComputeExpectedShares(Weight, LineNo, LineCount, TotalAmount, ExpectedShare);

            SumOfAmounts := 0;
            for i := 1 to LineCount do begin
                Assert.AreEqual(
                  ExpectedShare[i], GetLineAmount(DocumentNo, LineNo[i]),
                  StrSubstNo('Expected line %1 of sweep partition %2 to depend only on that document''s own weights and total', LineNo[i], Partition));
                SumOfAmounts += GetLineAmount(DocumentNo, LineNo[i]);
            end;
            Assert.AreEqual(
              TotalAmount, SumOfAmounts,
              StrSubstNo('Expected the recorded amounts on sweep partition %1 to sum to exactly its total', Partition));
        end;
    end;

    // ============================================================
    // Ledger module tests
    // ============================================================

    [Test]
    procedure SameCurrencyOnBothAccountsBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        ClearX118Data();
        SeedCurrency('EUR', 0.01);
        SeedAccount('MAIN-EUR', 'EUR');
        SeedAccount('CTR-EUR', 'EUR');
        CreateLine(JournalLine, 1, 'MAIN-EUR');

        SetAmountThenCounterAccount(JournalLine, 250.75, 'CTR-EUR');

        AssertBalances(1, 250.75);
        JournalLine.Get(1);
        Assert.AreEqual('EUR', JournalLine."Currency Code",
          'Expected the journal entry to keep the currency of its own account');
    end;

    [Test]
    procedure DifferentCurrenciesWithMatchingPrecisionBalanceExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        ClearX118Data();
        SeedCurrency('EUR', 0.01);
        SeedCurrency('USD', 0.01);
        SeedAccount('MAIN-EUR', 'EUR');
        SeedAccount('CTR-USD', 'USD');
        CreateLine(JournalLine, 2, 'MAIN-EUR');

        SetAmountThenCounterAccount(JournalLine, 312.40, 'CTR-USD');

        AssertBalances(2, 312.40);
    end;

    [Test]
    procedure AWholeUnitCounterCurrencyStillBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        ClearX118Data();
        SeedCurrency('EUR', 0.01);
        SeedCurrency('JPY', 1);
        SeedAccount('MAIN-EUR', 'EUR');
        SeedAccount('CTR-JPY', 'JPY');
        CreateLine(JournalLine, 3, 'MAIN-EUR');

        SetAmountThenCounterAccount(JournalLine, 100.50, 'CTR-JPY');

        AssertBalances(3, 100.50);
        JournalLine.Get(3);
        Assert.AreEqual('EUR', JournalLine."Currency Code",
          'Expected the journal entry to keep the currency of its own account');
    end;

    [Test]
    procedure ASmallRemainderAgainstAWholeUnitCounterCurrencyStillBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        ClearX118Data();
        SeedCurrency('EUR', 0.01);
        SeedCurrency('JPY', 1);
        SeedAccount('MAIN-EUR', 'EUR');
        SeedAccount('CTR-JPY', 'JPY');
        CreateLine(JournalLine, 4, 'MAIN-EUR');

        SetAmountThenCounterAccount(JournalLine, 100.01, 'CTR-JPY');

        AssertBalances(4, 100.01);
    end;

    [Test]
    procedure AFractionalCentRemainderAgainstAWholeUnitCounterCurrencyStillBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        // 100.005 is not itself a whole number of EUR cents, but it is what
        // this account's own line already carries - the fix must preserve
        // it exactly, not round it to the nearest cent along the way.
        ClearX118Data();
        SeedCurrency('EUR', 0.01);
        SeedCurrency('JPY', 1);
        SeedAccount('MAIN-EUR', 'EUR');
        SeedAccount('CTR-JPY', 'JPY');
        CreateLine(JournalLine, 15, 'MAIN-EUR');

        SetAmountThenCounterAccount(JournalLine, 100.005, 'CTR-JPY');

        AssertBalances(15, 100.005);
    end;

    [Test]
    procedure AWholeAmountAgainstAWholeUnitCounterCurrencyBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        ClearX118Data();
        SeedCurrency('EUR', 0.01);
        SeedCurrency('JPY', 1);
        SeedAccount('MAIN-EUR', 'EUR');
        SeedAccount('CTR-JPY', 'JPY');
        CreateLine(JournalLine, 5, 'MAIN-EUR');

        SetAmountThenCounterAccount(JournalLine, 100.00, 'CTR-JPY');

        AssertBalances(5, 100.00);
    end;

    [Test]
    procedure AFinerCounterCurrencyStillBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        ClearX118Data();
        SeedCurrency('EUR', 0.01);
        SeedCurrency('KWD', 0.001);
        SeedAccount('MAIN-EUR', 'EUR');
        SeedAccount('CTR-KWD', 'KWD');
        CreateLine(JournalLine, 6, 'MAIN-EUR');

        SetAmountThenCounterAccount(JournalLine, 100.50, 'CTR-KWD');

        AssertBalances(6, 100.50);
    end;

    [Test]
    procedure AZeroPrecisionCounterCurrencyStillBalancesExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        ClearX118Data();
        SeedCurrency('EUR', 0.01);
        SeedCurrency('ZPR', 0);
        SeedAccount('MAIN-EUR', 'EUR');
        SeedAccount('CTR-ZPR', 'ZPR');
        CreateLine(JournalLine, 14, 'MAIN-EUR');

        SetAmountThenCounterAccount(JournalLine, 88.37, 'CTR-ZPR');

        AssertBalances(14, 88.37);
    end;

    [Test]
    procedure AFinelyDenominatedMainCurrencyStillBalancesExactlyAgainstAWholeUnitCounter()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        ClearX118Data();
        SeedCurrency('KWD', 0.001);
        SeedCurrency('JPY', 1);
        SeedAccount('MAIN-KWD', 'KWD');
        SeedAccount('CTR-JPY', 'JPY');
        CreateLine(JournalLine, 7, 'MAIN-KWD');

        SetAmountThenCounterAccount(JournalLine, 45.678, 'CTR-JPY');

        AssertBalances(7, 45.678);
    end;

    [Test]
    procedure NoMainCurrencyStillBalancesExactlyAgainstAWholeUnitCounter()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        ClearX118Data();
        SeedCurrency('JPY', 1);
        SeedAccount('MAIN-LOCAL', '');
        SeedAccount('CTR-JPY', 'JPY');
        CreateLine(JournalLine, 8, 'MAIN-LOCAL');

        SetAmountThenCounterAccount(JournalLine, 75.60, 'CTR-JPY');

        AssertBalances(8, 75.60);
    end;

    [Test]
    procedure ClearingTheCounterAccountLeavesNothingToBalance()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        ClearX118Data();
        SeedCurrency('EUR', 0.01);
        SeedCurrency('JPY', 1);
        SeedAccount('MAIN-EUR', 'EUR');
        SeedAccount('CTR-JPY', 'JPY');
        CreateLine(JournalLine, 9, 'MAIN-EUR');

        SetAmountThenCounterAccount(JournalLine, 100.50, 'CTR-JPY');

        JournalLine.Validate("Counter Account No.", '');
        JournalLine.Modify(true);

        JournalLine.Get(9);
        Assert.AreEqual(100.50, JournalLine.Amount,
          'Expected clearing the counter account on a journal entry to leave its recorded amount untouched');
        Assert.AreEqual(0.0, JournalLine."Balancing Amount",
          'Expected clearing the counter account on a journal entry to leave it with nothing to balance');
    end;

    [Test]
    procedure ClearingTheAccountNoAlsoClearsTheCurrencyCode()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        ClearX118Data();
        SeedCurrency('EUR', 0.01);
        SeedAccount('MAIN-EUR', 'EUR');
        SeedAccount('CTR-EUR', 'EUR');
        CreateLine(JournalLine, 16, 'MAIN-EUR');

        JournalLine.Validate("Account No.", '');
        JournalLine.Modify(true);

        JournalLine.Get(16);
        Assert.AreEqual('', JournalLine."Currency Code",
          'Expected clearing the account on a journal entry to also clear its currency');

        SetAmountThenCounterAccount(JournalLine, 60.30, 'CTR-EUR');

        AssertBalances(16, 60.30);
    end;

    [Test]
    procedure AmountChangesAfterTheCounterAccountIsSetStillBalanceExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        ClearX118Data();
        SeedCurrency('EUR', 0.01);
        SeedCurrency('JPY', 1);
        SeedAccount('MAIN-EUR', 'EUR');
        SeedAccount('CTR-JPY', 'JPY');
        CreateLine(JournalLine, 10, 'MAIN-EUR');

        JournalLine.Validate("Counter Account No.", 'CTR-JPY');
        JournalLine.Validate(Amount, 100.50);
        JournalLine.Modify(true);

        AssertBalances(10, 100.50);

        JournalLine.Validate(Amount, 60.25);
        JournalLine.Modify(true);

        AssertBalances(10, 60.25);
    end;

    [Test]
    procedure SettingAnUnknownCounterAccountFailsWithAnError()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        ClearX118Data();
        SeedCurrency('EUR', 0.01);
        SeedAccount('MAIN-EUR', 'EUR');
        CreateLine(JournalLine, 11, 'MAIN-EUR');
        JournalLine.Validate(Amount, 100.00);
        JournalLine.Modify(true);

        asserterror JournalLine.Validate("Counter Account No.", 'NO-SUCH-ACCOUNT');
        Assert.ExpectedError('NO-SUCH-ACCOUNT');
    end;

    [Test]
    procedure SettingAnUnknownAccountFailsWithAnError()
    var
        JournalLine: Record "CG X118 Journal Line";
    begin
        ClearX118Data();
        JournalLine.Init();
        JournalLine."Entry No." := 12;
        JournalLine.Insert(true);

        asserterror JournalLine.Validate("Account No.", 'NO-SUCH-ACCOUNT');
        Assert.ExpectedError('NO-SUCH-ACCOUNT');
    end;

    [Test]
    procedure UnrelatedEntriesAreNeverTouched()
    var
        JournalLine: Record "CG X118 Journal Line";
        OtherLine: Record "CG X118 Journal Line";
    begin
        ClearX118Data();
        SeedCurrency('EUR', 0.01);
        SeedCurrency('JPY', 1);
        SeedAccount('MAIN-EUR', 'EUR');
        SeedAccount('CTR-JPY', 'JPY');

        OtherLine.Init();
        OtherLine."Entry No." := 999;
        OtherLine.Amount := 321.00;
        OtherLine."Balancing Amount" := 777.77;
        OtherLine.Insert();

        CreateLine(JournalLine, 13, 'MAIN-EUR');
        SetAmountThenCounterAccount(JournalLine, 100.50, 'CTR-JPY');
        AssertBalances(13, 100.50);

        OtherLine.Get(999);
        Assert.AreEqual(777.77, OtherLine."Balancing Amount",
          'Expected a journal entry that was never revalidated in this test to keep its recorded balancing amount untouched');
        Assert.AreEqual(321.00, OtherLine.Amount,
          'Expected a journal entry that was never revalidated in this test to keep its recorded amount untouched');
    end;

    [Test]
    procedure RandomCoarseCurrencyAmountsAlwaysBalanceExactly()
    var
        JournalLine: Record "CG X118 Journal Line";
        Any: Codeunit Any;
        EntryNo: Integer;
        AmountValue: Decimal;
        i: Integer;
    begin
        // Amounts are drawn to three decimal places - one more than EUR's
        // own 0.01 precision - so a fix that rounds to the line's own
        // currency instead of the counter's fails on essentially every
        // draw here, not just the single hand-picked case above.
        ClearX118Data();
        Any.SetSeed(118);
        SeedCurrency('EUR', 0.01);
        SeedCurrency('JPY', 1);
        SeedAccount('MAIN-EUR', 'EUR');
        SeedAccount('CTR-JPY', 'JPY');

        for i := 1 to 8 do begin
            EntryNo := 100 + i;
            AmountValue := Any.IntegerInRange(1000, 999999) / 1000;
            CreateLine(JournalLine, EntryNo, 'MAIN-EUR');
            SetAmountThenCounterAccount(JournalLine, AmountValue, 'CTR-JPY');
            AssertBalances(EntryNo, AmountValue);
        end;
    end;

    // ============================================================
    // Project labor-hours module tests
    // ============================================================

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

    // ============================================================
    // Royalty statement module tests
    // ============================================================

    [Test]
    procedure TragedyChargesFlatFeeAtExactlyThirtyAttendees()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        Assert.AreEqual(400.0, Statement.LineAmount('TRAGEDY', 30), 'Expected the flat tragedy base fee at exactly 30 attendees, the surcharge starts only above 30');
    end;

    [Test]
    procedure TragedyAddsSurchargeJustAboveThirtyAttendees()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        Assert.AreEqual(410.0, Statement.LineAmount('TRAGEDY', 31), 'Expected the tragedy base fee plus one surcharge step at 31 attendees');
    end;

    [Test]
    procedure ComedyEarnsNoBonusAtExactlyTwentyAttendees()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        Assert.AreEqual(360.0, Statement.LineAmount('COMEDY', 20), 'Expected the comedy fee with no bonus at exactly 20 attendees, the bonus starts only above 20');
    end;

    [Test]
    procedure ComedyAddsBonusJustAboveTwentyAttendees()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        Assert.AreEqual(468.0, Statement.LineAmount('COMEDY', 21), 'Expected the comedy fee with its bonus and one bonus step at 21 attendees');
    end;

    [Test]
    procedure NoCreditsAtExactlyThirtyAttendees()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        Assert.AreEqual(0, Statement.LineCredits('TRAGEDY', 30), 'Expected zero credits at exactly 30 attendees, credits start only above 30');
    end;

    [Test]
    procedure OneCreditAtThirtyOneAttendees()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        Assert.AreEqual(1, Statement.LineCredits('TRAGEDY', 31), 'Expected exactly one credit at 31 attendees');
    end;

    [Test]
    procedure ComedyAddsCreditPerFullGroupOfFiveAttendees()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        Assert.AreEqual(10, Statement.LineCredits('COMEDY', 34), 'Expected 4 threshold credits plus 6 group-of-five credits for a comedy audience of 34');
    end;

    [Test]
    procedure ComedyCreditsDropPartialGroupOfFive()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        Assert.AreEqual(1, Statement.LineCredits('COMEDY', 9), 'Expected exactly one group-of-five credit for a comedy audience of 9, the remaining four attendees earn nothing');
    end;

    [Test]
    procedure UnknownCategoryFailsLineAmount()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        asserterror Statement.LineAmount('HISTORY', 25);
        Assert.ExpectedError('HISTORY');
    end;

    [Test]
    procedure UnknownCategoryFailsLineCredits()
    var
        Statement: Codeunit "CG X078 Statement";
    begin
        asserterror Statement.LineCredits('HISTORY', 25);
        Assert.ExpectedError('HISTORY');
    end;

    [Test]
    procedure BuildStatementListsAgreementPerformancesInOrderWithCorrectTotals()
    var
        Performance: Record "CG X078 Performance";
        StatementLine: Record "CG X078 Statement Line" temporary;
        Statement: Codeunit "CG X078 Statement";
        TotalAmount: Decimal;
        TotalCredits: Integer;
    begin
        // [SCENARIO] A single build with freshly declared totals produces the right lines and sums.
        Performance.DeleteAll();
        SeedPerformance(1701, 'TRYAL-RS17', 'Hamlet', 'TRAGEDY', 55);
        SeedPerformance(1702, 'TRYAL-RS17', 'As You Like It', 'COMEDY', 35);
        SeedPerformance(1703, 'TRYAL-RS17', 'Othello', 'TRAGEDY', 15);
        SeedPerformance(1704, 'TRYAL-RS17X', 'The Tempest', 'COMEDY', 40);

        Statement.BuildStatement('TRYAL-RS17', StatementLine, TotalAmount, TotalCredits);

        StatementLine.Reset();
        Assert.AreEqual(3, StatementLine.Count(), 'Expected one statement line per performance of the agreement, performances of another agreement are excluded');
        VerifyLine(StatementLine, 1, 'Hamlet', 'TRAGEDY', 55, 650.0, 25);
        VerifyLine(StatementLine, 2, 'As You Like It', 'COMEDY', 35, 580.0, 12);
        VerifyLine(StatementLine, 3, 'Othello', 'TRAGEDY', 15, 400.0, 0);
        Assert.AreEqual(1630.0, TotalAmount, 'Expected TotalAmount to be the sum of the three line amounts');
        Assert.AreEqual(37, TotalCredits, 'Expected TotalCredits to be the sum of the three line credits');
    end;

    [Test]
    procedure BuildStatementDoesNotCarryOverThePriorAgreementsTotalsWhenReused()
    var
        Performance: Record "CG X078 Performance";
        StatementLine: Record "CG X078 Statement Line" temporary;
        Statement: Codeunit "CG X078 Statement";
        TotalAmount: Decimal;
        TotalCredits: Integer;
    begin
        // [SCENARIO] Building statements for two agreements back-to-back with the same output variables: the second agreement's totals must be its own, not layered onto the first's.
        Performance.DeleteAll();
        SeedPerformance(3001, 'TRYAL-A', 'Hamlet', 'TRAGEDY', 55);
        SeedPerformance(3002, 'TRYAL-B', 'Othello', 'TRAGEDY', 15);

        Statement.BuildStatement('TRYAL-A', StatementLine, TotalAmount, TotalCredits);
        Assert.AreEqual(650.0, TotalAmount, 'Expected the first agreement''s own total');
        Assert.AreEqual(25, TotalCredits, 'Expected the first agreement''s own credits');

        Statement.BuildStatement('TRYAL-B', StatementLine, TotalAmount, TotalCredits);

        StatementLine.Reset();
        Assert.AreEqual(1, StatementLine.Count(), 'Expected only the second agreement''s own line in the buffer');
        Assert.AreEqual(400.0, TotalAmount, 'Expected the second agreement''s TotalAmount to reflect only its own performance, not the first agreement''s total on top');
        Assert.AreEqual(0, TotalCredits, 'Expected the second agreement''s TotalCredits to reflect only its own performance, not the first agreement''s credits on top');
    end;

    [Test]
    procedure BuildStatementClearsPreSetTotalsAndStaleBufferLine()
    var
        Performance: Record "CG X078 Performance";
        StatementLine: Record "CG X078 Statement Line" temporary;
        Statement: Codeunit "CG X078 Statement";
        TotalAmount: Decimal;
        TotalCredits: Integer;
    begin
        // [SCENARIO] A caller that pre-sets its totals (or passes in dirty output variables) still gets a clean recomputation.
        Performance.DeleteAll();
        SeedPerformance(1801, 'TRYAL-RS18', 'King Lear', 'TRAGEDY', 40);
        StatementLine.Init();
        StatementLine."Line No." := 999;
        StatementLine.Insert();
        TotalAmount := 123.45;
        TotalCredits := 77;

        Statement.BuildStatement('TRYAL-RS18', StatementLine, TotalAmount, TotalCredits);

        StatementLine.Reset();
        Assert.AreEqual(1, StatementLine.Count(), 'Expected the buffer to hold only the fresh statement, a line from before the build must be removed first');
        Assert.IsFalse(StatementLine.Get(999), 'Expected the stale line 999 from before the build to be gone');
        VerifyLine(StatementLine, 1, 'King Lear', 'TRAGEDY', 40, 500.0, 10);
        Assert.AreEqual(500.0, TotalAmount, 'Expected TotalAmount to be recomputed from scratch, not added onto the pre-set value');
        Assert.AreEqual(10, TotalCredits, 'Expected TotalCredits to be recomputed from scratch, not added onto the pre-set value');
    end;

    [Test]
    procedure BuildStatementYieldsZeroTotalsForAgreementWithNoPerformancesEvenWithDirtyInputs()
    var
        Performance: Record "CG X078 Performance";
        StatementLine: Record "CG X078 Statement Line" temporary;
        Statement: Codeunit "CG X078 Statement";
        TotalAmount: Decimal;
        TotalCredits: Integer;
    begin
        // [SCENARIO] An agreement with no performances yields an empty buffer and zero totals even when the outputs start dirty.
        Performance.DeleteAll();
        StatementLine.Init();
        StatementLine."Line No." := 999;
        StatementLine.Insert();
        TotalAmount := 999.99;
        TotalCredits := 99;

        Statement.BuildStatement('TRYAL-RS19', StatementLine, TotalAmount, TotalCredits);

        StatementLine.Reset();
        Assert.AreEqual(0, StatementLine.Count(), 'Expected an empty statement for an agreement with no performances');
        Assert.AreEqual(0.0, TotalAmount, 'Expected TotalAmount to come back at zero for an agreement with no performances, whatever it held on entry');
        Assert.AreEqual(0, TotalCredits, 'Expected TotalCredits to come back at zero for an agreement with no performances, whatever it held on entry');
    end;

    [Test]
    procedure BuildStatementFailsWhenAPerformanceHasUnknownCategory()
    var
        Performance: Record "CG X078 Performance";
        StatementLine: Record "CG X078 Statement Line" temporary;
        Statement: Codeunit "CG X078 Statement";
        TotalAmount: Decimal;
        TotalCredits: Integer;
    begin
        Performance.DeleteAll();
        SeedPerformance(2001, 'TRYAL-RS20', 'Hamlet', 'TRAGEDY', 30);
        SeedPerformance(2002, 'TRYAL-RS20', 'Henry V', 'HISTORY', 25);

        asserterror Statement.BuildStatement('TRYAL-RS20', StatementLine, TotalAmount, TotalCredits);
        Assert.ExpectedError('HISTORY');
    end;

    [Test]
    procedure RandomAgreementTotalsMatchIndependentComputation()
    var
        Performance: Record "CG X078 Performance";
        StatementLine: Record "CG X078 Statement Line" temporary;
        Statement: Codeunit "CG X078 Statement";
        Any: Codeunit Any;
        Category: Code[20];
        Audience: Integer;
        i: Integer;
        ExpectedAmount: Decimal;
        ExpectedCredits: Integer;
        TotalAmount: Decimal;
        TotalCredits: Integer;
    begin
        // [SCENARIO] A generated agreement totals exactly what the fee and credit rules say, computed independently of BuildStatement's own internals.
        Performance.DeleteAll();
        for i := 1 to 5 do begin
            if i mod 2 = 1 then
                Category := 'TRAGEDY'
            else
                Category := 'COMEDY';
            Audience := Any.IntegerInRange(1, 150);
            SeedPerformance(2100 + i, 'TRYAL-RS21', StrSubstNo('Play %1', i), Category, Audience);
            ExpectedAmount += IndependentAmount(Category, Audience);
            ExpectedCredits += IndependentCredits(Category, Audience);
        end;

        Statement.BuildStatement('TRYAL-RS21', StatementLine, TotalAmount, TotalCredits);

        StatementLine.Reset();
        Assert.AreEqual(5, StatementLine.Count(), 'Expected one statement line per generated performance');
        Assert.AreEqual(ExpectedAmount, TotalAmount, 'Expected TotalAmount to match the independently computed sum of the generated fees');
        Assert.AreEqual(ExpectedCredits, TotalCredits, 'Expected TotalCredits to match the independently computed sum of the generated credits');
    end;

    [Test]
    procedure BuildStatementLeavesTheBufferHoldingOnlyTheStatementJustBuilt()
    var
        Performance: Record "CG X078 Performance";
        StatementLine: Record "CG X078 Statement Line" temporary;
        Statement: Codeunit "CG X078 Statement";
        TotalAmount: Decimal;
        TotalCredits: Integer;
    begin
        // [SCENARIO] The caller hands over a buffer that already holds a line
        // from earlier work AND is narrowed to a range that does not cover it.
        // Building a statement replaces the whole buffer, so the leftover must
        // be gone whatever part of it the caller happened to be reading.
        Performance.DeleteAll();
        SeedPerformance(1751, 'TRYAL-RS51', 'Macbeth', 'TRAGEDY', 30);

        StatementLine.Init();
        StatementLine."Line No." := 999;
        StatementLine."Play Name" := 'Left over from earlier work';
        StatementLine.Insert();
        StatementLine.SetRange("Line No.", 1, 100);

        Statement.BuildStatement('TRYAL-RS51', StatementLine, TotalAmount, TotalCredits);

        StatementLine.Reset();
        Assert.AreEqual(1, StatementLine.Count(), 'Expected the buffer to hold only the lines of the statement just built, whatever part of it the caller was reading beforehand');
        Assert.IsFalse(StatementLine.Get(999), 'The leftover line must not survive a rebuild just because it sat outside the caller''s filter');
    end;

    // ============================================================
    // Settlement module tests (CG X142 glue)
    // ============================================================

    [Test]
    procedure SettlingADocumentsLinesBooksOneBalancedLedgerEntryPerLine()
    var
        RebateSettlement: Codeunit "CG X142 Rebate Settlement";
        JournalLine: Record "CG X118 Journal Line";
    begin
        ClearX140Data();
        ClearX118Data();
        SeedCurrency('EUR', 0.01);
        SeedAccount('CHARGE-AC', 'EUR');
        SeedAccount('CLEAR-AC', 'EUR');

        SeedHeader('LG01', 30.00);
        SeedLineWithSentinel('LG01', 1, 2, 20.00);
        SeedLineWithSentinel('LG01', 2, 0, 0.00);
        SeedLineWithSentinel('LG01', 3, 3, 10.00);

        // A second document's already-allocated lines are seeded but never
        // settled - settling LG01 must not pick them up.
        SeedHeader('LG02', 999.00);
        SeedLineWithSentinel('LG02', 1, 1, 500.00);
        SeedLineWithSentinel('LG02', 2, 1, 499.00);

        RebateSettlement.SettleRebate('LG01', 700, 'CHARGE-AC', 'CLEAR-AC');

        AssertBalances(701, 20.00);
        AssertBalances(702, 0.00);
        AssertBalances(703, 10.00);
        AssertLedgerAccounts(701, 'CHARGE-AC', 'CLEAR-AC');
        AssertLedgerAccounts(702, 'CHARGE-AC', 'CLEAR-AC');
        AssertLedgerAccounts(703, 'CHARGE-AC', 'CLEAR-AC');

        JournalLine.Reset();
        Assert.AreEqual(3, JournalLine.Count(), 'Expected exactly one ledger entry per settled line, and no entries for a document that was never settled');
    end;

    [Test]
    procedure AFreeSampleLineIsNeverSettledWithANonzeroLedgerEntry()
    var
        Allocator: Codeunit "CG X140 Rebate Allocator";
        RebateSettlement: Codeunit "CG X142 Rebate Settlement";
        JournalLine: Record "CG X118 Journal Line";
        SumOfLegs: Decimal;
        i: Integer;
    begin
        // Same weights and total as the allocation module's own zero-weight
        // fixture above, so the free-of-charge sample line (no allocation
        // weight at all) is entered last on the document.
        ClearX140Data();
        ClearX118Data();
        SeedCurrency('EUR', 0.01);
        SeedAccount('CHARGE-AC', 'EUR');
        SeedAccount('CLEAR-AC', 'EUR');

        SeedHeader('SD01', 77.77);
        SeedLine('SD01', 1, 'Item P', 2.3);
        SeedLine('SD01', 2, 'Item Q', 5.7);
        SeedLine('SD01', 3, 'Item R', 3.1);
        SeedLine('SD01', 4, 'Item S', 1.9);
        SeedLine('SD01', 5, 'Sample T (FOC)', 0);

        Allocator.AllocateRebate('SD01');
        RebateSettlement.SettleRebate('SD01', 800, 'CHARGE-AC', 'CLEAR-AC');

        AssertBalances(805, 0.00);

        SumOfLegs := 0;
        for i := 1 to 5 do begin
            JournalLine.Get(800 + i);
            SumOfLegs += JournalLine.Amount;
        end;
        Assert.AreEqual(77.77, SumOfLegs, 'Expected a document''s settled ledger entries to always add up to exactly its total rebate amount');
    end;
}
