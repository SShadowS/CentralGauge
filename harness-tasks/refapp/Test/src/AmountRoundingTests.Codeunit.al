codeunit 80052 "CGR Amount Rounding Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";

    [Test]
    procedure ZeroPrecisionFallsBackToCents()
    var
        AmountRounding: Codeunit "CGR Amount Rounding";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0, '', 3);
        SessionContext.Reset();
        Assert.AreEqual(0.01, AmountRounding.Precision(), 'Zero precision falls back to 0.01');
        Assert.AreEqual(1.23, AmountRounding.RoundAmount(1.234), '1.234 rounds down to 1.23');
        Assert.AreEqual(1.24, AmountRounding.RoundAmount(1.236), '1.236 rounds up to 1.24');
    end;

    [Test]
    procedure SetupPrecisionApplied()
    var
        AmountRounding: Codeunit "CGR Amount Rounding";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(0.05, '', 3);
        SessionContext.Reset();
        Assert.AreEqual(0.05, AmountRounding.Precision(), 'Precision from setup');
        Assert.AreEqual(1.00, AmountRounding.RoundAmount(1.02), '1.02 rounds to 1.00');
        Assert.AreEqual(1.05, AmountRounding.RoundAmount(1.03), '1.03 rounds to 1.05');
        Assert.AreEqual(1.05, AmountRounding.RoundAmount(1.07), '1.07 rounds to 1.05');
    end;

    [Test]
    procedure WholeUnitPrecision()
    var
        AmountRounding: Codeunit "CGR Amount Rounding";
        SessionContext: Codeunit "CGR Session Context";
    begin
        WorkDate(20270301D);
        Lib.SetV2Setup(1, '', 3);
        SessionContext.Reset();
        Assert.AreEqual(12.00, AmountRounding.RoundAmount(12.4), '12.4 rounds to 12');
        Assert.AreEqual(13.00, AmountRounding.RoundAmount(12.6), '12.6 rounds to 13');
    end;
}
