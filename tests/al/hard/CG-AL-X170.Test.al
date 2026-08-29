codeunit 89390 "CG-AL-X170 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every test clears all three
    // tables before seeding its own rows.

    local procedure ClearAllData()
    var
        ReversalLine: Record "CG X170 Reversal Line";
        CostCenter: Record "CG X170 Cost Center";
        ChargeHeader: Record "CG X170 Charge Header";
    begin
        ReversalLine.DeleteAll();
        CostCenter.DeleteAll();
        ChargeHeader.DeleteAll();
    end;

    local procedure SeedCharge(ChargeNo: Code[20]; TotalAmount: Decimal)
    var
        ChargeHeader: Record "CG X170 Charge Header";
    begin
        ChargeHeader.Init();
        ChargeHeader."No." := ChargeNo;
        ChargeHeader."Charge Description" := 'Test charge';
        ChargeHeader."Total Amount" := TotalAmount;
        ChargeHeader.Insert();
    end;

    local procedure SeedCostCenter(ChargeNo: Code[20]; LineNo: Integer; CostCenterName: Text[100]; CCWeight: Decimal)
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

    local procedure SeedCostCenterWithSentinel(ChargeNo: Code[20]; LineNo: Integer; CostCenterName: Text[100]; CCWeight: Decimal; SentinelAmount: Decimal)
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

    local procedure SeedReversalLineSentinel(ChargeNo: Code[20]; ReversalNo: Code[20]; CostCenterLineNo: Integer; SentinelAmount: Decimal)
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

    local procedure GetCCAllocated(ChargeNo: Code[20]; LineNo: Integer): Decimal
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
    local procedure GetRawNet(ChargeNo: Code[20]; CostCenterLineNo: Integer): Decimal
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
    local procedure ComputeSharesByLargestRemainder(Weight: array[10] of Decimal; ItemCount: Integer; TotalAmount: Decimal; var ExpectedShare: array[10] of Decimal; var Remainder: array[10] of Decimal)
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
    procedure SingleCostCenterGetsTheEntireChargeAndAFullReversalNetsToZero()
    var
        Allocator: Codeunit "CG X170 Charge Allocator";
    begin
        ClearAllData();
        SeedCharge('SP01', 246.80);
        SeedCostCenter('SP01', 1, 'Solo Cost Center', 17);

        Allocator.AllocateCharge('SP01');
        Assert.AreEqual(246.80, GetCCAllocated('SP01', 1), 'Expected a charge with a single cost center to allocate its entire total to that cost center');

        Allocator.ReverseCharge('SP01', 'R1', 246.80);
        Assert.AreEqual(246.80, Allocator.GetReversedTotal('SP01', 'R1'), 'Expected the reversed amounts recorded for one reversal to sum to exactly the amount that reversal was for');
        Assert.AreEqual(0.00, Allocator.GetNetAmount('SP01', 1), 'Expected a full reversal against a single-cost-center charge to leave that cost center owing exactly nothing');
    end;

    [Test]
    procedure CleanEvenSplitReconcilesExactlyAndLeavesAnotherChargeUntouched()
    var
        ChargeHeader: Record "CG X170 Charge Header";
        Allocator: Codeunit "CG X170 Charge Allocator";
    begin
        ClearAllData();
        SeedCharge('CD01', 200.00);
        SeedCostCenter('CD01', 1, 'CC East', 1);
        SeedCostCenter('CD01', 2, 'CC West', 1);

        // A second, unrelated charge is seeded with its own nonzero
        // sentinel amounts - on its cost center AND on an already
        // recorded reversal - and left alone. Allocating and reversing
        // CD01 must not touch any of it.
        SeedCharge('XB01', 999.00);
        SeedCostCenterWithSentinel('XB01', 1, 'CC Untouched', 1, 555.55);
        SeedReversalLineSentinel('XB01', 'R1', 1, 111.11);

        Allocator.AllocateCharge('CD01');
        Allocator.ReverseCharge('CD01', 'R1', 50.00);

        Assert.AreEqual(100.00, GetCCAllocated('CD01', 1), 'Expected an even two-cost-center split to allocate exactly half the total to each cost center');
        Assert.AreEqual(100.00, GetCCAllocated('CD01', 2), 'Expected an even two-cost-center split to allocate exactly half the total to each cost center');
        Assert.AreEqual(200.00, Allocator.GetAllocatedTotal('CD01'), 'Expected the charge-level reconciliation total to equal the charge''s total amount after allocating');
        Assert.AreEqual(50.00, Allocator.GetReversedTotal('CD01', 'R1'), 'Expected the reversed amounts recorded for one reversal to sum to exactly the amount that reversal was for');
        Assert.AreEqual(75.00, Allocator.GetNetAmount('CD01', 1), 'Expected an even split of a reversal to give back exactly half from each cost center, leaving an even net remaining amount on each');
        Assert.AreEqual(75.00, Allocator.GetNetAmount('CD01', 2), 'Expected an even split of a reversal to give back exactly half from each cost center, leaving an even net remaining amount on each');

        ChargeHeader.Get('CD01');
        Assert.IsTrue(ChargeHeader.Allocated, 'Expected a charge whose cost centers carry weight to be recorded as allocated once its total has been spread across them');

        ChargeHeader.Get('XB01');
        Assert.IsFalse(ChargeHeader.Allocated, 'Expected an untouched charge to stay unallocated');
        Assert.AreEqual(555.55, GetCCAllocated('XB01', 1), 'Expected another charge''s cost center amount to be left untouched by allocating or reversing a different charge');
        Assert.AreEqual(555.55, Allocator.GetAllocatedTotal('XB01'), 'Expected another charge''s allocated-total reconciliation to be left untouched by allocating or reversing a different charge');
        Assert.AreEqual(111.11, Allocator.GetReversedTotal('XB01', 'R1'), 'Expected another charge''s already-recorded reversal amount to be left untouched by allocating or reversing a different charge');
        Assert.AreEqual(444.44, Allocator.GetNetAmount('XB01', 1), 'Expected another charge''s net remaining amount to be left untouched by allocating or reversing a different charge');
    end;

    [Test]
    procedure AdversarialFourCostCenterAllocationMatchesExactCents()
    var
        Allocator: Codeunit "CG X170 Charge Allocator";
        GrandTotal: Decimal;
        i: Integer;
    begin
        // Weights chosen so every cost center's exact share has a
        // distinct rounding remainder (no ties), so the pinned amounts
        // below do not depend on any particular tie-break policy.
        ClearAllData();
        SeedCharge('AD01', 500.00);
        SeedCostCenter('AD01', 1, 'CC Facilities', 33);
        SeedCostCenter('AD01', 2, 'CC Operations', 31);
        SeedCostCenter('AD01', 3, 'CC Support', 30);
        SeedCostCenter('AD01', 4, 'CC Admin', 28);

        Allocator.AllocateCharge('AD01');

        Assert.AreEqual(135.25, GetCCAllocated('AD01', 1), 'Expected CC Facilities''s recorded amount to depend only on the charge''s weights and total');
        Assert.AreEqual(127.05, GetCCAllocated('AD01', 2), 'Expected CC Operations''s recorded amount to depend only on the charge''s weights and total');
        Assert.AreEqual(122.95, GetCCAllocated('AD01', 3), 'Expected CC Support''s recorded amount to depend only on the charge''s weights and total');
        Assert.AreEqual(114.75, GetCCAllocated('AD01', 4), 'Expected CC Admin''s recorded amount to depend only on the charge''s weights and total');

        GrandTotal := 0;
        for i := 1 to 4 do
            GrandTotal += GetCCAllocated('AD01', i);
        Assert.AreEqual(500.00, GrandTotal, 'Expected every cost center''s recorded amount to sum to exactly the charge''s total amount');
        Assert.AreEqual(500.00, Allocator.GetAllocatedTotal('AD01'), 'Expected the charge-level reconciliation total to equal the charge''s total amount after allocating');
    end;

    [Test]
    procedure NetAfterAPartialReversalMatchesACleanAllocationOfTheRemainingAmount()
    var
        Allocator: Codeunit "CG X170 Charge Allocator";
    begin
        ClearAllData();
        SeedCharge('AD01', 500.00);
        SeedCostCenter('AD01', 1, 'CC Facilities', 33);
        SeedCostCenter('AD01', 2, 'CC Operations', 31);
        SeedCostCenter('AD01', 3, 'CC Support', 30);
        SeedCostCenter('AD01', 4, 'CC Admin', 28);

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
    procedure NetAfterAPartialReversalOnASecondAdversarialRatioMatchesACleanAllocationOfTheRemainingAmount()
    var
        Allocator: Codeunit "CG X170 Charge Allocator";
    begin
        ClearAllData();
        SeedCharge('AD02', 300.00);
        SeedCostCenter('AD02', 1, 'CC North', 17);
        SeedCostCenter('AD02', 2, 'CC South', 13);
        SeedCostCenter('AD02', 3, 'CC East', 9);
        SeedCostCenter('AD02', 4, 'CC West', 5);

        Allocator.AllocateCharge('AD02');
        Allocator.ReverseCharge('AD02', 'R1', 30.00);

        Assert.AreEqual(30.00, Allocator.GetReversedTotal('AD02', 'R1'), 'Expected the reversed amounts recorded for one reversal to sum to exactly the amount that reversal was for');
        Assert.AreEqual(104.32, Allocator.GetNetAmount('AD02', 1), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(79.77, Allocator.GetNetAmount('AD02', 2), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(55.23, Allocator.GetNetAmount('AD02', 3), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(30.68, Allocator.GetNetAmount('AD02', 4), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
    end;

    [Test]
    procedure SomeReversalAmountsHappenToReconcileEvenOnTheBrokenImplementation()
    var
        Allocator: Codeunit "CG X170 Charge Allocator";
    begin
        // Same charge shape as the second adversarial ratio above, but a
        // different reversal amount - one where a plausible-but-wrong
        // implementation happens to land on the same cent split as the
        // correct one. This is expected to pass on any implementation
        // that gets the allocation side right, correct or not.
        ClearAllData();
        SeedCharge('AD02', 300.00);
        SeedCostCenter('AD02', 1, 'CC North', 17);
        SeedCostCenter('AD02', 2, 'CC South', 13);
        SeedCostCenter('AD02', 3, 'CC East', 9);
        SeedCostCenter('AD02', 4, 'CC West', 5);

        Allocator.AllocateCharge('AD02');
        Allocator.ReverseCharge('AD02', 'R1', 100.00);

        Assert.AreEqual(100.00, Allocator.GetReversedTotal('AD02', 'R1'), 'Expected the reversed amounts recorded for one reversal to sum to exactly the amount that reversal was for');
        Assert.AreEqual(77.27, Allocator.GetNetAmount('AD02', 1), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(59.09, Allocator.GetNetAmount('AD02', 2), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(40.91, Allocator.GetNetAmount('AD02', 3), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(22.73, Allocator.GetNetAmount('AD02', 4), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
    end;

    [Test]
    procedure FullyReversingAChargeInTwoStepsLeavesEveryCostCenterAtExactlyZero()
    var
        Allocator: Codeunit "CG X170 Charge Allocator";
    begin
        ClearAllData();
        SeedCharge('AD01', 500.00);
        SeedCostCenter('AD01', 1, 'CC Facilities', 33);
        SeedCostCenter('AD01', 2, 'CC Operations', 31);
        SeedCostCenter('AD01', 3, 'CC Support', 30);
        SeedCostCenter('AD01', 4, 'CC Admin', 28);

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
    procedure TwoSequentialPartialReversalsConserveCumulativelyAgainstTheRemainingAmount()
    var
        Allocator: Codeunit "CG X170 Charge Allocator";
    begin
        ClearAllData();
        SeedCharge('AD01', 500.00);
        SeedCostCenter('AD01', 1, 'CC Facilities', 33);
        SeedCostCenter('AD01', 2, 'CC Operations', 31);
        SeedCostCenter('AD01', 3, 'CC Support', 30);
        SeedCostCenter('AD01', 4, 'CC Admin', 28);

        Allocator.AllocateCharge('AD01');
        Allocator.ReverseCharge('AD01', 'R1', 50.00);

        Assert.AreEqual(121.72, Allocator.GetNetAmount('AD01', 1), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(114.34, Allocator.GetNetAmount('AD01', 2), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(110.66, Allocator.GetNetAmount('AD01', 3), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(103.28, Allocator.GetNetAmount('AD01', 4), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(121.72, GetRawNet('AD01', 1), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(114.34, GetRawNet('AD01', 2), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(110.66, GetRawNet('AD01', 3), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(103.28, GetRawNet('AD01', 4), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');

        Allocator.ReverseCharge('AD01', 'R2', 30.00);

        Assert.AreEqual(80.00, Allocator.GetChargeReversedTotal('AD01'), 'Expected every reversal recorded against a charge to sum to exactly the amounts they were each for');
        Assert.AreEqual(113.61, Allocator.GetNetAmount('AD01', 1), 'Expected a cost center''s net remaining amount to still match a clean allocation of whatever is left of the charge after two separate reversals, not just after one');
        Assert.AreEqual(106.72, Allocator.GetNetAmount('AD01', 2), 'Expected a cost center''s net remaining amount to still match a clean allocation of whatever is left of the charge after two separate reversals, not just after one');
        Assert.AreEqual(103.28, Allocator.GetNetAmount('AD01', 3), 'Expected a cost center''s net remaining amount to still match a clean allocation of whatever is left of the charge after two separate reversals, not just after one');
        Assert.AreEqual(96.39, Allocator.GetNetAmount('AD01', 4), 'Expected a cost center''s net remaining amount to still match a clean allocation of whatever is left of the charge after two separate reversals, not just after one');
        Assert.AreEqual(113.61, GetRawNet('AD01', 1), 'Expected a cost center''s net remaining amount to still match a clean allocation of whatever is left of the charge after two separate reversals, not just after one');
        Assert.AreEqual(106.72, GetRawNet('AD01', 2), 'Expected a cost center''s net remaining amount to still match a clean allocation of whatever is left of the charge after two separate reversals, not just after one');
        Assert.AreEqual(103.28, GetRawNet('AD01', 3), 'Expected a cost center''s net remaining amount to still match a clean allocation of whatever is left of the charge after two separate reversals, not just after one');
        Assert.AreEqual(96.39, GetRawNet('AD01', 4), 'Expected a cost center''s net remaining amount to still match a clean allocation of whatever is left of the charge after two separate reversals, not just after one');
        Assert.AreEqual(50.00, Allocator.GetReversedTotal('AD01', 'R1'), 'Expected the amounts recorded under one reversal to stay the amount that reversal was for after a later, separate reversal is recorded against the same charge');
        Assert.AreEqual(30.00, Allocator.GetReversedTotal('AD01', 'R2'), 'Expected the amounts recorded under one reversal to stay the amount that reversal was for after a later, separate reversal is recorded against the same charge');
    end;

    [Test]
    procedure ZeroWeightCostCenterNeverReceivesOrGivesBackAnyShare()
    var
        Allocator: Codeunit "CG X170 Charge Allocator";
    begin
        ClearAllData();
        SeedCharge('ZW01', 90.00);
        SeedCostCenter('ZW01', 1, 'CC Live', 5);
        SeedCostCenter('ZW01', 2, 'CC Sample', 0);

        Allocator.AllocateCharge('ZW01');
        Assert.AreEqual(90.00, GetCCAllocated('ZW01', 1), 'Expected a cost center with weight to receive its full proportional share when the only other cost center on the charge has none');
        Assert.AreEqual(0.00, GetCCAllocated('ZW01', 2), 'Expected a cost center with no weight to receive exactly zero, even though another cost center on the same charge carries a nonzero total');

        Allocator.ReverseCharge('ZW01', 'R1', 30.00);
        Assert.AreEqual(30.00, Allocator.GetReversedTotal('ZW01', 'R1'), 'Expected the reversed amounts recorded for one reversal to sum to exactly the amount that reversal was for');
        Assert.AreEqual(60.00, Allocator.GetNetAmount('ZW01', 1), 'Expected a cost center''s net remaining amount after a reversal to match a clean allocation of whatever is left of the charge');
        Assert.AreEqual(0.00, Allocator.GetNetAmount('ZW01', 2), 'Expected a cost center with no weight to give back exactly zero of any reversal and keep a net remaining amount of exactly zero, regardless of the reversal amount');
    end;

    [Test]
    procedure AChargeWithNoWeightAnywhereIsNeverAllocated()
    var
        ChargeHeader: Record "CG X170 Charge Header";
        Allocator: Codeunit "CG X170 Charge Allocator";
    begin
        ClearAllData();
        SeedCharge('NB01', 60.00);
        SeedCostCenterWithSentinel('NB01', 1, 'CC Idle A', 0, 11.11);
        SeedCostCenterWithSentinel('NB01', 2, 'CC Idle B', 0, 33.33);

        Allocator.AllocateCharge('NB01');

        ChargeHeader.Get('NB01');
        Assert.IsFalse(ChargeHeader.Allocated, 'Expected a charge with no weight on any cost center to be left unallocated');
        Assert.AreEqual(11.11, GetCCAllocated('NB01', 1), 'Expected a cost center''s existing amount to be left untouched when the charge has no weight to allocate');
        Assert.AreEqual(33.33, GetCCAllocated('NB01', 2), 'Expected a cost center''s existing amount to be left untouched when the charge has no weight to allocate');
        Assert.AreEqual(44.44, Allocator.GetAllocatedTotal('NB01'), 'Expected the charge-level reconciliation total to reflect the charge''s own recorded cost center amounts even when the charge was never allocated');
    end;

    [Test]
    procedure DeterministicSweepAcrossManyChargesAndReversalSequences()
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
            ClearAllData();
            ChargeNo := 'SW' + Format(Partition);
            CCCount := Any.IntegerInRange(3, 6);

            for i := 1 to CCCount do begin
                // Roughly every fourth cost center on a sweep partition
                // carries no weight to allocate.
                if i mod 4 = 0 then
                    Weight[i] := 0
                else
                    Weight[i] := Any.DecimalInRange(1, 500, 3);
                SeedCostCenter(ChargeNo, i, StrSubstNo('Sweep cost center %1', i), Weight[i]);
            end;

            TotalCents := Any.IntegerInRange(10000, 99900);
            TotalAmount := TotalCents / 100;
            SeedCharge(ChargeNo, TotalAmount);

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
            ComputeSharesByLargestRemainder(Weight, CCCount, RemainingTotal, ExpectedNet, Remainder);

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
                  ExpectedNet[i], GetRawNet(ChargeNo, i),
                  StrSubstNo('Expected cost center %1 of reversal-sweep partition %2 to end up with a net remaining amount that matches a clean allocation of whatever is left of the charge, after two separate reversals', i, Partition));
            end;
        end;
    end;
}
