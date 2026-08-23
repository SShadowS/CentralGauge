codeunit 88832 "CG-AL-X079 Test"
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
        ChargeHeader: Record "CG X079 Charge Header";
        ChargeLine: Record "CG X079 Charge Line";
    begin
        ChargeLine.DeleteAll();
        ChargeHeader.DeleteAll();
    end;

    local procedure SeedHeader(DocumentNo: Code[20]; TotalAmount: Decimal)
    var
        ChargeHeader: Record "CG X079 Charge Header";
    begin
        ChargeHeader.Init();
        ChargeHeader."No." := DocumentNo;
        ChargeHeader."Charge Description" := 'Test charge';
        ChargeHeader."Total Charge Amount" := TotalAmount;
        ChargeHeader.Insert();
    end;

    local procedure SeedLine(DocumentNo: Code[20]; LineNo: Integer; LineWeight: Decimal)
    var
        ChargeLine: Record "CG X079 Charge Line";
    begin
        ChargeLine.Init();
        ChargeLine."Document No." := DocumentNo;
        ChargeLine."Line No." := LineNo;
        ChargeLine.Weight := LineWeight;
        ChargeLine.Insert();
    end;

    local procedure SeedLineWithSentinel(DocumentNo: Code[20]; LineNo: Integer; LineWeight: Decimal; SentinelAmount: Decimal)
    var
        ChargeLine: Record "CG X079 Charge Line";
    begin
        ChargeLine.Init();
        ChargeLine."Document No." := DocumentNo;
        ChargeLine."Line No." := LineNo;
        ChargeLine.Weight := LineWeight;
        ChargeLine."Allocated Amount" := SentinelAmount;
        ChargeLine.Insert();
    end;

    // Re-reads the header and all of its lines from the database and checks
    // every guarantee an allocation must satisfy: the recorded amounts sum
    // to exactly the header total, every amount is a whole number of cents,
    // and every line stays within a cent of its exact proportional share -
    // so neither a naive independent rounding nor a fix that dumps the
    // whole correction onto a single line can pass.
    local procedure VerifyAllocationBalances(DocumentNo: Code[20]; TotalAmount: Decimal)
    var
        ChargeLine: Record "CG X079 Charge Line";
        WeightSum: Decimal;
        SumOfAmounts: Decimal;
        ExactShare: Decimal;
    begin
        ChargeLine.SetRange("Document No.", DocumentNo);
        if ChargeLine.FindSet() then
            repeat
                WeightSum += ChargeLine.Weight;
            until ChargeLine.Next() = 0;

        ChargeLine.SetRange("Document No.", DocumentNo);
        if ChargeLine.FindSet() then
            repeat
                SumOfAmounts += ChargeLine."Allocated Amount";
            until ChargeLine.Next() = 0;

        Assert.AreEqual(
          TotalAmount, SumOfAmounts,
          StrSubstNo('Expected the allocated amounts on charge %1 to sum to exactly its total %2, not a cent more or less', DocumentNo, TotalAmount));

        ChargeLine.SetRange("Document No.", DocumentNo);
        if ChargeLine.FindSet() then
            repeat
                Assert.AreEqual(
                  Round(ChargeLine."Allocated Amount", 0.01), ChargeLine."Allocated Amount",
                  StrSubstNo('Expected the amount on line %1 of charge %2 to be a whole number of cents', ChargeLine."Line No.", DocumentNo));
                ExactShare := TotalAmount * ChargeLine.Weight / WeightSum;
                Assert.IsTrue(
                  Abs(ChargeLine."Allocated Amount" - ExactShare) < 0.01,
                  StrSubstNo(
                    'Expected line %1 of charge %2 to stay within a cent of its fair share %3, got %4',
                    ChargeLine."Line No.", DocumentNo, ExactShare, ChargeLine."Allocated Amount"));
            until ChargeLine.Next() = 0;
    end;

    [Test]
    procedure SingleLineChargeGetsTheEntireTotal()
    var
        ChargeLine: Record "CG X079 Charge Line";
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        ClearAllData();
        SeedHeader('SL01', 123.45);
        SeedLine('SL01', 1, 7.5);

        Allocator.AllocateCharge('SL01');

        ChargeLine.Get('SL01', 1);
        Assert.AreEqual(123.45, ChargeLine."Allocated Amount", 'Expected a charge with a single line to allocate its entire total to that line');
    end;

    [Test]
    procedure ThreeEqualWeightLinesSumExactlyToTheTotal()
    var
        ChargeHeader: Record "CG X079 Charge Header";
        ChargeLine: Record "CG X079 Charge Line";
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        ClearAllData();
        SeedHeader('TW01', 100.00);
        SeedLine('TW01', 1, 1);
        SeedLine('TW01', 2, 1);
        SeedLine('TW01', 3, 1);

        // A second charge, seeded with its own nonzero sentinel amounts and
        // left alone - proves allocating one charge does not disturb
        // another charge's recorded amounts or Allocated flag.
        SeedHeader('TW02', 250.00);
        SeedLineWithSentinel('TW02', 1, 1, 111.11);
        SeedLineWithSentinel('TW02', 2, 1, 222.22);

        Allocator.AllocateCharge('TW01');

        VerifyAllocationBalances('TW01', 100.00);
        Assert.AreEqual(
          100.00, Allocator.GetAllocatedTotal('TW01'),
          'Expected the reconciliation total for the charge to equal its header total after allocating');

        ChargeHeader.Get('TW02');
        Assert.IsFalse(ChargeHeader.Allocated, 'Expected a charge that was not allocated to stay unallocated');
        ChargeLine.Get('TW02', 1);
        Assert.AreEqual(
          111.11, ChargeLine."Allocated Amount",
          'Expected another charge''s line amount to be left untouched by allocating a different charge');
        ChargeLine.Get('TW02', 2);
        Assert.AreEqual(
          222.22, ChargeLine."Allocated Amount",
          'Expected another charge''s line amount to be left untouched by allocating a different charge');
    end;

    [Test]
    procedure SixEqualWeightLinesWithHalfCentSharesSumExactlyToTheTotal()
    var
        Allocator: Codeunit "CG X079 Charge Allocator";
        i: Integer;
    begin
        // Every line's exact share (0.99 / 6 = 0.165) ends in half a cent,
        // so independent per-line rounding drifts by three cents in total -
        // exactly the pattern finance flagged.
        ClearAllData();
        SeedHeader('HC01', 0.99);
        for i := 1 to 6 do
            SeedLine('HC01', i, 1);

        Allocator.AllocateCharge('HC01');

        VerifyAllocationBalances('HC01', 0.99);
    end;

    [Test]
    procedure UnequalFinelyWeightedLinesSumExactlyToTheTotal()
    var
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        // Weights carried to five decimal places, none of them a round or
        // repeating fraction - a fix that only special-cases equal-weight
        // splits or exact half-cent shares still has to get this right.
        ClearAllData();
        SeedHeader('FP01', 143.99);
        SeedLine('FP01', 1, 5.39998);
        SeedLine('FP01', 2, 16.05634);
        SeedLine('FP01', 3, 11.86395);

        Allocator.AllocateCharge('FP01');

        VerifyAllocationBalances('FP01', 143.99);
    end;

    [Test]
    procedure UnequalWeightsWithTwoHalfCentSharesSumExactlyToTheTotal()
    var
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        // Two of the three exact shares (40.005 and 39.995) sit exactly on
        // a half-cent boundary in opposite directions; the strict per-line
        // bound in VerifyAllocationBalances means the correction cannot be
        // parked entirely on any single line here without that line's
        // amount landing a full cent from its own whole-cent fair share.
        ClearAllData();
        SeedHeader('HB01', 100.00);
        SeedLine('HB01', 1, 20.000);
        SeedLine('HB01', 2, 40.005);
        SeedLine('HB01', 3, 39.995);

        Allocator.AllocateCharge('HB01');

        VerifyAllocationBalances('HB01', 100.00);
    end;

    [Test]
    procedure TenLinesWithFinelyWeightedSharesSumExactlyToTheTotal()
    var
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        ClearAllData();
        SeedHeader('FP10', 1000.00);
        SeedLine('FP10', 1, 32.15163);
        SeedLine('FP10', 2, 1.73803);
        SeedLine('FP10', 3, 14.11395);
        SeedLine('FP10', 4, 11.54893);
        SeedLine('FP10', 5, 36.95533);
        SeedLine('FP10', 6, 33.99662);
        SeedLine('FP10', 7, 44.66289);
        SeedLine('FP10', 8, 4.80347);
        SeedLine('FP10', 9, 21.38513);
        SeedLine('FP10', 10, 1.97496);

        Allocator.AllocateCharge('FP10');

        VerifyAllocationBalances('FP10', 1000.00);
    end;

    [Test]
    procedure ZeroWeightLineReceivesExactlyZero()
    var
        ChargeLine: Record "CG X079 Charge Line";
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        ClearAllData();
        SeedHeader('ZW02', 99.99);
        SeedLine('ZW02', 1, 5);
        SeedLine('ZW02', 2, 0);
        SeedLine('ZW02', 3, 3);

        Allocator.AllocateCharge('ZW02');

        ChargeLine.Get('ZW02', 2);
        Assert.AreEqual(
          0.0, ChargeLine."Allocated Amount",
          'Expected a line with no weight to be allocated exactly zero, even though other lines on the same charge carry a nonzero total');
        VerifyAllocationBalances('ZW02', 99.99);
    end;

    [Test]
    procedure NegativeTotalCreditMemoSumsExactlyToTheTotal()
    var
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        ClearAllData();
        SeedHeader('CM01', -100.01);
        SeedLine('CM01', 1, 2);
        SeedLine('CM01', 2, 1);

        Allocator.AllocateCharge('CM01');

        VerifyAllocationBalances('CM01', -100.01);
    end;

    [Test]
    procedure SuccessfulAllocationMarksTheChargeAllocated()
    var
        ChargeHeader: Record "CG X079 Charge Header";
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        ClearAllData();
        SeedHeader('MK01', 40.00);
        SeedLine('MK01', 1, 1);
        SeedLine('MK01', 2, 1);

        Allocator.AllocateCharge('MK01');

        ChargeHeader.Get('MK01');
        Assert.IsTrue(ChargeHeader.Allocated, 'Expected a charge with at least one weighted line to be marked allocated');
    end;

    [Test]
    procedure AChargeWithNoWeightOnAnyLineIsLeftUnallocated()
    var
        ChargeHeader: Record "CG X079 Charge Header";
        ChargeLine: Record "CG X079 Charge Line";
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        ClearAllData();
        SeedHeader('ZW01', 50.00);
        SeedLineWithSentinel('ZW01', 1, 0, 555.55);
        SeedLineWithSentinel('ZW01', 2, 0, 444.44);

        Allocator.AllocateCharge('ZW01');

        ChargeHeader.Get('ZW01');
        Assert.IsFalse(ChargeHeader.Allocated, 'Expected a charge with no weight on any line to be left unallocated');

        ChargeLine.Get('ZW01', 1);
        Assert.AreEqual(
          555.55, ChargeLine."Allocated Amount",
          'Expected a line''s existing amount to be left untouched when the charge has no weight to allocate');
        ChargeLine.Get('ZW01', 2);
        Assert.AreEqual(
          444.44, ChargeLine."Allocated Amount",
          'Expected a line''s existing amount to be left untouched when the charge has no weight to allocate');
    end;

    [Test]
    procedure RandomChargeKeepsEveryLineWithinItsFairShare()
    var
        Allocator: Codeunit "CG X079 Charge Allocator";
        Any: Codeunit Any;
        TotalAmount: Decimal;
        i: Integer;
    begin
        ClearAllData();
        Any.SetSeed(79);
        TotalAmount := Any.IntegerInRange(10000, 999999) / 100;
        SeedHeader('RND01', TotalAmount);
        for i := 1 to 9 do
            SeedLine('RND01', i, Any.DecimalInRange(1, 500, 2));

        Allocator.AllocateCharge('RND01');

        VerifyAllocationBalances('RND01', TotalAmount);
    end;
}
