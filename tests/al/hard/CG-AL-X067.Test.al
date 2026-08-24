codeunit 88820 "CG-AL-X067 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;
    EventSubscriberInstance = Manual;

    var
        Assert: Codeunit Assert;

    local procedure Activate(var Promotion: Codeunit "CG X067 Free Freight Promotion")
    var
        Bound: Boolean;
    begin
        Bound := BindSubscription(Promotion);
    end;

    local procedure Deactivate(var Promotion: Codeunit "CG X067 Free Freight Promotion")
    var
        Unbound: Boolean;
    begin
        Unbound := UnbindSubscription(Promotion);
    end;

    local procedure ActivateFreightOverride(var Override: Codeunit "CG-AL-X067 Test")
    var
        Bound: Boolean;
    begin
        Bound := BindSubscription(Override);
    end;

    local procedure DeactivateFreightOverride(var Override: Codeunit "CG-AL-X067 Test")
    var
        Unbound: Boolean;
    begin
        Unbound := UnbindSubscription(Override);
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CG X067 Freight Calculator", 'OnBeforeCalculateFreight', '', false, false)]
    local procedure ApplyAFlatFreightOverride(Amount: Decimal; var Freight: Decimal; var IsHandled: Boolean)
    begin
        Freight := 42.5;
        IsHandled := true;
    end;

    [Test]
    procedure DefaultFreightAppliesForOrdersUnderTheThreshold()
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
        Any: Codeunit Any;
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
        Any: Codeunit Any;
        Amount: Decimal;
    begin
        // [SCENARIO] The caller has explicitly activated the promotion for this call
        Activate(Promotion);

        Assert.AreEqual(0, Calculator.CalculateFreight(1000),
            'Expected free freight for an order of exactly 1000 while the promotion is activated for this call');

        Amount := Any.DecimalInRange(1001, 5000, 2);
        Assert.AreEqual(0, Calculator.CalculateFreight(Amount),
            StrSubstNo('Expected free freight for an order of %1 while the promotion is activated for this call', Amount));

        Deactivate(Promotion);
    end;

    [Test]
    procedure ActivatedPromotionLeavesOrdersBelowTheThresholdAtTheDefaultCharge()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
        Promotion: Codeunit "CG X067 Free Freight Promotion";
        Any: Codeunit Any;
        Amount: Decimal;
    begin
        // [SCENARIO] Activated, but the order does not reach the threshold
        Activate(Promotion);
        Amount := Any.DecimalInRange(100, 900, 2);

        Assert.AreEqual(Round(Amount * 0.1, 0.01), Calculator.CalculateFreight(Amount),
            StrSubstNo('Expected the standard charge for an order of %1 - below the threshold, the activated promotion must still leave it alone', Amount));

        Deactivate(Promotion);
    end;

    [Test]
    procedure CalculatedFreightReflectsTheAmountAnActiveOverrideSets()
    var
        Calculator: Codeunit "CG X067 Freight Calculator";
        Override: Codeunit "CG-AL-X067 Test";
    begin
        // [SCENARIO] A subscriber other than the promotion has taken over this call and set its own charge
        ActivateFreightOverride(Override);

        Assert.AreEqual(42.5, Calculator.CalculateFreight(1),
            'Expected the returned charge to reflect the amount an active override sets, not a fixed zero');

        DeactivateFreightOverride(Override);
    end;
}
