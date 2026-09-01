codeunit 89493 "CG-AL-X271 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;
    EventSubscriberInstance = Manual;

    // This oracle merges 8 independent modules' test suites into one
    // codeunit. Every test and helper procedure is prefixed with the module
    // it belongs to so identical helper names across the source suites cannot
    // collide. Assembled from already-gated donors; see NOTES.md.

    var
        Assert: Codeunit Assert;
        // The default test isolation persists writes between test methods
        // (measured 2026-08-20, SOAP runner), so every test clears both tables
        // before seeding its own rows.
        // The default test isolation persists writes between test methods, so
        // every test clears both tables before seeding its own rows. Pre-existing
        // batches are always seeded Closed - a nonzero sentinel that a freshly
        // rebuilt header (always Open) cannot be confused with - so "left alone"
        // and "rebuilt" are never ambiguous from Status alone.
        // every test clears the table before seeding its own rows.
        // A block list kept in memory for the rest of the session does not roll
        // back with the test transaction, so every test clears both the table
        // and that in-memory copy before seeding its own data.
        // every test clears its own tables before seeding its own rows.
        // (measured 2026-08-20, SOAP runner), so every test clears all three
        // tables before seeding its own rows.

    // ==========================================================
    // X067 - donor CG-AL-X067
    // ==========================================================

    local procedure X067_Activate(var Promotion: Codeunit "CG X067 Free Freight Promotion")
    var
        Bound: Boolean;
    begin
        Bound := BindSubscription(Promotion);
    end;

    local procedure X067_Deactivate(var Promotion: Codeunit "CG X067 Free Freight Promotion")
    var
        Unbound: Boolean;
    begin
        Unbound := UnbindSubscription(Promotion);
    end;

    local procedure X067_ActivateFreightOverride(var Override: Codeunit "CG-AL-X271 Test")
    var
        Bound: Boolean;
    begin
        Bound := BindSubscription(Override);
    end;

    local procedure X067_DeactivateFreightOverride(var Override: Codeunit "CG-AL-X271 Test")
    var
        Unbound: Boolean;
    begin
        Unbound := UnbindSubscription(Override);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CG X067 Freight Calculator", 'OnBeforeCalculateFreight', '', false, false)]
    local procedure X067_ApplyAFlatFreightOverride(Amount: Decimal; var Freight: Decimal; var IsHandled: Boolean)
    begin
        Freight := 42.5;
        IsHandled := true;
    end;

    [Test]
    procedure X067_DefaultFreightAppliesForOrdersUnderTheThreshold()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
        Any: Codeunit Any;
        Amount: Decimal;
    begin
        // [SCENARIO] Nothing has activated the promotion, and the order is small
        Amount := Any.DecimalInRange(100, 900, 2);

        Assert.AreEqual(Round(Amount * 0.1, 0.01), Calculator.CalculateFreight(Amount),
            StrSubstNo('Expected the standard charge for an order of %1 with the promotion not activated', Amount));
    end;

    [Test]
    procedure X067_DefaultFreightAppliesJustBelowTheThresholdWhenNotActivated()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
    begin
        // [SCENARIO] One cent below the threshold, still not activated
        Assert.AreEqual(100.00, Calculator.CalculateFreight(999.99),
            'Expected the standard charge for 999.99 with the promotion not activated - the threshold is 1000, one cent below it must not qualify');
    end;

    [Test]
    procedure X067_LargeOrdersPayDefaultFreightWhenThePromotionHasNotBeenActivated()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
        Any: Codeunit Any;
        Amount: Decimal;
    begin
        // [SCENARIO] A large order, but nothing has activated the promotion for this call
        Amount := Any.DecimalInRange(1001, 5000, 2);

        Assert.AreEqual(Round(Amount * 0.1, 0.01), Calculator.CalculateFreight(Amount),
            StrSubstNo('Expected the standard charge for a large order of %1 while the promotion has NOT been activated for this call', Amount));
    end;

    [Test]
    procedure X067_LargeOrdersPayDefaultFreightAtExactlyTheThresholdWhenNotActivated()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
    begin
        // [SCENARIO] Exactly at the threshold, still not activated
        Assert.AreEqual(100.00, Calculator.CalculateFreight(1000),
            'Expected the standard charge for an order of exactly 1000 while the promotion has NOT been activated for this call');
    end;

    [Test]
    procedure X067_ActivatedPromotionGrantsFreeFreightFromTheThresholdUpward()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
        Promotion: Codeunit "CG X067 Free Freight Promotion";
        Any: Codeunit Any;
        Amount: Decimal;
    begin
        // [SCENARIO] The caller has explicitly activated the promotion for this call
        X067_Activate(Promotion);

        Assert.AreEqual(0, Calculator.CalculateFreight(1000),
            'Expected free freight for an order of exactly 1000 while the promotion is activated for this call');

        Amount := Any.DecimalInRange(1001, 5000, 2);
        Assert.AreEqual(0, Calculator.CalculateFreight(Amount),
            StrSubstNo('Expected free freight for an order of %1 while the promotion is activated for this call', Amount));

        X067_Deactivate(Promotion);
    end;

    [Test]
    procedure X067_ActivatedPromotionLeavesOrdersBelowTheThresholdAtTheDefaultCharge()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
        Promotion: Codeunit "CG X067 Free Freight Promotion";
        Any: Codeunit Any;
        Amount: Decimal;
    begin
        // [SCENARIO] Activated, but the order does not reach the threshold
        X067_Activate(Promotion);
        Amount := Any.DecimalInRange(100, 900, 2);

        Assert.AreEqual(Round(Amount * 0.1, 0.01), Calculator.CalculateFreight(Amount),
            StrSubstNo('Expected the standard charge for an order of %1 - below the threshold, the activated promotion must still leave it alone', Amount));

        X067_Deactivate(Promotion);
    end;

    [Test]
    procedure X067_CalculatedFreightReflectsTheAmountAnActiveOverrideSets()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
        Override: Codeunit "CG-AL-X271 Test";
    begin
        // [SCENARIO] A subscriber other than the promotion has taken over this call and set its own charge
        X067_ActivateFreightOverride(Override);

        Assert.AreEqual(42.5, Calculator.CalculateFreight(1),
            'Expected the returned charge to reflect the amount an active override sets, not a fixed zero');

        X067_DeactivateFreightOverride(Override);
    end;

    // ==========================================================
    // X079 - donor CG-AL-X079
    // ==========================================================

    local procedure X079_ClearAllData()
    var
        ChargeHeader: Record "CG X079 Charge Header";
        ChargeLine: Record "CG X079 Charge Line";
    begin
        ChargeLine.DeleteAll();
        ChargeHeader.DeleteAll();
    end;

    local procedure X079_SeedHeader(DocumentNo: Code[20]; TotalAmount: Decimal)
    var
        ChargeHeader: Record "CG X079 Charge Header";
    begin
        ChargeHeader.Init();
        ChargeHeader."No." := DocumentNo;
        ChargeHeader."Charge Description" := 'Test charge';
        ChargeHeader."Total Charge Amount" := TotalAmount;
        ChargeHeader.Insert();
    end;

    local procedure X079_SeedLine(DocumentNo: Code[20]; LineNo: Integer; LineWeight: Decimal)
    var
        ChargeLine: Record "CG X079 Charge Line";
    begin
        ChargeLine.Init();
        ChargeLine."Document No." := DocumentNo;
        ChargeLine."Line No." := LineNo;
        ChargeLine.Weight := LineWeight;
        ChargeLine.Insert();
    end;

    local procedure X079_SeedLineWithSentinel(DocumentNo: Code[20]; LineNo: Integer; LineWeight: Decimal; SentinelAmount: Decimal)
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
    local procedure X079_VerifyAllocationBalances(DocumentNo: Code[20]; TotalAmount: Decimal)
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
    procedure X079_SingleLineChargeGetsTheEntireTotal()
    var
        ChargeLine: Record "CG X079 Charge Line";
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        X079_ClearAllData();
        X079_SeedHeader('SL01', 123.45);
        X079_SeedLine('SL01', 1, 7.5);

        Allocator.AllocateCharge('SL01');

        ChargeLine.Get('SL01', 1);
        Assert.AreEqual(123.45, ChargeLine."Allocated Amount", 'Expected a charge with a single line to allocate its entire total to that line');
    end;

    [Test]
    procedure X079_ThreeEqualWeightLinesSumExactlyToTheTotal()
    var
        ChargeHeader: Record "CG X079 Charge Header";
        ChargeLine: Record "CG X079 Charge Line";
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        X079_ClearAllData();
        X079_SeedHeader('TW01', 100.00);
        X079_SeedLine('TW01', 1, 1);
        X079_SeedLine('TW01', 2, 1);
        X079_SeedLine('TW01', 3, 1);

        // A second charge, seeded with its own nonzero sentinel amounts and
        // left alone - proves allocating one charge does not disturb
        // another charge's recorded amounts or Allocated flag.
        X079_SeedHeader('TW02', 250.00);
        X079_SeedLineWithSentinel('TW02', 1, 1, 111.11);
        X079_SeedLineWithSentinel('TW02', 2, 1, 222.22);

        Allocator.AllocateCharge('TW01');

        X079_VerifyAllocationBalances('TW01', 100.00);
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
    procedure X079_SixEqualWeightLinesWithHalfCentSharesSumExactlyToTheTotal()
    var
        Allocator: Codeunit "CG X079 Charge Allocator";
        i: Integer;
    begin
        // Every line's exact share (0.99 / 6 = 0.165) ends in half a cent,
        // so independent per-line rounding drifts by three cents in total -
        // exactly the pattern finance flagged.
        X079_ClearAllData();
        X079_SeedHeader('HC01', 0.99);
        for i := 1 to 6 do
            X079_SeedLine('HC01', i, 1);

        Allocator.AllocateCharge('HC01');

        X079_VerifyAllocationBalances('HC01', 0.99);
    end;

    [Test]
    procedure X079_UnequalFinelyWeightedLinesSumExactlyToTheTotal()
    var
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        // Weights carried to five decimal places, none of them a round or
        // repeating fraction - a fix that only special-cases equal-weight
        // splits or exact half-cent shares still has to get this right.
        X079_ClearAllData();
        X079_SeedHeader('FP01', 143.99);
        X079_SeedLine('FP01', 1, 5.39998);
        X079_SeedLine('FP01', 2, 16.05634);
        X079_SeedLine('FP01', 3, 11.86395);

        Allocator.AllocateCharge('FP01');

        X079_VerifyAllocationBalances('FP01', 143.99);
    end;

    [Test]
    procedure X079_UnequalWeightsWithTwoHalfCentSharesSumExactlyToTheTotal()
    var
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        // Two of the three exact shares (40.005 and 39.995) sit exactly on
        // a half-cent boundary in opposite directions; the strict per-line
        // bound in VerifyAllocationBalances means the correction cannot be
        // parked entirely on any single line here without that line's
        // amount landing a full cent from its own whole-cent fair share.
        X079_ClearAllData();
        X079_SeedHeader('HB01', 100.00);
        X079_SeedLine('HB01', 1, 20.000);
        X079_SeedLine('HB01', 2, 40.005);
        X079_SeedLine('HB01', 3, 39.995);

        Allocator.AllocateCharge('HB01');

        X079_VerifyAllocationBalances('HB01', 100.00);
    end;

    [Test]
    procedure X079_TenLinesWithFinelyWeightedSharesSumExactlyToTheTotal()
    var
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        X079_ClearAllData();
        X079_SeedHeader('FP10', 1000.00);
        X079_SeedLine('FP10', 1, 32.15163);
        X079_SeedLine('FP10', 2, 1.73803);
        X079_SeedLine('FP10', 3, 14.11395);
        X079_SeedLine('FP10', 4, 11.54893);
        X079_SeedLine('FP10', 5, 36.95533);
        X079_SeedLine('FP10', 6, 33.99662);
        X079_SeedLine('FP10', 7, 44.66289);
        X079_SeedLine('FP10', 8, 4.80347);
        X079_SeedLine('FP10', 9, 21.38513);
        X079_SeedLine('FP10', 10, 1.97496);

        Allocator.AllocateCharge('FP10');

        X079_VerifyAllocationBalances('FP10', 1000.00);
    end;

    [Test]
    procedure X079_ZeroWeightLineReceivesExactlyZero()
    var
        ChargeLine: Record "CG X079 Charge Line";
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        X079_ClearAllData();
        X079_SeedHeader('ZW02', 99.99);
        X079_SeedLine('ZW02', 1, 5);
        X079_SeedLine('ZW02', 2, 0);
        X079_SeedLine('ZW02', 3, 3);

        Allocator.AllocateCharge('ZW02');

        ChargeLine.Get('ZW02', 2);
        Assert.AreEqual(
          0.0, ChargeLine."Allocated Amount",
          'Expected a line with no weight to be allocated exactly zero, even though other lines on the same charge carry a nonzero total');
        X079_VerifyAllocationBalances('ZW02', 99.99);
    end;

    [Test]
    procedure X079_NegativeTotalCreditMemoSumsExactlyToTheTotal()
    var
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        X079_ClearAllData();
        X079_SeedHeader('CM01', -100.01);
        X079_SeedLine('CM01', 1, 2);
        X079_SeedLine('CM01', 2, 1);

        Allocator.AllocateCharge('CM01');

        X079_VerifyAllocationBalances('CM01', -100.01);
    end;

    [Test]
    procedure X079_SuccessfulAllocationMarksTheChargeAllocated()
    var
        ChargeHeader: Record "CG X079 Charge Header";
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        X079_ClearAllData();
        X079_SeedHeader('MK01', 40.00);
        X079_SeedLine('MK01', 1, 1);
        X079_SeedLine('MK01', 2, 1);

        Allocator.AllocateCharge('MK01');

        ChargeHeader.Get('MK01');
        Assert.IsTrue(ChargeHeader.Allocated, 'Expected a charge with at least one weighted line to be marked allocated');
    end;

    [Test]
    procedure X079_AChargeWithNoWeightOnAnyLineIsLeftUnallocated()
    var
        ChargeHeader: Record "CG X079 Charge Header";
        ChargeLine: Record "CG X079 Charge Line";
        Allocator: Codeunit "CG X079 Charge Allocator";
    begin
        X079_ClearAllData();
        X079_SeedHeader('ZW01', 50.00);
        X079_SeedLineWithSentinel('ZW01', 1, 0, 555.55);
        X079_SeedLineWithSentinel('ZW01', 2, 0, 444.44);

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
    procedure X079_RandomChargeKeepsEveryLineWithinItsFairShare()
    var
        Allocator: Codeunit "CG X079 Charge Allocator";
        Any: Codeunit Any;
        TotalAmount: Decimal;
        i: Integer;
    begin
        X079_ClearAllData();
        Any.SetSeed(79);
        TotalAmount := Any.IntegerInRange(10000, 999999) / 100;
        X079_SeedHeader('RND01', TotalAmount);
        for i := 1 to 9 do
            X079_SeedLine('RND01', i, Any.DecimalInRange(1, 500, 2));

        Allocator.AllocateCharge('RND01');

        X079_VerifyAllocationBalances('RND01', TotalAmount);
    end;

    // ==========================================================
    // X085 - donor CG-AL-X085
    // ==========================================================

    local procedure X085_Reset()
    var
        BatchHeader: Record "CG X085 Batch Header";
        ReissueSetup: Record "CG X085 Reissue Setup";
    begin
        BatchHeader.DeleteAll();
        ReissueSetup.DeleteAll();
    end;

    local procedure X085_SeedSetup(TemplateCode: Code[20]; DefaultDescription: Text[100])
    var
        ReissueSetup: Record "CG X085 Reissue Setup";
    begin
        ReissueSetup.Init();
        ReissueSetup."Default Batch Template" := TemplateCode;
        ReissueSetup."Default Description" := DefaultDescription;
        ReissueSetup.Insert();
    end;

    local procedure X085_SeedBatch(No: Code[20]; ExistingDescription: Text[100]; ExistingTemplateCode: Code[20]; ExistingCreatedDate: Date)
    var
        BatchHeader: Record "CG X085 Batch Header";
    begin
        BatchHeader.Init();
        BatchHeader."No." := No;
        BatchHeader.Description := ExistingDescription;
        BatchHeader."Template Code" := ExistingTemplateCode;
        BatchHeader."Created Date" := ExistingCreatedDate;
        BatchHeader.Status := BatchHeader.Status::Closed;
        BatchHeader.Insert();
    end;

    local procedure X085_AssertRebuilt(No: Code[20]; ExpectedDescription: Text[100]; ExpectedTemplateCode: Code[20]; Msg: Text)
    var
        BatchHeader: Record "CG X085 Batch Header";
    begin
        Assert.IsTrue(BatchHeader.Get(No), StrSubstNo('Expected a header to exist for batch %1: %2', No, Msg));
        Assert.AreEqual(ExpectedDescription, BatchHeader.Description, Msg + ' (description)');
        Assert.AreEqual(ExpectedTemplateCode, BatchHeader."Template Code", Msg + ' (template code)');
        Assert.AreEqual(Today, BatchHeader."Created Date", Msg + ' (created date)');
        Assert.AreEqual(Format(BatchHeader.Status::Open), Format(BatchHeader.Status), Msg + ' (status)');
    end;

    local procedure X085_AssertUnchanged(No: Code[20]; ExpectedDescription: Text[100]; ExpectedTemplateCode: Code[20]; ExpectedCreatedDate: Date; Msg: Text)
    var
        BatchHeader: Record "CG X085 Batch Header";
    begin
        Assert.IsTrue(BatchHeader.Get(No), StrSubstNo('Expected batch %1 to still have a header: %2', No, Msg));
        Assert.AreEqual(ExpectedDescription, BatchHeader.Description, Msg + ' (description)');
        Assert.AreEqual(ExpectedTemplateCode, BatchHeader."Template Code", Msg + ' (template code)');
        Assert.AreEqual(ExpectedCreatedDate, BatchHeader."Created Date", Msg + ' (created date)');
        Assert.AreEqual(Format(BatchHeader.Status::Closed), Format(BatchHeader.Status), Msg + ' (status)');
    end;

    local procedure X085_AssertDoesNotExist(No: Code[20]; Msg: Text)
    var
        BatchHeader: Record "CG X085 Batch Header";
    begin
        Assert.IsFalse(BatchHeader.Get(No), Msg);
    end;

    local procedure X085_AssertErrorContains(Fragment: Text)
    var
        ActualError: Text;
    begin
        ActualError := GetLastErrorText();
        Assert.IsTrue(LowerCase(ActualError).Contains(LowerCase(Fragment)),
            StrSubstNo('Expected the error to mention "%1", got: %2', Fragment, ActualError));
    end;

    [Test]
    procedure X085_ReissueReplacesTheBatchWhenSetupIsComplete()
    var
        BatchReissueMgt: Codeunit "CG X085 Batch Reissue Mgt";
    begin
        X085_Reset();
        X085_SeedBatch('X85-B01', 'Old Description', 'OLD-TMPL', DMY2Date(1, 1, 2020));
        X085_SeedSetup('NEW-TMPL', 'Fresh Batch');

        BatchReissueMgt.Reissue('X85-B01');

        X085_AssertRebuilt('X85-B01', 'Fresh Batch', 'NEW-TMPL', 'A successful reissue must rebuild the batch from the configured template');
    end;

    [Test]
    procedure X085_AFailedReissueLeavesTheOldBatchInPlaceWhenSetupIsMissing()
    var
        BatchReissueMgt: Codeunit "CG X085 Batch Reissue Mgt";
        OldCreatedDate: Date;
    begin
        X085_Reset();
        OldCreatedDate := DMY2Date(15, 3, 2019);
        X085_SeedBatch('X85-B02', 'Sentinel Description', 'SENT-TMPL', OldCreatedDate);
        // No Reissue Setup record exists at all.
        Commit();

        asserterror BatchReissueMgt.Reissue('X85-B02');

        X085_AssertUnchanged('X85-B02', 'Sentinel Description', 'SENT-TMPL', OldCreatedDate,
            'A reissue that fails because the setup does not exist must leave the existing batch exactly as it was');
    end;

    [Test]
    procedure X085_AFailedReissueLeavesTheOldBatchInPlaceWhenTheTemplateIsBlank()
    var
        BatchReissueMgt: Codeunit "CG X085 Batch Reissue Mgt";
        OldCreatedDate: Date;
    begin
        X085_Reset();
        OldCreatedDate := DMY2Date(4, 7, 2018);
        X085_SeedBatch('X85-B03', 'Sentinel Description Two', 'SENT-TMPL-2', OldCreatedDate);
        X085_SeedSetup('', 'Some Description');
        Commit();

        asserterror BatchReissueMgt.Reissue('X85-B03');

        X085_AssertErrorContains('Default Batch Template');
        X085_AssertErrorContains('must have a value');
        X085_AssertUnchanged('X85-B03', 'Sentinel Description Two', 'SENT-TMPL-2', OldCreatedDate,
            'A reissue that fails because the template is blank must leave the existing batch exactly as it was');
    end;

    [Test]
    procedure X085_ARepairedSetupLetsAPreviouslyFailedBatchBeReissued()
    var
        BatchReissueMgt: Codeunit "CG X085 Batch Reissue Mgt";
        OldCreatedDate: Date;
    begin
        X085_Reset();
        OldCreatedDate := DMY2Date(9, 9, 2017);
        X085_SeedBatch('X85-B04', 'Original Description', 'ORIG-TMPL', OldCreatedDate);
        Commit();

        asserterror BatchReissueMgt.Reissue('X85-B04');
        X085_AssertUnchanged('X85-B04', 'Original Description', 'ORIG-TMPL', OldCreatedDate,
            'The first, failing attempt must not touch the existing batch');

        X085_SeedSetup('FIXED-TMPL', 'Repaired Batch');

        BatchReissueMgt.Reissue('X85-B04');

        X085_AssertRebuilt('X85-B04', 'Repaired Batch', 'FIXED-TMPL',
            'Once the setup is fixed, reissuing the same batch must rebuild it from the template with nothing left over from the failed attempt');
    end;

    [Test]
    procedure X085_ReissueOnlyAffectsTheGivenBatch()
    var
        BatchReissueMgt: Codeunit "CG X085 Batch Reissue Mgt";
        NeighbourCreatedDate: Date;
    begin
        X085_Reset();
        NeighbourCreatedDate := DMY2Date(2, 2, 2021);
        X085_SeedBatch('X85-B05A', 'Target Old', 'TGT-OLD', DMY2Date(1, 1, 2021));
        X085_SeedBatch('X85-B05B', 'Neighbour Description', 'NEI-TMPL', NeighbourCreatedDate);
        X085_SeedSetup('TGT-NEW', 'Target Rebuilt');

        BatchReissueMgt.Reissue('X85-B05A');

        X085_AssertRebuilt('X85-B05A', 'Target Rebuilt', 'TGT-NEW', 'The targeted batch must be rebuilt');
        X085_AssertUnchanged('X85-B05B', 'Neighbour Description', 'NEI-TMPL', NeighbourCreatedDate,
            'A neighbour batch must be left untouched by reissuing a different batch');
    end;

    [Test]
    procedure X085_ReissueCreatesAHeaderForABatchThatHadNoneYet()
    var
        BatchReissueMgt: Codeunit "CG X085 Batch Reissue Mgt";
    begin
        X085_Reset();
        X085_SeedSetup('FRESH-TMPL', 'Brand New Batch');

        BatchReissueMgt.Reissue('X85-B06');

        X085_AssertRebuilt('X85-B06', 'Brand New Batch', 'FRESH-TMPL', 'Reissuing a batch number with no existing header must still build one from the template');
    end;

    [Test]
    procedure X085_AFailedReissueOnABatchWithNoExistingHeaderCreatesNothing()
    var
        BatchReissueMgt: Codeunit "CG X085 Batch Reissue Mgt";
    begin
        X085_Reset();
        Commit();
        // No Reissue Setup record, and no existing header for this batch either.

        asserterror BatchReissueMgt.Reissue('X85-B07');

        X085_AssertDoesNotExist('X85-B07', 'A batch that never had a header and fails setup validation must still have none afterward');
    end;

    // ==========================================================
    // X087 - donor CG-AL-X087
    // ==========================================================

    local procedure X087_Reset()
    var
        Header: Record "CG X087 Document Header";
    begin
        Header.DeleteAll();
    end;

    local procedure X087_SeedSource(No: Code[20]; DescriptionValue: Text[100])
    var
        Header: Record "CG X087 Document Header";
    begin
        Header.Init();
        Header."No." := No;
        Header.Description := DescriptionValue;
        Header.Status := Header.Status::Open;
        Header.Insert();
    end;

    [Test]
    procedure X087_CopyingADocumentEndsUpReleasedAndAudited()
    var
        Header: Record "CG X087 Document Header";
        SourceHeader: Record "CG X087 Document Header";
        CopyMgt: Codeunit "CG X087 Document Copy Mgt";
    begin
        X087_Reset();
        X087_SeedSource('SRC001', 'Original document');

        CopyMgt.CopyDocument('SRC001', 'NEW001');

        Header.Get('NEW001');
        Assert.AreEqual('SRC001', Header."Copied From No.", 'The copy must record which document it came from');
        Assert.AreEqual('Original document', Header.Description, 'The copy must carry over the source description');
        Assert.AreEqual(Header.Status::Released, Header.Status, 'The copy must end up released');
        Assert.AreEqual('REL-NEW001', Header."Release Reference", 'The copy must keep the release reference recorded when it was released');
        Assert.IsTrue(Header."Copy Audited", 'The copy must be marked as audited');

        SourceHeader.Get('SRC001');
        Assert.AreEqual(SourceHeader.Status::Open, SourceHeader.Status, 'The source document must be left untouched');
        Assert.AreEqual('', SourceHeader."Release Reference", 'The source document must not gain a release reference');
        Assert.IsFalse(SourceHeader."Copy Audited", 'The source document must not be marked as audited');
    end;

    [Test]
    procedure X087_AuditingADocumentDirectlyLeavesOtherFieldsUnchanged()
    var
        Header: Record "CG X087 Document Header";
        CopyMgt: Codeunit "CG X087 Document Copy Mgt";
    begin
        X087_Reset();
        Header.Init();
        Header."No." := 'STANDALONE';
        Header.Description := 'Directly entered document';
        Header.Status := Header.Status::Copied;
        Header.Insert();

        CopyMgt.AuditDocument('STANDALONE');

        Header.Get('STANDALONE');
        Assert.IsTrue(Header."Copy Audited", 'A directly audited document must be marked as audited');
        Assert.AreEqual(Header.Status::Copied, Header.Status, 'Auditing a document must not change its status, even one currently showing as copied');
        Assert.AreEqual('', Header."Release Reference", 'Auditing a document directly must not invent a release reference');
    end;

    [Test]
    procedure X087_AuditingOneDocumentDoesNotChangeAnother()
    var
        Target: Record "CG X087 Document Header";
        Other: Record "CG X087 Document Header";
        CopyMgt: Codeunit "CG X087 Document Copy Mgt";
    begin
        X087_Reset();
        Target.Init();
        Target."No." := 'TARGET';
        Target.Description := 'Document to audit';
        Target.Status := Target.Status::Open;
        Target.Insert();

        Other.Init();
        Other."No." := 'OTHER';
        Other.Description := 'Unrelated document';
        Other.Status := Other.Status::Released;
        Other."Copy Audited" := true;
        Other."Release Reference" := 'REL-OTHER';
        Other.Insert();

        CopyMgt.AuditDocument('TARGET');

        Other.Get('OTHER');
        Assert.AreEqual(Other.Status::Released, Other.Status, 'An unrelated document''s status must not change');
        Assert.IsTrue(Other."Copy Audited", 'An unrelated document''s audited flag must not change');
        Assert.AreEqual('Unrelated document', Other.Description, 'An unrelated document''s description must not change');
        Assert.AreEqual('REL-OTHER', Other."Release Reference", 'An unrelated document''s release reference must not change');
    end;

    // ==========================================================
    // X092 - donor CG-AL-X092
    // ==========================================================

    local procedure X092_AssertDecimalRoundTrips(Original: Decimal)
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Parsed: Decimal;
        WireText: Text;
    begin
        WireText := WireFormat.ToWireDecimal(Original);

        Assert.IsTrue(WireFormat.FromWireDecimal(WireText, Parsed),
            StrSubstNo('Expected the wire text produced for %1 to be accepted back in, but %2 was rejected', Original, WireText));
        Assert.AreEqual(Original, Parsed,
            StrSubstNo('Expected the round trip through %1 to reproduce the original amount %2', WireText, Original));
    end;

    local procedure X092_AssertDateRoundTrips(Original: Date)
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Parsed: Date;
        WireText: Text;
    begin
        WireText := WireFormat.ToWireDate(Original);

        Assert.IsTrue(WireFormat.FromWireDate(WireText, Parsed),
            StrSubstNo('Expected the wire text produced for %1 to be accepted back in, but %2 was rejected', Original, WireText));
        Assert.AreEqual(Original, Parsed,
            StrSubstNo('Expected the round trip through %1 to reproduce the original date %2', WireText, Original));
    end;

    [Test]
    procedure X092_ToWireDecimalRendersPlainDigitsWithDotSeparator()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('1234567.89', WireFormat.ToWireDecimal(1234567.89),
            'Expected the amount as plain digits with a dot before the fraction, with no separator a receiving server would read differently depending on its own regional settings');
    end;

    [Test]
    procedure X092_ToWireDecimalKeepsLeadingMinusForNegativeValues()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('-1234.5', WireFormat.ToWireDecimal(-1234.5),
            'Expected a leading minus with plain digits and a dot before the fraction, the same on every server');
    end;

    [Test]
    procedure X092_ToWireDecimalStaysPlainBelowTheFirstGroupingBoundary()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('999', WireFormat.ToWireDecimal(999),
            'Expected a whole amount under a thousand to render as plain digits');
    end;

    [Test]
    procedure X092_ToWireDecimalHasNoGroupSeparatorAtTheGroupingBoundary()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('1000', WireFormat.ToWireDecimal(1000),
            'Expected a whole amount at a thousand to still render as plain digits, with no separator marking the thousands');
    end;

    [Test]
    procedure X092_ToWireDateRendersYearMonthDay()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('2026-01-23', WireFormat.ToWireDate(DMY2Date(23, 1, 2026)),
            'Expected 23 January 2026 to render as 2026-01-23 on every server');
    end;

    [Test]
    procedure X092_ToWireDatePadsSingleDigitMonthAndDay()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('2026-02-03', WireFormat.ToWireDate(DMY2Date(3, 2, 2026)),
            'Expected zero-padded month and day: 3 February 2026 is 2026-02-03 on every server');
    end;

    [Test]
    procedure X092_FromWireDecimalParsesValidWireText()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Decimal;
    begin
        Assert.IsTrue(WireFormat.FromWireDecimal('1234.56', Value),
            'Expected the wire text 1234.56 to be accepted');
        Assert.AreEqual(1234.56, Value, 'Expected the wire text 1234.56 to parse to exactly that amount');
    end;

    [Test]
    procedure X092_FromWireDecimalParsesNegativeWireText()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Decimal;
    begin
        Assert.IsTrue(WireFormat.FromWireDecimal('-42.75', Value),
            'Expected the wire text -42.75 to be accepted');
        Assert.AreEqual(-42.75, Value, 'Expected the wire text -42.75 to parse to exactly that amount');
    end;

    [Test]
    procedure X092_FromWireDecimalRejectsCommaFormattedText()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Decimal;
        Accepted: Boolean;
    begin
        Accepted := WireFormat.FromWireDecimal('1,5', Value);

        Assert.IsFalse(Accepted,
            StrSubstNo('Expected 1,5 to be rejected as not wire text, but it was accepted and parsed as %1', Value));
    end;

    [Test]
    procedure X092_FromWireDecimalRejectsGarbageWithoutError()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Decimal;
    begin
        Assert.IsFalse(WireFormat.FromWireDecimal('twelve point five', Value),
            'Expected text that is no amount at all to be rejected, not raised as an error');
    end;

    [Test]
    procedure X092_FromWireDateParsesValidWireText()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Date;
    begin
        Assert.IsTrue(WireFormat.FromWireDate('2026-01-23', Value),
            'Expected the wire text 2026-01-23 to be accepted');
        Assert.AreEqual(DMY2Date(23, 1, 2026), Value, 'Expected the wire text 2026-01-23 to parse to 23 January 2026');
    end;

    [Test]
    procedure X092_FromWireDateRejectsLocaleFormattedText()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Date;
        Accepted: Boolean;
    begin
        Accepted := WireFormat.FromWireDate('05-02-2026', Value);

        Assert.IsFalse(Accepted,
            StrSubstNo('Expected 05-02-2026 to be rejected as not wire text, but it was accepted and parsed as %1', Value));
    end;

    [Test]
    procedure X092_FromWireDateRejectsGarbageWithoutError()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Date;
    begin
        Assert.IsFalse(WireFormat.FromWireDate('23rd of January 2026', Value),
            'Expected text that is no wire date at all to be rejected, not raised as an error');
    end;

    [Test]
    procedure X092_DecimalRoundTripSweepSurvivesThroughWireText()
    begin
        X092_AssertDecimalRoundTrips(1000);
        X092_AssertDecimalRoundTrips(12345.67);
        X092_AssertDecimalRoundTrips(-98765.43);
        X092_AssertDecimalRoundTrips(2000000);
        X092_AssertDecimalRoundTrips(-1500.25);
        X092_AssertDecimalRoundTrips(42.5);
    end;

    [Test]
    procedure X092_DateRoundTripSweepSurvivesThroughWireText()
    begin
        X092_AssertDateRoundTrips(DMY2Date(1, 1, 2026));
        X092_AssertDateRoundTrips(DMY2Date(31, 12, 2026));
        X092_AssertDateRoundTrips(DMY2Date(29, 2, 2028));
        X092_AssertDateRoundTrips(DMY2Date(15, 6, 2025));
    end;

    // ==========================================================
    // X151 - donor CG-AL-X151
    // ==========================================================

    local procedure X151_Initialize()
    var
        BlockEntry: Record "CG X151 Block Entry";
        BlockList: Codeunit "CG X151 Block List";
    begin
        BlockEntry.DeleteAll();
        BlockList.Invalidate();
    end;

    [Test]
    procedure X151_BlockingACodeTakesEffectImmediately()
    var
        BlockList: Codeunit "CG X151 Block List";
    begin
        X151_Initialize();

        Assert.IsFalse(BlockList.IsBlocked('ALPHA'), 'A code with no history must not be reported as blocked');

        BlockList.SetBlocked('ALPHA');

        Assert.IsTrue(BlockList.IsBlocked('ALPHA'), 'Blocking a code must be reported immediately');
    end;

    [Test]
    procedure X151_ClearingABlockedCodeMustStopReportingItAsBlocked()
    var
        BlockEntry: Record "CG X151 Block Entry";
        BlockList: Codeunit "CG X151 Block List";
    begin
        X151_Initialize();
        BlockList.SetBlocked('ALPHA');
        Assert.IsTrue(BlockList.IsBlocked('ALPHA'), 'Blocking a code must be reported immediately');

        BlockList.ClearBlocked('ALPHA');

        Assert.IsFalse(BlockList.IsBlocked('ALPHA'),
            'Clearing a code must stop it being reported as blocked, the same way blocking one starts it');

        BlockEntry.Get('ALPHA');
        Assert.IsFalse(BlockEntry.Blocked,
            'A cleared code must show as cleared on the block list itself');
    end;

    [Test]
    procedure X151_ClearingOneCodeLeavesAnotherBlockedCodeUntouched()
    var
        BlockList: Codeunit "CG X151 Block List";
    begin
        X151_Initialize();
        BlockList.SetBlocked('ALPHA');
        BlockList.SetBlocked('BETA');
        Assert.IsTrue(BlockList.IsBlocked('ALPHA'), 'ALPHA must be reported as blocked after being blocked');
        Assert.IsTrue(BlockList.IsBlocked('BETA'), 'BETA must be reported as blocked after being blocked');

        BlockList.ClearBlocked('BETA');

        Assert.IsTrue(BlockList.IsBlocked('ALPHA'), 'Clearing BETA must not change ALPHA''s blocked status');
        Assert.IsFalse(BlockList.IsBlocked('BETA'), 'BETA must stop being reported as blocked once it has been cleared');
    end;

    [Test]
    procedure X151_AChangeMadeOutsideEitherActionDoesNotShowUpOnItsOwn()
    var
        BlockEntry: Record "CG X151 Block Entry";
        BlockList: Codeunit "CG X151 Block List";
    begin
        X151_Initialize();
        BlockEntry.Init();
        BlockEntry."Code" := 'GAMMA';
        BlockEntry.Blocked := false;
        BlockEntry.Insert();

        Assert.IsFalse(BlockList.IsBlocked('GAMMA'),
            'GAMMA must not be reported as blocked before either action has ever run against it');

        BlockEntry.Get('GAMMA');
        BlockEntry.Blocked := true;
        BlockEntry.Modify();

        Assert.IsFalse(BlockList.IsBlocked('GAMMA'),
            'A record edited outside of SetBlocked and ClearBlocked is not expected to change what IsBlocked reports until one of those two actions runs');
    end;

    [Test]
    procedure X151_BlockingAgainAfterClearingTakesEffectImmediately()
    var
        BlockList: Codeunit "CG X151 Block List";
    begin
        X151_Initialize();
        BlockList.SetBlocked('DELTA');
        Assert.IsTrue(BlockList.IsBlocked('DELTA'), 'DELTA must be reported as blocked after being blocked');
        BlockList.ClearBlocked('DELTA');

        BlockList.SetBlocked('DELTA');

        Assert.IsTrue(BlockList.IsBlocked('DELTA'),
            'Blocking DELTA again must be reported immediately, even right after clearing it');
    end;

    [Test]
    procedure X151_ClearingACodeThatWasNeverBlockedLeavesItUnblocked()
    var
        BlockList: Codeunit "CG X151 Block List";
    begin
        X151_Initialize();
        Assert.IsFalse(BlockList.IsBlocked('EPSILON'), 'A code with no history must not be reported as blocked');

        BlockList.ClearBlocked('EPSILON');

        Assert.IsFalse(BlockList.IsBlocked('EPSILON'), 'Clearing a code that was never blocked must leave it unblocked');
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

    // ==========================================================
    // X170 - donor CG-AL-X170
    // ==========================================================

    local procedure X170_ClearAllData()
    var
        ReversalLine: Record "CG X170 Reversal Line";
        CostCenter: Record "CG X170 Cost Center";
        ChargeHeader: Record "CG X170 Charge Header";
    begin
        ReversalLine.DeleteAll();
        CostCenter.DeleteAll();
        ChargeHeader.DeleteAll();
    end;

    local procedure X170_SeedCharge(ChargeNo: Code[20]; TotalAmount: Decimal)
    var
        ChargeHeader: Record "CG X170 Charge Header";
    begin
        ChargeHeader.Init();
        ChargeHeader."No." := ChargeNo;
        ChargeHeader."Charge Description" := 'Test charge';
        ChargeHeader."Total Amount" := TotalAmount;
        ChargeHeader.Insert();
    end;

    local procedure X170_SeedCostCenter(ChargeNo: Code[20]; LineNo: Integer; CostCenterName: Text[100]; CCWeight: Decimal)
    var
        CostCenter: Record "CG X170 Cost Center";
    begin
        CostCenter.Init();
        CostCenter."Charge No." := ChargeNo;
        CostCenter."Line No." := LineNo;
        CostCenter."Cost Center Name" := CostCenterName;
        CostCenter.Weight := CCWeight;
        CostCenter.Insert();
    end;

    local procedure X170_SeedCostCenterWithSentinel(ChargeNo: Code[20]; LineNo: Integer; CostCenterName: Text[100]; CCWeight: Decimal; SentinelAmount: Decimal)
    var
        CostCenter: Record "CG X170 Cost Center";
    begin
        CostCenter.Init();
        CostCenter."Charge No." := ChargeNo;
        CostCenter."Line No." := LineNo;
        CostCenter."Cost Center Name" := CostCenterName;
        CostCenter.Weight := CCWeight;
        CostCenter."Allocated Amount" := SentinelAmount;
        CostCenter.Insert();
    end;

    local procedure X170_SeedReversalLineSentinel(ChargeNo: Code[20]; ReversalNo: Code[20]; CostCenterLineNo: Integer; SentinelAmount: Decimal)
    var
        ReversalLine: Record "CG X170 Reversal Line";
    begin
        ReversalLine.Init();
        ReversalLine."Charge No." := ChargeNo;
        ReversalLine."Reversal No." := ReversalNo;
        ReversalLine."Cost Center Line No." := CostCenterLineNo;
        ReversalLine."Reversed Amount" := SentinelAmount;
        ReversalLine.Insert();
    end;

    local procedure X170_GetCCAllocated(ChargeNo: Code[20]; LineNo: Integer): Decimal
    var
        CostCenter: Record "CG X170 Cost Center";
    begin
        CostCenter.Get(ChargeNo, LineNo);
        exit(CostCenter."Allocated Amount");
    end;

    // Reads a cost center's net remaining amount directly off the raw
    // stored records - CostCenter."Allocated Amount" and the actual
    // "CG X170 Reversal Line" rows recorded against it - bypassing
    // Allocator.GetNetAmount entirely. A candidate could otherwise keep
    // ReverseCharge's stored per-cost-center rows wrong and pass every
    // assertion in this file by rewriting ONLY GetNetAmount to recompute
    // a fresh share on demand from the charge-level totals
    // (GetAllocatedTotal minus GetChargeReversedTotal), never looking at
    // what ReverseCharge actually wrote per cost center. This helper
    // pins what is actually on disk, so that rewrite still fails.
    local procedure X170_GetRawNet(ChargeNo: Code[20]; CostCenterLineNo: Integer): Decimal
    var
        CostCenter: Record "CG X170 Cost Center";
        ReversalLine: Record "CG X170 Reversal Line";
    begin
        CostCenter.Get(ChargeNo, CostCenterLineNo);
        ReversalLine.SetRange("Charge No.", ChargeNo);
        ReversalLine.SetRange("Cost Center Line No.", CostCenterLineNo);
        ReversalLine.CalcSums("Reversed Amount");
        exit(CostCenter."Allocated Amount" - ReversalLine."Reversed Amount");
    end;

    // Independently reconstructs the allocation every correct
    // implementation must produce: floor everyone's exact proportional
    // share to the cent, then hand out whatever the floors left on the
    // table one cent at a time to whichever entity's exact entitlement
    // was rounded down by the most, tie-broken by the lower array index.
    // A zero-weight entity's remainder is always exactly zero, so it
    // never competes for a leftover cent. This is the reference this
    // oracle grades against - not a re-implementation that happens to
    // agree with one particular solution.
    //
    // The description licenses no particular tie-break rule, so this
    // reference's "lower array index wins" choice is only safe to grade
    // against when no two nonzero-weight items actually tie on their
    // exact remainder for a given call. The hand-picked fixtures
    // elsewhere in this file were chosen to avoid that (see their own
    // comments); the deterministic sweep draws random weights, so it
    // exposes Remainder to self-check for ties before trusting this
    // reference's tie-break as the expected value.
    local procedure X170_ComputeSharesByLargestRemainder(Weight: array[10] of Decimal; ItemCount: Integer; TotalAmount: Decimal; var ExpectedShare: array[10] of Decimal; var Remainder: array[10] of Decimal)
    var
        Awarded: array[10] of Boolean;
        WeightSum: Decimal;
        FloorSum: Decimal;
        RemainingResidual: Decimal;
        ExactShare: Decimal;
        WinnerIndex: Integer;
        i: Integer;
    begin
        WeightSum := 0;
        for i := 1 to ItemCount do
            WeightSum += Weight[i];

        FloorSum := 0;
        for i := 1 to ItemCount do begin
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
            for i := 1 to ItemCount do
                if (Weight[i] <> 0) and (not Awarded[i]) then
                    // AL's "or" does not short-circuit, so evaluating
                    // Remainder[WinnerIndex] in the same condition as
                    // "WinnerIndex = 0" would index Remainder[0] on the
                    // first candidate - guard it with a nested if instead.
                    if WinnerIndex = 0 then
                        WinnerIndex := i
                    else
                        if Remainder[i] > Remainder[WinnerIndex] then
                            WinnerIndex := i;
            ExpectedShare[WinnerIndex] += 0.01;
            Awarded[WinnerIndex] := true;
            RemainingResidual -= 0.01;
        end;
    end;

    [Test]
    procedure X170_SingleCostCenterGetsTheEntireChargeAndAFullReversalNetsToZero()
    var
        Allocator: Codeunit "CG X170 Charge Allocator";
    begin
        X170_ClearAllData();
        X170_SeedCharge('SP01', 246.80);
        X170_SeedCostCenter('SP01', 1, 'Solo Cost Center', 17);

        Allocator.AllocateCharge('SP01');
        Assert.AreEqual(246.80, X170_GetCCAllocated('SP01', 1), 'Expected a charge with a single cost center to allocate its entire total to that cost center');

        Allocator.ReverseCharge('SP01', 'R1', 246.80);
        Assert.AreEqual(246.80, Allocator.GetReversedTotal('SP01', 'R1'), 'Expected the reversed amounts recorded for one reversal to sum to exactly the amount that reversal was for');
        Assert.AreEqual(0.00, Allocator.GetNetAmount('SP01', 1), 'Expected a full reversal against a single-cost-center charge to leave that cost center owing exactly nothing');
    end;

    [Test]
    procedure X170_CleanEvenSplitReconcilesExactlyAndLeavesAnotherChargeUntouched()
    var
        ChargeHeader: Record "CG X170 Charge Header";
        Allocator: Codeunit "CG X170 Charge Allocator";
    begin
        X170_ClearAllData();
        X170_SeedCharge('CD01', 200.00);
        X170_SeedCostCenter('CD01', 1, 'CC East', 1);
        X170_SeedCostCenter('CD01', 2, 'CC West', 1);

        // A second, unrelated charge is seeded with its own nonzero
        // sentinel amounts - on its cost center AND on an already
        // recorded reversal - and left alone. Allocating and reversing
        // CD01 must not touch any of it.
        X170_SeedCharge('XB01', 999.00);
        X170_SeedCostCenterWithSentinel('XB01', 1, 'CC Untouched', 1, 555.55);
        X170_SeedReversalLineSentinel('XB01', 'R1', 1, 111.11);

        Allocator.AllocateCharge('CD01');
        Allocator.ReverseCharge('CD01', 'R1', 50.00);

        Assert.AreEqual(100.00, X170_GetCCAllocated('CD01', 1), 'Expected an even two-cost-center split to allocate exactly half the total to each cost center');
        Assert.AreEqual(100.00, X170_GetCCAllocated('CD01', 2), 'Expected an even two-cost-center split to allocate exactly half the total to each cost center');
        Assert.AreEqual(200.00, Allocator.GetAllocatedTotal('CD01'), 'Expected the charge-level reconciliation total to equal the charge''s total amount after allocating');
        Assert.AreEqual(50.00, Allocator.GetReversedTotal('CD01', 'R1'), 'Expected the reversed amounts recorded for one reversal to sum to exactly the amount that reversal was for');
        Assert.AreEqual(75.00, Allocator.GetNetAmount('CD01', 1), 'Expected an even split of a reversal to give back exactly half from each cost center, leaving an even net remaining amount on each');
        Assert.AreEqual(75.00, Allocator.GetNetAmount('CD01', 2), 'Expected an even split of a reversal to give back exactly half from each cost center, leaving an even net remaining amount on each');

        ChargeHeader.Get('CD01');
        Assert.IsTrue(ChargeHeader.Allocated, 'Expected a charge whose cost centers carry weight to be recorded as allocated once its total has been spread across them');

        ChargeHeader.Get('XB01');
        Assert.IsFalse(ChargeHeader.Allocated, 'Expected an untouched charge to stay unallocated');
        Assert.AreEqual(555.55, X170_GetCCAllocated('XB01', 1), 'Expected another charge''s cost center amount to be left untouched by allocating or reversing a different charge');
        Assert.AreEqual(555.55, Allocator.GetAllocatedTotal('XB01'), 'Expected another charge''s allocated-total reconciliation to be left untouched by allocating or reversing a different charge');
        Assert.AreEqual(111.11, Allocator.GetReversedTotal('XB01', 'R1'), 'Expected another charge''s already-recorded reversal amount to be left untouched by allocating or reversing a different charge');
        Assert.AreEqual(444.44, Allocator.GetNetAmount('XB01', 1), 'Expected another charge''s net remaining amount to be left untouched by allocating or reversing a different charge');
    end;

    [Test]
    procedure X170_AdversarialFourCostCenterAllocationMatchesExactCents()
    var
        Allocator: Codeunit "CG X170 Charge Allocator";
        GrandTotal: Decimal;
        i: Integer;
    begin
        // Weights chosen so every cost center's exact share has a
        // distinct rounding remainder (no ties), so the pinned amounts
        // below do not depend on any particular tie-break policy.
        X170_ClearAllData();
        X170_SeedCharge('AD01', 500.00);
        X170_SeedCostCenter('AD01', 1, 'CC Facilities', 33);
        X170_SeedCostCenter('AD01', 2, 'CC Operations', 31);
        X170_SeedCostCenter('AD01', 3, 'CC Support', 30);
        X170_SeedCostCenter('AD01', 4, 'CC Admin', 28);

        Allocator.AllocateCharge('AD01');

        Assert.AreEqual(135.25, X170_GetCCAllocated('AD01', 1), 'Expected CC Facilities''s recorded amount to depend only on the charge''s weights and total');
        Assert.AreEqual(127.05, X170_GetCCAllocated('AD01', 2), 'Expected CC Operations''s recorded amount to depend only on the charge''s weights and total');
        Assert.AreEqual(122.95, X170_GetCCAllocated('AD01', 3), 'Expected CC Support''s recorded amount to depend only on the charge''s weights and total');
        Assert.AreEqual(114.75, X170_GetCCAllocated('AD01', 4), 'Expected CC Admin''s recorded amount to depend only on the charge''s weights and total');

        GrandTotal := 0;
        for i := 1 to 4 do
            GrandTotal += X170_GetCCAllocated('AD01', i);
        Assert.AreEqual(500.00, GrandTotal, 'Expected every cost center''s recorded amount to sum to exactly the charge''s total amount');
        Assert.AreEqual(500.00, Allocator.GetAllocatedTotal('AD01'), 'Expected the charge-level reconciliation total to equal the charge''s total amount after allocating');
    end;

    [Test]
    procedure X170_NetAfterAPartialReversalMatchesACleanAllocationOfTheRemainingAmount()
    var
        Allocator: Codeunit "CG X170 Charge Allocator";
    begin
        X170_ClearAllData();
        X170_SeedCharge('AD01', 500.00);
        X170_SeedCostCenter('AD01', 1, 'CC Facilities', 33);
        X170_SeedCostCenter('AD01', 2, 'CC Operations', 31);
        X170_SeedCostCenter('AD01', 3, 'CC Support', 30);
        X170_SeedCostCenter('AD01', 4, 'CC Admin', 28);

        Allocator.AllocateCharge('AD01');
        Allocator.ReverseCharge('AD01', 'R1', 50.00);

        Assert.AreEqual(50.00, Allocator.GetReversedTotal('AD01', 'R1'), 'Expected the reversed amounts recorded for one reversal to sum to exactly the amount that reversal was for');
        Assert.AreEqual(121.72, Allocator.GetNetAmount('AD01', 1), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(114.34, Allocator.GetNetAmount('AD01', 2), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(110.66, Allocator.GetNetAmount('AD01', 3), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(103.28, Allocator.GetNetAmount('AD01', 4), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(450.00, Allocator.GetNetAmount('AD01', 1) + Allocator.GetNetAmount('AD01', 2) + Allocator.GetNetAmount('AD01', 3) + Allocator.GetNetAmount('AD01', 4), 'Expected every cost center''s net remaining amount to sum to exactly the total amount not yet reversed');
    end;

    [Test]
    procedure X170_NetAfterAPartialReversalOnASecondAdversarialRatioMatchesACleanAllocationOfTheRemainingAmount()
    var
        Allocator: Codeunit "CG X170 Charge Allocator";
    begin
        X170_ClearAllData();
        X170_SeedCharge('AD02', 300.00);
        X170_SeedCostCenter('AD02', 1, 'CC North', 17);
        X170_SeedCostCenter('AD02', 2, 'CC South', 13);
        X170_SeedCostCenter('AD02', 3, 'CC East', 9);
        X170_SeedCostCenter('AD02', 4, 'CC West', 5);

        Allocator.AllocateCharge('AD02');
        Allocator.ReverseCharge('AD02', 'R1', 30.00);

        Assert.AreEqual(30.00, Allocator.GetReversedTotal('AD02', 'R1'), 'Expected the reversed amounts recorded for one reversal to sum to exactly the amount that reversal was for');
        Assert.AreEqual(104.32, Allocator.GetNetAmount('AD02', 1), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(79.77, Allocator.GetNetAmount('AD02', 2), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(55.23, Allocator.GetNetAmount('AD02', 3), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(30.68, Allocator.GetNetAmount('AD02', 4), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
    end;

    [Test]
    procedure X170_SomeReversalAmountsHappenToReconcileEvenOnTheBrokenImplementation()
    var
        Allocator: Codeunit "CG X170 Charge Allocator";
    begin
        // Same charge shape as the second adversarial ratio above, but a
        // different reversal amount - one where a plausible-but-wrong
        // implementation happens to land on the same cent split as the
        // correct one. This is expected to pass on any implementation
        // that gets the allocation side right, correct or not.
        X170_ClearAllData();
        X170_SeedCharge('AD02', 300.00);
        X170_SeedCostCenter('AD02', 1, 'CC North', 17);
        X170_SeedCostCenter('AD02', 2, 'CC South', 13);
        X170_SeedCostCenter('AD02', 3, 'CC East', 9);
        X170_SeedCostCenter('AD02', 4, 'CC West', 5);

        Allocator.AllocateCharge('AD02');
        Allocator.ReverseCharge('AD02', 'R1', 100.00);

        Assert.AreEqual(100.00, Allocator.GetReversedTotal('AD02', 'R1'), 'Expected the reversed amounts recorded for one reversal to sum to exactly the amount that reversal was for');
        Assert.AreEqual(77.27, Allocator.GetNetAmount('AD02', 1), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(59.09, Allocator.GetNetAmount('AD02', 2), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(40.91, Allocator.GetNetAmount('AD02', 3), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(22.73, Allocator.GetNetAmount('AD02', 4), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
    end;

    [Test]
    procedure X170_FullyReversingAChargeInTwoStepsLeavesEveryCostCenterAtExactlyZero()
    var
        Allocator: Codeunit "CG X170 Charge Allocator";
    begin
        X170_ClearAllData();
        X170_SeedCharge('AD01', 500.00);
        X170_SeedCostCenter('AD01', 1, 'CC Facilities', 33);
        X170_SeedCostCenter('AD01', 2, 'CC Operations', 31);
        X170_SeedCostCenter('AD01', 3, 'CC Support', 30);
        X170_SeedCostCenter('AD01', 4, 'CC Admin', 28);

        Allocator.AllocateCharge('AD01');
        Allocator.ReverseCharge('AD01', 'R1', 6.00);

        Assert.AreEqual(133.62, Allocator.GetNetAmount('AD01', 1), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(125.52, Allocator.GetNetAmount('AD01', 2), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(121.48, Allocator.GetNetAmount('AD01', 3), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(113.38, Allocator.GetNetAmount('AD01', 4), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');

        Allocator.ReverseCharge('AD01', 'R2', 494.00);

        Assert.AreEqual(500.00, Allocator.GetChargeReversedTotal('AD01'), 'Expected every reversal recorded against a charge to sum to exactly the amounts they were each for');
        Assert.AreEqual(0.00, Allocator.GetNetAmount('AD01', 1), 'Expected every cost center to end up owing exactly nothing once the reversals recorded against a charge add up to its entire total amount, however many separate reversals it took to get there');
        Assert.AreEqual(0.00, Allocator.GetNetAmount('AD01', 2), 'Expected every cost center to end up owing exactly nothing once the reversals recorded against a charge add up to its entire total amount, however many separate reversals it took to get there');
        Assert.AreEqual(0.00, Allocator.GetNetAmount('AD01', 3), 'Expected every cost center to end up owing exactly nothing once the reversals recorded against a charge add up to its entire total amount, however many separate reversals it took to get there');
        Assert.AreEqual(0.00, Allocator.GetNetAmount('AD01', 4), 'Expected every cost center to end up owing exactly nothing once the reversals recorded against a charge add up to its entire total amount, however many separate reversals it took to get there');
    end;

    [Test]
    procedure X170_TwoSequentialPartialReversalsConserveCumulativelyAgainstTheRemainingAmount()
    var
        Allocator: Codeunit "CG X170 Charge Allocator";
    begin
        X170_ClearAllData();
        X170_SeedCharge('AD01', 500.00);
        X170_SeedCostCenter('AD01', 1, 'CC Facilities', 33);
        X170_SeedCostCenter('AD01', 2, 'CC Operations', 31);
        X170_SeedCostCenter('AD01', 3, 'CC Support', 30);
        X170_SeedCostCenter('AD01', 4, 'CC Admin', 28);

        Allocator.AllocateCharge('AD01');
        Allocator.ReverseCharge('AD01', 'R1', 50.00);

        Assert.AreEqual(121.72, Allocator.GetNetAmount('AD01', 1), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(114.34, Allocator.GetNetAmount('AD01', 2), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(110.66, Allocator.GetNetAmount('AD01', 3), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(103.28, Allocator.GetNetAmount('AD01', 4), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(121.72, X170_GetRawNet('AD01', 1), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(114.34, X170_GetRawNet('AD01', 2), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(110.66, X170_GetRawNet('AD01', 3), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(103.28, X170_GetRawNet('AD01', 4), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');

        Allocator.ReverseCharge('AD01', 'R2', 30.00);

        Assert.AreEqual(80.00, Allocator.GetChargeReversedTotal('AD01'), 'Expected every reversal recorded against a charge to sum to exactly the amounts they were each for');
        Assert.AreEqual(113.61, Allocator.GetNetAmount('AD01', 1), 'Expected a cost center''s net remaining amount to still match a clean allocation of whatever is left of the charge after two separate reversals, not just after one');
        Assert.AreEqual(106.72, Allocator.GetNetAmount('AD01', 2), 'Expected a cost center''s net remaining amount to still match a clean allocation of whatever is left of the charge after two separate reversals, not just after one');
        Assert.AreEqual(103.28, Allocator.GetNetAmount('AD01', 3), 'Expected a cost center''s net remaining amount to still match a clean allocation of whatever is left of the charge after two separate reversals, not just after one');
        Assert.AreEqual(96.39, Allocator.GetNetAmount('AD01', 4), 'Expected a cost center''s net remaining amount to still match a clean allocation of whatever is left of the charge after two separate reversals, not just after one');
        Assert.AreEqual(113.61, X170_GetRawNet('AD01', 1), 'Expected a cost center''s net remaining amount to still match a clean allocation of whatever is left of the charge after two separate reversals, not just after one');
        Assert.AreEqual(106.72, X170_GetRawNet('AD01', 2), 'Expected a cost center''s net remaining amount to still match a clean allocation of whatever is left of the charge after two separate reversals, not just after one');
        Assert.AreEqual(103.28, X170_GetRawNet('AD01', 3), 'Expected a cost center''s net remaining amount to still match a clean allocation of whatever is left of the charge after two separate reversals, not just after one');
        Assert.AreEqual(96.39, X170_GetRawNet('AD01', 4), 'Expected a cost center''s net remaining amount to still match a clean allocation of whatever is left of the charge after two separate reversals, not just after one');
        Assert.AreEqual(50.00, Allocator.GetReversedTotal('AD01', 'R1'), 'Expected the amounts recorded under one reversal to stay the amount that reversal was for after a later, separate reversal is recorded against the same charge');
        Assert.AreEqual(30.00, Allocator.GetReversedTotal('AD01', 'R2'), 'Expected the amounts recorded under one reversal to stay the amount that reversal was for after a later, separate reversal is recorded against the same charge');
    end;

    [Test]
    procedure X170_ZeroWeightCostCenterNeverReceivesOrGivesBackAnyShare()
    var
        Allocator: Codeunit "CG X170 Charge Allocator";
    begin
        X170_ClearAllData();
        X170_SeedCharge('ZW01', 90.00);
        X170_SeedCostCenter('ZW01', 1, 'CC Live', 5);
        X170_SeedCostCenter('ZW01', 2, 'CC Sample', 0);

        Allocator.AllocateCharge('ZW01');
        Assert.AreEqual(90.00, X170_GetCCAllocated('ZW01', 1), 'Expected a cost center with weight to receive its full proportional share when the only other cost center on the charge has none');
        Assert.AreEqual(0.00, X170_GetCCAllocated('ZW01', 2), 'Expected a cost center with no weight to receive exactly zero, even though another cost center on the same charge carries a nonzero total');

        Allocator.ReverseCharge('ZW01', 'R1', 30.00);
        Assert.AreEqual(30.00, Allocator.GetReversedTotal('ZW01', 'R1'), 'Expected the reversed amounts recorded for one reversal to sum to exactly the amount that reversal was for');
        Assert.AreEqual(60.00, Allocator.GetNetAmount('ZW01', 1), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(0.00, Allocator.GetNetAmount('ZW01', 2), 'Expected a cost center with no weight to give back exactly zero of any reversal and keep a net remaining amount of exactly zero, regardless of the reversal amount');
    end;

    [Test]
    procedure X170_AChargeWithNoWeightAnywhereIsNeverAllocated()
    var
        ChargeHeader: Record "CG X170 Charge Header";
        Allocator: Codeunit "CG X170 Charge Allocator";
    begin
        X170_ClearAllData();
        X170_SeedCharge('NB01', 60.00);
        X170_SeedCostCenterWithSentinel('NB01', 1, 'CC Idle A', 0, 11.11);
        X170_SeedCostCenterWithSentinel('NB01', 2, 'CC Idle B', 0, 33.33);

        Allocator.AllocateCharge('NB01');

        ChargeHeader.Get('NB01');
        Assert.IsFalse(ChargeHeader.Allocated, 'Expected a charge with no weight on any cost center to be left unallocated');
        Assert.AreEqual(11.11, X170_GetCCAllocated('NB01', 1), 'Expected a cost center''s existing amount to be left untouched when the charge has no weight to allocate');
        Assert.AreEqual(33.33, X170_GetCCAllocated('NB01', 2), 'Expected a cost center''s existing amount to be left untouched when the charge has no weight to allocate');
        Assert.AreEqual(44.44, Allocator.GetAllocatedTotal('NB01'), 'Expected the charge-level reconciliation total to reflect the charge''s own recorded cost center amounts even when the charge was never allocated');
    end;

    [Test]
    procedure X170_DeterministicSweepAcrossManyChargesAndReversalSequences()
    var
        Allocator: Codeunit "CG X170 Charge Allocator";
        Any: Codeunit Any;
        Weight: array[10] of Decimal;
        ExpectedNet: array[10] of Decimal;
        Remainder: array[10] of Decimal;
        ChargeNo: Code[20];
        CCCount: Integer;
        TotalCents: Integer;
        R1Cents: Integer;
        R2Cents: Integer;
        TotalAmount: Decimal;
        R1Amount: Decimal;
        R2Amount: Decimal;
        RemainingTotal: Decimal;
        Partition: Integer;
        i: Integer;
        a: Integer;
        b: Integer;
    begin
        Any.SetSeed(170);

        for Partition := 1 to 6 do begin
            X170_ClearAllData();
            ChargeNo := 'SW' + Format(Partition);
            CCCount := Any.IntegerInRange(3, 6);

            for i := 1 to CCCount do begin
                // Roughly every fourth cost center on a sweep partition
                // carries no weight to allocate.
                if i mod 4 = 0 then
                    Weight[i] := 0
                else
                    Weight[i] := Any.DecimalInRange(1, 500, 3);
                X170_SeedCostCenter(ChargeNo, i, StrSubstNo('Sweep cost center %1', i), Weight[i]);
            end;

            TotalCents := Any.IntegerInRange(10000, 99900);
            TotalAmount := TotalCents / 100;
            X170_SeedCharge(ChargeNo, TotalAmount);

            Allocator.AllocateCharge(ChargeNo);

            R1Cents := Any.IntegerInRange(1, TotalCents - 2);
            R2Cents := Any.IntegerInRange(1, TotalCents - R1Cents - 1);
            R1Amount := R1Cents / 100;
            R2Amount := R2Cents / 100;

            Allocator.ReverseCharge(ChargeNo, 'R1', R1Amount);
            Allocator.ReverseCharge(ChargeNo, 'R2', R2Amount);

            Assert.AreEqual(
              R1Amount + R2Amount, Allocator.GetChargeReversedTotal(ChargeNo),
              StrSubstNo('Expected every reversal recorded against sweep partition %1''s charge to sum to exactly the amounts they were each for', Partition));

            RemainingTotal := TotalAmount - R1Amount - R2Amount;
            X170_ComputeSharesByLargestRemainder(Weight, CCCount, RemainingTotal, ExpectedNet, Remainder);

            // The description licenses no tie-break rule, so a tie
            // between two nonzero-weight cost centers' exact remainders
            // would make this fixture's pinned expectation depend on a
            // rule the task never stated - not a real defect in any
            // implementation. Self-check rather than silently trust the
            // reference's "lower index wins" choice on a random draw.
            for a := 1 to CCCount do
                if Weight[a] <> 0 then
                    for b := a + 1 to CCCount do
                        if Weight[b] <> 0 then
                            Assert.AreNotEqual(
                              Remainder[a], Remainder[b],
                              StrSubstNo('Sweep fixture drew a remainder tie on partition %1 - re-seed the sweep, this is not a solution defect', Partition));

            for i := 1 to CCCount do begin
                Assert.AreEqual(
                  ExpectedNet[i], Allocator.GetNetAmount(ChargeNo, i),
                  StrSubstNo('Expected cost center %1 of reversal-sweep partition %2 to end up with a net remaining amount that matches a clean allocation of whatever is left of the charge, after two separate reversals', i, Partition));
                Assert.AreEqual(
                  ExpectedNet[i], X170_GetRawNet(ChargeNo, i),
                  StrSubstNo('Expected cost center %1 of reversal-sweep partition %2 to end up with a net remaining amount that matches a clean allocation of whatever is left of the charge, after two separate reversals', i, Partition));
            end;
        end;
    end;
}
