codeunit 80088 "CG-AL-M088 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        SubEngine: Codeunit "Subscription Engine";
        
    [Test]
    procedure TestNextBillingDate_Basic()
    var
        Result: Date;
        BaseDate: Date;
    begin
        BaseDate := DMY2Date(1, 1, 2024);
        Result := SubEngine.GetNextBillingDate(BaseDate, "Subscription Plan"::Basic);
        // Basic adds 1 month
        Assert.AreEqual(DMY2Date(1, 2, 2024), Result, 'Basic plan should add 1M');
    end;

    [Test]
    procedure TestNextBillingDate_Premium()
    var
        Result: Date;
        BaseDate: Date;
    begin
        BaseDate := DMY2Date(1, 1, 2024);
        Result := SubEngine.GetNextBillingDate(BaseDate, "Subscription Plan"::Premium);
        // Premium adds 3 months
        Assert.AreEqual(DMY2Date(1, 4, 2024), Result, 'Premium plan should add 3M');
    end;

    [Test]
    procedure TestNextBillingDate_EmptyDate()
    var
        Result: Date;
        Expected: Date;
    begin
        Expected := CalcDate('<1Y>', WorkDate());
        Result := SubEngine.GetNextBillingDate(0D, "Subscription Plan"::Enterprise);
        Assert.AreEqual(Expected, Result, 'Empty date should use WorkDate as base');
    end;

    [Test]
    procedure TestRefund_StandardCalc()
    var
        Result: Decimal;
    begin
        // Basic = 30 days total. Amount 300. Used 15 days.
        // Refund = (300 / 30) * (30 - 15) = 10 * 15 = 150.
        Result := SubEngine.CalculateProratedRefund(300, 15, "Subscription Plan"::Basic);
        Assert.AreEqual(150, Result, 'Refund calculation failed for Basic plan');
    end;

    [Test]
    procedure TestRefund_Rounding()
    var
        Result: Decimal;
    begin
        // Premium = 90 days. Amount 100. Used 10 days.
        // Refund = (100 / 90) * 80 = 1.1111... * 80 = 88.888...
        // Rounded to 2 decimals = 88.89
        Result := SubEngine.CalculateProratedRefund(100, 10, "Subscription Plan"::Premium);
        Assert.AreEqual(88.89, Result, 'Refund rounding incorrect');
    end;

    [Test]
    procedure TestRefund_NegativeDays()
    var
        Result: Decimal;
    begin
        Result := SubEngine.CalculateProratedRefund(100, -5, "Subscription Plan"::Basic);
        Assert.AreEqual(0, Result, 'Negative days used should return 0');
    end;

    [Test]
    procedure TestRefund_ZeroDaysUsed()
    var
        Result: Decimal;
    begin
        // [SCENARIO] Zero days used is a full refund, not a rejected one. The spec
        // rejects only NEGATIVE days, so the guard boundary matters: the tests above
        // pass 15, 10 and -5 and never zero, so widening the guard to <= 0 silently
        // zeroes every same-day cancellation.
        // Basic = 30 days total. Amount 300. Used 0 days.
        // Refund = (300 / 30) * (30 - 0) = 10 * 30 = 300. Exact, no rounding.
        Result := SubEngine.CalculateProratedRefund(300, 0, "Subscription Plan"::Basic);
        Assert.AreEqual(300, Result, 'Cancelling before any day is used must refund the whole amount');
    end;
}