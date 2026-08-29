codeunit 89391 "CG-AL-X171 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every test clears both tables
    // before seeding its own rows.

    local procedure ClearAllData()
    var
        FeeInvoice: Record "CG X171 Fee Invoice";
        FeeInvoiceLine: Record "CG X171 Fee Invoice Line";
    begin
        FeeInvoiceLine.DeleteAll();
        FeeInvoice.DeleteAll();
    end;

    local procedure SeedInvoice(DocumentNo: Code[20]; Pct: Decimal)
    var
        FeeInvoice: Record "CG X171 Fee Invoice";
    begin
        FeeInvoice.Init();
        FeeInvoice."No." := DocumentNo;
        FeeInvoice."Invoice Description" := 'Test invoice';
        FeeInvoice."Handling Fee Pct" := Pct;
        FeeInvoice.Insert();
    end;

    local procedure SeedLine(DocumentNo: Code[20]; LineNo: Integer; ItemDescription: Text[100]; NetAmount: Decimal)
    var
        FeeInvoiceLine: Record "CG X171 Fee Invoice Line";
    begin
        FeeInvoiceLine.Init();
        FeeInvoiceLine."Document No." := DocumentNo;
        FeeInvoiceLine."Line No." := LineNo;
        FeeInvoiceLine."Item Description" := ItemDescription;
        FeeInvoiceLine."Net Amount" := NetAmount;
        FeeInvoiceLine.Insert();
    end;

    local procedure SeedLineWithSentinel(DocumentNo: Code[20]; LineNo: Integer; NetAmount: Decimal; SentinelFee: Decimal)
    var
        FeeInvoiceLine: Record "CG X171 Fee Invoice Line";
    begin
        FeeInvoiceLine.Init();
        FeeInvoiceLine."Document No." := DocumentNo;
        FeeInvoiceLine."Line No." := LineNo;
        FeeInvoiceLine."Net Amount" := NetAmount;
        FeeInvoiceLine."Handling Fee" := SentinelFee;
        FeeInvoiceLine.Insert();
    end;

    local procedure GetLineFee(DocumentNo: Code[20]; LineNo: Integer): Decimal
    var
        FeeInvoiceLine: Record "CG X171 Fee Invoice Line";
    begin
        FeeInvoiceLine.Get(DocumentNo, LineNo);
        exit(FeeInvoiceLine."Handling Fee");
    end;

    // Independently reconstructs the fee calculation every correct
    // implementation must produce: apply the percentage to the invoice's
    // own net total and round that ONCE, then floor everyone's exact
    // proportional share of that rounded total to the cent and hand out
    // whatever the floors left on the table one cent at a time to the
    // lines closest to rounding up, tie-broken by the lower line number.
    // A zero-net-amount line's remainder is always exactly zero, so it
    // never competes for a leftover cent. This mirrors the allocator's
    // own fix - it is the definition of "correct" this oracle grades
    // against, not a re-implementation that happens to agree with one
    // particular solution.
    local procedure ComputeExpectedFees(NetAmount: array[13] of Decimal; LineNo: array[13] of Integer; LineCount: Integer; Pct: Decimal; var ExpectedDocumentFee: Decimal; var ExpectedLineFee: array[13] of Decimal)
    var
        Remainder: array[13] of Decimal;
        Awarded: array[13] of Boolean;
        NetTotal: Decimal;
        FloorSum: Decimal;
        RemainingResidual: Decimal;
        ExactShare: Decimal;
        WinnerIndex: Integer;
        i: Integer;
    begin
        NetTotal := 0;
        for i := 1 to LineCount do
            NetTotal += NetAmount[i];

        if NetTotal = 0 then begin
            ExpectedDocumentFee := 0;
            for i := 1 to LineCount do
                ExpectedLineFee[i] := 0;
            exit;
        end;

        ExpectedDocumentFee := Round(NetTotal * Pct / 100, 0.01);

        FloorSum := 0;
        for i := 1 to LineCount do begin
            Awarded[i] := false;
            if NetAmount[i] = 0 then begin
                ExpectedLineFee[i] := 0;
                Remainder[i] := 0;
            end else begin
                ExactShare := ExpectedDocumentFee * NetAmount[i] / NetTotal;
                ExpectedLineFee[i] := Round(ExactShare, 0.01, '<');
                Remainder[i] := ExactShare - ExpectedLineFee[i];
                FloorSum += ExpectedLineFee[i];
            end;
        end;

        RemainingResidual := ExpectedDocumentFee - FloorSum;
        while RemainingResidual >= 0.005 do begin
            WinnerIndex := 0;
            for i := 1 to LineCount do
                if (NetAmount[i] <> 0) and (not Awarded[i]) then
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
            ExpectedLineFee[WinnerIndex] += 0.01;
            Awarded[WinnerIndex] := true;
            RemainingResidual -= 0.01;
        end;
    end;

    [Test]
    procedure SingleLineInvoiceFeeEqualsItsWholeNetAmountsShare()
    var
        Allocator: Codeunit "CG X171 Fee Allocator";
        FeeInvoice: Record "CG X171 Fee Invoice";
    begin
        ClearAllData();
        SeedInvoice('SL01', 6.25);
        SeedLine('SL01', 1, 'Widget', 812.37);

        Allocator.CalculateFees('SL01');

        FeeInvoice.Get('SL01');
        Assert.AreEqual(50.77, FeeInvoice."Total Handling Fee", 'Expected an invoice with a single line to charge its handling fee against that line''s entire net amount');
        Assert.AreEqual(50.77, GetLineFee('SL01', 1), 'Expected an invoice with a single line to charge its handling fee against that line''s entire net amount');
        Assert.AreEqual(50.77, Allocator.GetCalculatedFeeTotal('SL01'), 'Expected the recorded line fee to sum to exactly the total handling fee');
    end;

    [Test]
    procedure TwoLineInvoiceWhereBothRoundingRulesAgreeAndLeavesAnotherInvoiceUntouched()
    var
        FeeInvoice: Record "CG X171 Fee Invoice";
        Allocator: Codeunit "CG X171 Fee Allocator";
    begin
        ClearAllData();
        SeedInvoice('BN01', 10.00);
        SeedLine('BN01', 1, 'Widget A', 250.00);
        SeedLine('BN01', 2, 'Widget B', 150.00);

        // A second, unrelated invoice is seeded with its own nonzero
        // sentinel fee values and left alone - calculating BN01 must not
        // touch it.
        SeedInvoice('BN02', 99.00);
        SeedLineWithSentinel('BN02', 1, 321.00, 111.11);
        FeeInvoice.Get('BN02');
        FeeInvoice."Total Handling Fee" := 777.77;
        FeeInvoice.Modify();

        Allocator.CalculateFees('BN01');

        FeeInvoice.Get('BN01');
        Assert.AreEqual(40.00, FeeInvoice."Total Handling Fee", 'Expected a clean two-line split to charge exactly the stated percentage of the invoice total');
        Assert.AreEqual(25.00, GetLineFee('BN01', 1), 'Expected a clean two-line split to divide the handling fee exactly in proportion to each line''s net amount');
        Assert.AreEqual(15.00, GetLineFee('BN01', 2), 'Expected a clean two-line split to divide the handling fee exactly in proportion to each line''s net amount');
        Assert.AreEqual(40.00, Allocator.GetCalculatedFeeTotal('BN01'), 'Expected the recorded line fees to sum to exactly the total handling fee');
        Assert.IsTrue(FeeInvoice."Fees Calculated", 'Expected a successfully calculated invoice to be marked as such');

        FeeInvoice.Get('BN02');
        Assert.IsFalse(FeeInvoice."Fees Calculated", 'Expected an untouched invoice to stay unmarked as calculated');
        Assert.AreEqual(777.77, FeeInvoice."Total Handling Fee", 'Expected another invoice''s total handling fee to be left untouched by calculating a different invoice');
        Assert.AreEqual(111.11, GetLineFee('BN02', 1), 'Expected another invoice''s line handling fee to be left untouched by calculating a different invoice');
    end;

    [Test]
    procedure AdversarialFiveLineInvoiceDocumentFeeAndEveryLineFeeMatchTheStatedPercentageRule()
    var
        Allocator: Codeunit "CG X171 Fee Allocator";
        FeeInvoice: Record "CG X171 Fee Invoice";
    begin
        ClearAllData();
        SeedInvoice('AD01', 7.25);
        SeedLine('AD01', 1, 'Item P', 166.28);
        SeedLine('AD01', 2, 'Item Q', 614.28);
        SeedLine('AD01', 3, 'Item R', 651.96);
        SeedLine('AD01', 4, 'Item S', 772.95);
        SeedLine('AD01', 5, 'Item T', 661.35);

        Allocator.CalculateFees('AD01');

        FeeInvoice.Get('AD01');
        Assert.AreEqual(207.84, FeeInvoice."Total Handling Fee", 'Expected the total handling fee to equal the stated percentage applied to the invoice''s own net total, not the sum of each line''s own independently rounded fee');
        Assert.AreEqual(12.05, GetLineFee('AD01', 1), 'Expected a line''s handling fee to depend only on the invoice''s own net amounts and percentage');
        Assert.AreEqual(44.53, GetLineFee('AD01', 2), 'Expected a line''s handling fee to depend only on the invoice''s own net amounts and percentage');
        Assert.AreEqual(47.27, GetLineFee('AD01', 3), 'Expected a line''s handling fee to depend only on the invoice''s own net amounts and percentage');
        Assert.AreEqual(56.04, GetLineFee('AD01', 4), 'Expected a line''s handling fee to depend only on the invoice''s own net amounts and percentage');
        Assert.AreEqual(47.95, GetLineFee('AD01', 5), 'Expected a line''s handling fee to depend only on the invoice''s own net amounts and percentage');
        Assert.AreEqual(207.84, Allocator.GetCalculatedFeeTotal('AD01'), 'Expected the recorded line fees to sum to exactly the total handling fee');
    end;

    [Test]
    procedure ManyLineInvoiceWithLargerDriftStillClosesExactlyToTheStatedPercentageRule()
    var
        Allocator: Codeunit "CG X171 Fee Allocator";
        FeeInvoice: Record "CG X171 Fee Invoice";
    begin
        ClearAllData();
        SeedInvoice('MN01', 10.4);
        SeedLine('MN01', 1, 'Item 01', 705.05);
        SeedLine('MN01', 2, 'Item 02', 490.84);
        SeedLine('MN01', 3, 'Item 03', 826.60);
        SeedLine('MN01', 4, 'Item 04', 820.16);
        SeedLine('MN01', 5, 'Item 05', 540.06);
        SeedLine('MN01', 6, 'Item 06', 899.09);
        SeedLine('MN01', 7, 'Item 07', 485.92);
        SeedLine('MN01', 8, 'Item 08', 149.97);
        SeedLine('MN01', 9, 'Item 09', 993.62);
        SeedLine('MN01', 10, 'Item 10', 223.93);
        SeedLine('MN01', 11, 'Item 11', 881.14);
        SeedLine('MN01', 12, 'Item 12', 436.21);
        SeedLine('MN01', 13, 'Item 13', 581.78);

        Allocator.CalculateFees('MN01');

        FeeInvoice.Get('MN01');
        Assert.AreEqual(835.57, FeeInvoice."Total Handling Fee", 'Expected the total handling fee on a many-line invoice to equal the stated percentage applied to the invoice''s own net total, not the sum of each line''s own independently rounded fee');
        Assert.AreEqual(835.57, Allocator.GetCalculatedFeeTotal('MN01'), 'Expected the recorded line fees on a many-line invoice to sum to exactly the total handling fee');
    end;

    [Test]
    procedure EveryLineFeeStaysWithinOneCentOfItsExactShareOfTheStatedPercentage()
    var
        Allocator: Codeunit "CG X171 Fee Allocator";
        NetAmount: array[5] of Decimal;
        Pct: Decimal;
        ExactShare: Decimal;
        Deviation: Decimal;
        i: Integer;
    begin
        ClearAllData();
        Pct := 7.25;
        NetAmount[1] := 166.28;
        NetAmount[2] := 614.28;
        NetAmount[3] := 651.96;
        NetAmount[4] := 772.95;
        NetAmount[5] := 661.35;

        SeedInvoice('BD01', Pct);
        for i := 1 to 5 do
            SeedLine('BD01', i, StrSubstNo('Item %1', i), NetAmount[i]);

        Allocator.CalculateFees('BD01');

        for i := 1 to 5 do begin
            ExactShare := NetAmount[i] * Pct / 100;
            Deviation := GetLineFee('BD01', i) - ExactShare;
            if Deviation < 0 then
                Deviation := -Deviation;
            Assert.IsTrue(Deviation <= 0.01, StrSubstNo('Expected line %1''s handling fee to stay within a cent of its own exact percentage share', i));
        end;
    end;

    [Test]
    procedure ALineWithNoNetAmountAlwaysReceivesExactlyZeroFee()
    var
        Allocator: Codeunit "CG X171 Fee Allocator";
        FeeInvoice: Record "CG X171 Fee Invoice";
    begin
        ClearAllData();
        SeedInvoice('ZA01', 4.25);
        SeedLine('ZA01', 1, 'Item P', 490.98);
        SeedLine('ZA01', 2, 'Item Q', 100.52);
        SeedLine('ZA01', 3, 'Item R', 798.80);
        SeedLine('ZA01', 4, 'Item S', 691.66);
        SeedLine('ZA01', 5, 'Sample T (no charge)', 0.00);

        Allocator.CalculateFees('ZA01');

        FeeInvoice.Get('ZA01');
        Assert.AreEqual(88.48, FeeInvoice."Total Handling Fee", 'Expected the total handling fee to equal the stated percentage applied to the invoice''s own net total');
        Assert.AreEqual(20.87, GetLineFee('ZA01', 1), 'Expected a line''s handling fee to depend only on the invoice''s own net amounts and percentage');
        Assert.AreEqual(4.27, GetLineFee('ZA01', 2), 'Expected a line''s handling fee to depend only on the invoice''s own net amounts and percentage');
        Assert.AreEqual(33.95, GetLineFee('ZA01', 3), 'Expected a line''s handling fee to depend only on the invoice''s own net amounts and percentage');
        Assert.AreEqual(29.39, GetLineFee('ZA01', 4), 'Expected a line''s handling fee to depend only on the invoice''s own net amounts and percentage');
        Assert.AreEqual(0.00, GetLineFee('ZA01', 5), 'Expected a line with no net amount to receive a handling fee of exactly zero');
        Assert.AreEqual(88.48, Allocator.GetCalculatedFeeTotal('ZA01'), 'Expected the recorded line fees to sum to exactly the total handling fee');
    end;

    [Test]
    procedure RecalculatingWithADifferentFeePercentageReplacesThePreviousFeesCleanly()
    var
        Allocator: Codeunit "CG X171 Fee Allocator";
        FeeInvoice: Record "CG X171 Fee Invoice";
    begin
        ClearAllData();
        SeedInvoice('RP01', 5.00);
        SeedLine('RP01', 1, 'Widget A', 100.00);
        SeedLine('RP01', 2, 'Widget B', 200.00);

        Allocator.CalculateFees('RP01');

        FeeInvoice.Get('RP01');
        Assert.AreEqual(15.00, FeeInvoice."Total Handling Fee", 'Expected the initial calculation to apply the invoice''s starting percentage');

        FeeInvoice."Handling Fee Pct" := 20.00;
        FeeInvoice.Modify();
        Allocator.CalculateFees('RP01');

        FeeInvoice.Get('RP01');
        Assert.AreEqual(60.00, FeeInvoice."Total Handling Fee", 'Expected recalculating after the percentage changed to replace the total handling fee, not add to it');
        Assert.AreEqual(20.00, GetLineFee('RP01', 1), 'Expected recalculating after the percentage changed to replace each line''s handling fee, not add to it');
        Assert.AreEqual(40.00, GetLineFee('RP01', 2), 'Expected recalculating after the percentage changed to replace each line''s handling fee, not add to it');
        Assert.AreEqual(60.00, Allocator.GetCalculatedFeeTotal('RP01'), 'Expected the recorded line fees to sum to exactly the total handling fee after recalculating');
    end;

    [Test]
    procedure ZeroPercentInvoiceLeavesEveryLineFeeAndTheDocumentFeeAtExactlyZero()
    var
        Allocator: Codeunit "CG X171 Fee Allocator";
        FeeInvoice: Record "CG X171 Fee Invoice";
    begin
        ClearAllData();
        SeedInvoice('ZP01', 0.00);
        SeedLine('ZP01', 1, 'Widget A', 500.00);
        SeedLine('ZP01', 2, 'Widget B', 300.00);
        SeedLine('ZP01', 3, 'Widget C', 150.00);

        Allocator.CalculateFees('ZP01');

        FeeInvoice.Get('ZP01');
        Assert.AreEqual(0.00, FeeInvoice."Total Handling Fee", 'Expected an invoice with no handling fee percentage to have a total handling fee of exactly zero');
        Assert.AreEqual(0.00, GetLineFee('ZP01', 1), 'Expected a zero handling fee percentage to leave every line''s handling fee at exactly zero');
        Assert.AreEqual(0.00, GetLineFee('ZP01', 2), 'Expected a zero handling fee percentage to leave every line''s handling fee at exactly zero');
        Assert.AreEqual(0.00, GetLineFee('ZP01', 3), 'Expected a zero handling fee percentage to leave every line''s handling fee at exactly zero');
        Assert.IsTrue(FeeInvoice."Fees Calculated", 'Expected an invoice with net amount but a zero percentage to still be marked as calculated');
    end;

    [Test]
    procedure DeterministicSweepMatchesTheReferenceFeeCalculationAcrossManyPartitions()
    var
        Allocator: Codeunit "CG X171 Fee Allocator";
        Any: Codeunit Any;
        FeeInvoice: Record "CG X171 Fee Invoice";
        LineNo: array[13] of Integer;
        NetAmount: array[13] of Decimal;
        ExpectedLineFee: array[13] of Decimal;
        ExpectedDocumentFee: Decimal;
        DocumentNo: Code[20];
        Pct: Decimal;
        SumOfFees: Decimal;
        LineCount: Integer;
        Partition: Integer;
        i: Integer;
    begin
        Any.SetSeed(171);

        for Partition := 1 to 6 do begin
            ClearAllData();
            DocumentNo := 'SW' + Format(Partition);
            LineCount := Any.IntegerInRange(6, 12);
            Pct := Any.IntegerInRange(100, 2500) / 100;
            SeedInvoice(DocumentNo, Pct);

            for i := 1 to LineCount do begin
                LineNo[i] := i;
                // Roughly every fourth line on a sweep partition carries no
                // net amount at all - a free sample line with nothing to
                // charge a handling fee against.
                if i mod 4 = 0 then
                    NetAmount[i] := 0
                else
                    NetAmount[i] := Any.IntegerInRange(100, 500000) / 100;
                SeedLine(DocumentNo, i, StrSubstNo('Sweep line %1', i), NetAmount[i]);
            end;

            Allocator.CalculateFees(DocumentNo);
            ComputeExpectedFees(NetAmount, LineNo, LineCount, Pct, ExpectedDocumentFee, ExpectedLineFee);

            FeeInvoice.Get(DocumentNo);
            Assert.AreEqual(
              ExpectedDocumentFee, FeeInvoice."Total Handling Fee",
              StrSubstNo('Expected the total handling fee on sweep partition %1 to equal the stated percentage applied to the invoice''s own net total', Partition));

            SumOfFees := 0;
            for i := 1 to LineCount do begin
                Assert.AreEqual(
                  ExpectedLineFee[i], GetLineFee(DocumentNo, LineNo[i]),
                  StrSubstNo('Expected line %1 of sweep partition %2 to depend only on that invoice''s own net amounts and percentage', LineNo[i], Partition));
                SumOfFees += GetLineFee(DocumentNo, LineNo[i]);
            end;
            Assert.AreEqual(
              ExpectedDocumentFee, SumOfFees,
              StrSubstNo('Expected the recorded line fees on sweep partition %1 to sum to exactly the total handling fee', Partition));
        end;
    end;
}
