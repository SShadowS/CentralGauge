codeunit 89194 "CG-AL-X098 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        Any: Codeunit Any;

    // Consume the return value of Bind/UnbindSubscription rather than calling
    // the bare statement form (X062 lesson).
    local procedure ActivatePromotion(var Promotion: Codeunit "CG X067 Free Freight Promotion")
    var
        Bound: Boolean;
    begin
        Bound := BindSubscription(Promotion);
    end;

    local procedure DeactivatePromotion(var Promotion: Codeunit "CG X067 Free Freight Promotion")
    var
        Unbound: Boolean;
    begin
        Unbound := UnbindSubscription(Promotion);
    end;

    local procedure ActivateOtherRule(var OtherRule: Codeunit "CG-AL-X098 Other Rule")
    var
        Bound: Boolean;
    begin
        Bound := BindSubscription(OtherRule);
    end;

    local procedure DeactivateOtherRule(var OtherRule: Codeunit "CG-AL-X098 Other Rule")
    var
        Unbound: Boolean;
    begin
        Unbound := UnbindSubscription(OtherRule);
    end;

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every test clears the table
    // before seeding its own rows.

    // DETERMINISM NOTE (read before re-probing or editing this oracle):
    // The starter's defect (codeunit "CG X072 Loyalty Rule VIP" assigns its
    // shared `var Eligible` parameter unconditionally instead of only
    // strengthening it) only produces an observable failure here if BC
    // dispatches "CG X072 Loyalty Rule Spend"'s subscriber BEFORE
    // "CG X072 Loyalty Rule VIP"'s on the container running this suite.
    // That dispatch order is real platform behavior BC does not guarantee.
    // Algebraically, under the flipped order (VIP fires first) an UNFIXED
    // candidate produces output IDENTICAL to the fix on every input this
    // suite exercises and passes all of the loyalty-candidate tests below -
    // a false PASS, never a false FAIL: "correct/" is order-independent by
    // construction (both fixed subscribers only ever set Eligible := true,
    // which commutes regardless of firing order), so its pass is never at
    // risk here - only a starter/candidate's fail is. Re-probe trigger
    // fingerprint: an all-green CG-AL-X098 column on the loyalty-candidate
    // tests where failing/non-solving candidates diff as no-ops against
    // starter/ signals dispatch order flipped on that container, not that
    // the trap stopped working. Accepted residual, not caught by any test
    // here: a buggy candidate that renames or renumbers the VIP codeunit
    // can incidentally change its own subscriber-dispatch position and
    // self-neutralize the defect it was supposed to reproduce.

    local procedure SeedCandidate(No: Code[20]; CustomerName: Text[100]; Spend: Decimal; VipOverride: Boolean)
    var
        Candidate: Record "CG X072 Loyalty Candidate";
    begin
        Candidate.Init();
        Candidate."No." := No;
        Candidate."Customer Name" := CustomerName;
        Candidate."Lifetime Spend" := Spend;
        Candidate."Manual VIP Override" := VipOverride;
        Candidate.Insert();
    end;

    local procedure SeedApprovedCandidate(No: Code[20]; CustomerName: Text[100]; Spend: Decimal; VipOverride: Boolean)
    var
        Candidate: Record "CG X072 Loyalty Candidate";
    begin
        Candidate.Init();
        Candidate."No." := No;
        Candidate."Customer Name" := CustomerName;
        Candidate."Lifetime Spend" := Spend;
        Candidate."Manual VIP Override" := VipOverride;
        Candidate."Priority Support Approved" := true;
        Candidate.Insert();
    end;

    local procedure ApprovedOf(No: Code[20]): Boolean
    var
        Candidate: Record "CG X072 Loyalty Candidate";
    begin
        Candidate.Get(No);
        exit(Candidate."Priority Support Approved");
    end;

    // The order-line tests clear both tables before seeding their own rows.
    // Grades are random text rather than fixed literals so a fix cannot
    // special-case a hardcoded value.

    local procedure ResetOrderLines()
    var
        OrderLine: Record "CG X081 Order Line";
        Item: Record "CG X081 Item";
    begin
        OrderLine.DeleteAll();
        Item.DeleteAll();
    end;

    local procedure CreateGradedItem(var Item: Record "CG X081 Item"; No: Code[20]; Grade: Code[10])
    begin
        Item.Init();
        Item."No." := No;
        Item."Quality Grade" := Grade;
        Item.Insert(true);
    end;

    local procedure RandomGrade(): Code[10]
    begin
        exit(CopyStr(Any.AlphabeticText(10), 1, 10));
    end;

    local procedure CreateOrderLine(var OrderLine: Record "CG X081 Order Line"; EntryNo: Integer; ItemNo: Code[20])
    begin
        OrderLine.Init();
        OrderLine."Entry No." := EntryNo;
        OrderLine.Insert(true);
        OrderLine.Validate("Item No.", ItemNo);
        OrderLine.Modify(true);
    end;

    [Test]
    procedure DefaultFreightAppliesForOrdersUnderTheThreshold()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
        Amount: Decimal;
    begin
        // [SCENARIO] Nothing has activated the promotion, and the order is small
        Amount := Any.DecimalInRange(100, 900, 2);

        Assert.AreEqual(Round(Amount * 0.1, 0.01), Calculator.CalculateFreight(Amount),
            StrSubstNo('Expected the standard charge for an order of %1 with the promotion not activated', Amount));
    end;

    [Test]
    procedure DefaultFreightAppliesJustBelowTheThresholdWhenNotActivated()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
    begin
        // [SCENARIO] One cent below the threshold, still not activated
        Assert.AreEqual(100.00, Calculator.CalculateFreight(999.99),
            'Expected the standard charge for 999.99 with the promotion not activated - the threshold is 1000, one cent below it must not qualify');
    end;

    [Test]
    procedure LargeOrdersPayDefaultFreightWhenThePromotionHasNotBeenActivated()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
        Amount: Decimal;
    begin
        // [SCENARIO] A large order, but nothing has activated the promotion for this call
        Amount := Any.DecimalInRange(1001, 5000, 2);

        Assert.AreEqual(Round(Amount * 0.1, 0.01), Calculator.CalculateFreight(Amount),
            StrSubstNo('Expected the standard charge for a large order of %1 while the promotion has NOT been activated for this call', Amount));
    end;

    [Test]
    procedure LargeOrdersPayDefaultFreightAtExactlyTheThresholdWhenNotActivated()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
    begin
        // [SCENARIO] Exactly at the threshold, still not activated
        Assert.AreEqual(100.00, Calculator.CalculateFreight(1000),
            'Expected the standard charge for an order of exactly 1000 while the promotion has NOT been activated for this call');
    end;

    [Test]
    procedure ActivatedPromotionGrantsFreeFreightFromTheThresholdUpward()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
        Promotion: Codeunit "CG X067 Free Freight Promotion";
        Amount: Decimal;
    begin
        // [SCENARIO] The caller has explicitly activated the promotion for this call
        ActivatePromotion(Promotion);

        Assert.AreEqual(0, Calculator.CalculateFreight(1000),
            'Expected free freight for an order of exactly 1000 while the promotion is activated for this call');

        Amount := Any.DecimalInRange(1001, 5000, 2);
        Assert.AreEqual(0, Calculator.CalculateFreight(Amount),
            StrSubstNo('Expected free freight for an order of %1 while the promotion is activated for this call', Amount));

        DeactivatePromotion(Promotion);
    end;

    [Test]
    procedure ActivatedPromotionLeavesOrdersBelowTheThresholdAtTheDefaultCharge()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
        Promotion: Codeunit "CG X067 Free Freight Promotion";
        Amount: Decimal;
    begin
        // [SCENARIO] Activated, but the order does not reach the threshold
        ActivatePromotion(Promotion);
        Amount := Any.DecimalInRange(100, 900, 2);

        Assert.AreEqual(Round(Amount * 0.1, 0.01), Calculator.CalculateFreight(Amount),
            StrSubstNo('Expected the standard charge for an order of %1 - below the threshold, the activated promotion must still leave it alone', Amount));

        DeactivatePromotion(Promotion);
    end;

    [Test]
    procedure QualifyingSpendAloneIsApprovedAlongsideANonQualifyingPeer()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
        Gatekeeper: Codeunit "CG X072 Loyalty Gatekeeper";
    begin
        Candidate.DeleteAll();
        SeedCandidate('C001', 'Northwind Traders', 6000, false);
        SeedCandidate('C002', 'Contoso Ltd', 100, false);

        Gatekeeper.EvaluateAllPending();

        Assert.IsTrue(ApprovedOf('C001'), 'A candidate whose spend crosses the threshold must be approved even without the VIP override');
        Assert.IsFalse(ApprovedOf('C002'), 'A candidate below the threshold and without the VIP override must stay unapproved');

        Candidate.Get('C001');
        Assert.AreEqual('Northwind Traders', Candidate."Customer Name", 'Evaluating a candidate must not change its recorded name');
        Assert.AreEqual(6000, Candidate."Lifetime Spend", 'Evaluating a candidate must not change its recorded spend');
    end;

    [Test]
    procedure VipOverrideAloneIsApprovedBelowTheThreshold()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
        Gatekeeper: Codeunit "CG X072 Loyalty Gatekeeper";
    begin
        Candidate.DeleteAll();
        SeedCandidate('C010', 'Fabrikam Inc', 100, true);

        Gatekeeper.EvaluateAllPending();

        Assert.IsTrue(ApprovedOf('C010'), 'A candidate with the VIP override on must be approved even below the spend threshold');
    end;

    [Test]
    procedure NeitherConditionStaysUnapproved()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
        Gatekeeper: Codeunit "CG X072 Loyalty Gatekeeper";
    begin
        Candidate.DeleteAll();
        SeedCandidate('C020', 'Relecloud', 100, false);

        Gatekeeper.EvaluateAllPending();

        Assert.IsFalse(ApprovedOf('C020'), 'A candidate meeting neither condition must stay unapproved');
    end;

    [Test]
    procedure BothConditionsTogetherAreApproved()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
        Gatekeeper: Codeunit "CG X072 Loyalty Gatekeeper";
    begin
        Candidate.DeleteAll();
        SeedCandidate('C030', 'Adatum Corp', 6000, true);

        Gatekeeper.EvaluateAllPending();

        Assert.IsTrue(ApprovedOf('C030'), 'A candidate meeting both conditions must be approved');
    end;

    [Test]
    procedure SpendThresholdBoundaryIsInclusive()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
        Gatekeeper: Codeunit "CG X072 Loyalty Gatekeeper";
    begin
        Candidate.DeleteAll();
        SeedCandidate('C040', 'Tailspin Toys', 5000, false);
        SeedCandidate('C041', 'Wingtip Toys', 4999.99, false);

        Gatekeeper.EvaluateAllPending();

        Assert.IsTrue(ApprovedOf('C040'), 'A candidate whose spend exactly reaches the threshold must be approved');
        Assert.IsFalse(ApprovedOf('C041'), 'A candidate one cent short of the threshold must stay unapproved');
    end;

    [Test]
    procedure AlreadyDecidedCandidatesAreLeftAlone()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
        Gatekeeper: Codeunit "CG X072 Loyalty Gatekeeper";
    begin
        Candidate.DeleteAll();
        SeedApprovedCandidate('C050', 'Trey Research', 100, false);
        SeedCandidate('C051', 'Litware Inc', 6000, true);

        Gatekeeper.EvaluateAllPending();

        Assert.IsTrue(ApprovedOf('C050'), 'A candidate already marked approved must stay approved without being reconsidered');
        Assert.IsTrue(ApprovedOf('C051'), 'A pending candidate meeting both conditions must still be approved');
    end;

    [Test]
    procedure SingleCandidateEvaluationMatchesBatchEvaluation()
    var
        Candidate: Record "CG X072 Loyalty Candidate";
        Gatekeeper: Codeunit "CG X072 Loyalty Gatekeeper";
    begin
        Candidate.DeleteAll();
        SeedCandidate('C060', 'Proseware Inc', 5500, false);
        Candidate.Get('C060');

        Gatekeeper.EvaluateCandidate(Candidate);

        Assert.IsTrue(Candidate."Priority Support Approved", 'Evaluating a single candidate directly must approve one whose spend crosses the threshold');
        Assert.IsTrue(ApprovedOf('C060'), 'The verdict from evaluating a single candidate must be persisted');
    end;

    [Test]
    procedure NewLineForAGradedItemGetsTheGrade()
    var
        Item: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        Grade: Code[10];
    begin
        ResetOrderLines();
        Grade := RandomGrade();
        CreateGradedItem(Item, 'ITEM-A', Grade);

        CreateOrderLine(OrderLine, 1, Item."No.");

        Assert.AreEqual(Grade, OrderLine."Quality Grade",
            'Expected validating "Item No." with a graded item to copy that item''s grade onto the line');
    end;

    [Test]
    procedure NewLineForAGradelessItemStaysBlank()
    var
        Item: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
    begin
        ResetOrderLines();
        CreateGradedItem(Item, 'ITEM-B', '');

        CreateOrderLine(OrderLine, 2, Item."No.");

        Assert.AreEqual('', OrderLine."Quality Grade",
            'Expected the line''s grade to stay blank when the item on it has none');
    end;

    [Test]
    procedure RevalidatingToAnotherGradedItemOverwritesTheGrade()
    var
        FirstItem: Record "CG X081 Item";
        SecondItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        SecondGrade: Code[10];
    begin
        ResetOrderLines();
        CreateGradedItem(FirstItem, 'ITEM-C', RandomGrade());
        SecondGrade := RandomGrade();
        CreateGradedItem(SecondItem, 'ITEM-D', SecondGrade);
        CreateOrderLine(OrderLine, 3, FirstItem."No.");

        OrderLine.Validate("Item No.", SecondItem."No.");
        OrderLine.Modify(true);

        Assert.AreEqual(SecondGrade, OrderLine."Quality Grade",
            'Expected re-validating "Item No." to another graded item to overwrite the line''s grade with the new item''s grade');
    end;

    [Test]
    procedure RevalidatingToAGradelessItemClearsTheLine()
    var
        GradedItem: Record "CG X081 Item";
        GradelessItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
    begin
        ResetOrderLines();
        CreateGradedItem(GradedItem, 'ITEM-E', RandomGrade());
        CreateGradedItem(GradelessItem, 'ITEM-F', '');
        CreateOrderLine(OrderLine, 4, GradedItem."No.");

        OrderLine.Validate("Item No.", GradelessItem."No.");
        OrderLine.Modify(true);

        Assert.AreEqual('', OrderLine."Quality Grade",
            'Expected the line''s grade to be cleared when "Item No." is re-validated to an item with no grade - the line must always mirror the item that is on it');
    end;

    [Test]
    procedure ClearingTheItemNoAlsoClearsTheGrade()
    var
        GradedItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
    begin
        ResetOrderLines();
        CreateGradedItem(GradedItem, 'ITEM-M', RandomGrade());
        CreateOrderLine(OrderLine, 8, GradedItem."No.");

        OrderLine.Validate("Item No.", '');
        OrderLine.Modify(true);

        Assert.AreEqual('', OrderLine."Quality Grade",
            'Expected the line''s grade to be cleared when "Item No." is re-validated to blank - the line must always mirror the item that is on it');
    end;

    [Test]
    procedure RevalidatingBackToAGradedItemAfterClearingSetsTheNewGrade()
    var
        FirstGradedItem: Record "CG X081 Item";
        GradelessItem: Record "CG X081 Item";
        SecondGradedItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        SecondGrade: Code[10];
    begin
        ResetOrderLines();
        CreateGradedItem(FirstGradedItem, 'ITEM-G', RandomGrade());
        CreateGradedItem(GradelessItem, 'ITEM-H', '');
        SecondGrade := RandomGrade();
        CreateGradedItem(SecondGradedItem, 'ITEM-I', SecondGrade);
        CreateOrderLine(OrderLine, 5, FirstGradedItem."No.");

        OrderLine.Validate("Item No.", GradelessItem."No.");
        OrderLine.Modify(true);
        OrderLine.Validate("Item No.", SecondGradedItem."No.");
        OrderLine.Modify(true);

        Assert.AreEqual(SecondGrade, OrderLine."Quality Grade",
            'Expected re-validating "Item No." back to a graded item after a gradeless item to set the new item''s grade');
    end;

    [Test]
    procedure AssigningItemValuesDirectlyAlsoClearsAStaleGrade()
    var
        GradelessItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        LineDefaultsMgt: Codeunit "CG X081 Line Defaults Mgt";
    begin
        ResetOrderLines();
        CreateGradedItem(GradelessItem, 'ITEM-J', '');
        OrderLine.Init();
        OrderLine."Entry No." := 6;
        OrderLine."Item No." := GradelessItem."No.";
        OrderLine."Quality Grade" := 'STALE';
        OrderLine.Insert(true);

        LineDefaultsMgt.AssignItemValues(OrderLine);
        OrderLine.Modify(true);

        Assert.AreEqual('', OrderLine."Quality Grade",
            'Expected assigning item values for a line pointed at a gradeless item to leave the line''s grade blank, matching what that item carries');
    end;

    [Test]
    procedure UnrelatedLinesAreNeverTouched()
    var
        GradedItem: Record "CG X081 Item";
        GradelessItem: Record "CG X081 Item";
        OrderLine: Record "CG X081 Order Line";
        OtherLine: Record "CG X081 Order Line";
    begin
        ResetOrderLines();
        CreateGradedItem(GradedItem, 'ITEM-K', RandomGrade());
        CreateGradedItem(GradelessItem, 'ITEM-L', '');

        OtherLine.Init();
        OtherLine."Entry No." := 100;
        OtherLine."Quality Grade" := 'SENTINEL9';
        OtherLine.Insert(true);

        CreateOrderLine(OrderLine, 7, GradedItem."No.");
        OrderLine.Validate("Item No.", GradelessItem."No.");
        OrderLine.Modify(true);

        OtherLine.Get(100);
        Assert.AreEqual('SENTINEL9', Format(OtherLine."Quality Grade"),
            'Expected a line never re-validated in this test to keep its original grade untouched');
    end;

    [Test]
    procedure CustomPathIncludesMandatorySegment()
    var
        Engine: Codeunit "CG X094 Reference Engine";
        Result: Text[50];
    begin
        Result := Engine.ResolveReference('CUSTOM', 'S0001', 5);

        Assert.AreEqual('CUST~S0001/FY05', Result, 'A reference resolved through the custom rule must carry its mandatory segment, same as any other reference');
    end;

    [Test]
    procedure CustomPathMandatorySegmentReflectsItsOwnPeriod()
    var
        Engine: Codeunit "CG X094 Reference Engine";
        Result: Text[50];
    begin
        Result := Engine.ResolveReference('CUSTOM', 'S0002', 47);

        Assert.AreEqual('CUST~S0002/FY47', Result, 'The mandatory segment on a custom-resolved reference must reflect that reference''s own period, not a fixed value');
    end;

    [Test]
    procedure CustomPathBodyIsStillTheCustomBody()
    var
        Engine: Codeunit "CG X094 Reference Engine";
        Result: Text[50];
    begin
        Result := Engine.ResolveReference('CUSTOM', 'S0001', 5);

        Assert.IsTrue(StrPos(Result, 'CUST~S0001') = 1, 'A category CUSTOM reference must still show the custom rule''s resolved body');
    end;

    [Test]
    procedure DefaultPathIncludesMandatorySegment()
    var
        Engine: Codeunit "CG X094 Reference Engine";
        Result: Text[50];
    begin
        Result := Engine.ResolveReference('STD', 'S0001', 5);

        Assert.AreEqual('STD-S0001/FY05', Result, 'A reference resolved through the default rule must carry its mandatory segment');
    end;

    [Test]
    procedure DefaultPathMandatorySegmentReflectsItsOwnPeriod()
    var
        Engine: Codeunit "CG X094 Reference Engine";
        Result: Text[50];
    begin
        Result := Engine.ResolveReference('STD', 'S0002', 47);

        Assert.AreEqual('STD-S0002/FY47', Result, 'The mandatory segment on a default-resolved reference must reflect that reference''s own period, not a fixed value');
    end;

    [Test]
    procedure MandatorySegmentReflectsEachDistinctPeriod()
    var
        Engine: Codeunit "CG X094 Reference Engine";
    begin
        Assert.AreEqual('FY05', Engine.FiscalSegmentFor(5), 'Period 5 must produce its own mandatory segment');
        Assert.AreEqual('FY47', Engine.FiscalSegmentFor(47), 'Period 47 must produce its own mandatory segment');
        Assert.AreEqual('FY00', Engine.FiscalSegmentFor(100), 'Period 100 must wrap to the segment for period 0, not stay fixed');
        Assert.AreEqual('FY97', Engine.FiscalSegmentFor(-3), 'A negative period must wrap into the same segment space');
    end;

    [Test]
    procedure AThirdRuleStillProducesItsOwnBody()
    var
        Engine: Codeunit "CG X094 Reference Engine";
        OtherRule: Codeunit "CG-AL-X098 Other Rule";
        Result: Text[50];
    begin
        ActivateOtherRule(OtherRule);
        Result := Engine.ResolveReference('ZOTHER', 'S0003', 5);
        DeactivateOtherRule(OtherRule);

        Assert.IsTrue(StrPos(Result, 'ZZZ') = 1, 'A reference resolved by another custom rule must still show that rule''s own body');
    end;
}
