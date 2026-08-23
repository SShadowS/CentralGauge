codeunit 89089 "CG-AL-X092 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    local procedure AssertDecimalRoundTrips(Original: Decimal)
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

    local procedure AssertDateRoundTrips(Original: Date)
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
    procedure ToWireDecimalRendersPlainDigitsWithDotSeparator()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('1234567.89', WireFormat.ToWireDecimal(1234567.89),
            'Expected the amount as plain digits with a dot before the fraction, with no separator a receiving server would read differently depending on its own regional settings');
    end;

    [Test]
    procedure ToWireDecimalKeepsLeadingMinusForNegativeValues()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('-1234.5', WireFormat.ToWireDecimal(-1234.5),
            'Expected a leading minus with plain digits and a dot before the fraction, the same on every server');
    end;

    [Test]
    procedure ToWireDecimalStaysPlainBelowTheFirstGroupingBoundary()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('999', WireFormat.ToWireDecimal(999),
            'Expected a whole amount under a thousand to render as plain digits');
    end;

    [Test]
    procedure ToWireDecimalHasNoGroupSeparatorAtTheGroupingBoundary()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('1000', WireFormat.ToWireDecimal(1000),
            'Expected a whole amount at a thousand to still render as plain digits, with no separator marking the thousands');
    end;

    [Test]
    procedure ToWireDateRendersYearMonthDay()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('2026-01-23', WireFormat.ToWireDate(DMY2Date(23, 1, 2026)),
            'Expected 23 January 2026 to render as 2026-01-23 on every server');
    end;

    [Test]
    procedure ToWireDatePadsSingleDigitMonthAndDay()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('2026-02-03', WireFormat.ToWireDate(DMY2Date(3, 2, 2026)),
            'Expected zero-padded month and day: 3 February 2026 is 2026-02-03 on every server');
    end;

    [Test]
    procedure FromWireDecimalParsesValidWireText()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Decimal;
    begin
        Assert.IsTrue(WireFormat.FromWireDecimal('1234.56', Value),
            'Expected the wire text 1234.56 to be accepted');
        Assert.AreEqual(1234.56, Value, 'Expected the wire text 1234.56 to parse to exactly that amount');
    end;

    [Test]
    procedure FromWireDecimalParsesNegativeWireText()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Decimal;
    begin
        Assert.IsTrue(WireFormat.FromWireDecimal('-42.75', Value),
            'Expected the wire text -42.75 to be accepted');
        Assert.AreEqual(-42.75, Value, 'Expected the wire text -42.75 to parse to exactly that amount');
    end;

    [Test]
    procedure FromWireDecimalRejectsCommaFormattedText()
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
    procedure FromWireDecimalRejectsGarbageWithoutError()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Decimal;
    begin
        Assert.IsFalse(WireFormat.FromWireDecimal('twelve point five', Value),
            'Expected text that is no amount at all to be rejected, not raised as an error');
    end;

    [Test]
    procedure FromWireDateParsesValidWireText()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Date;
    begin
        Assert.IsTrue(WireFormat.FromWireDate('2026-01-23', Value),
            'Expected the wire text 2026-01-23 to be accepted');
        Assert.AreEqual(DMY2Date(23, 1, 2026), Value, 'Expected the wire text 2026-01-23 to parse to 23 January 2026');
    end;

    [Test]
    procedure FromWireDateRejectsLocaleFormattedText()
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
    procedure FromWireDateRejectsGarbageWithoutError()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Date;
    begin
        Assert.IsFalse(WireFormat.FromWireDate('23rd of January 2026', Value),
            'Expected text that is no wire date at all to be rejected, not raised as an error');
    end;

    [Test]
    procedure DecimalRoundTripSweepSurvivesThroughWireText()
    begin
        AssertDecimalRoundTrips(1000);
        AssertDecimalRoundTrips(12345.67);
        AssertDecimalRoundTrips(-98765.43);
        AssertDecimalRoundTrips(2000000);
        AssertDecimalRoundTrips(-1500.25);
        AssertDecimalRoundTrips(42.5);
    end;

    [Test]
    procedure DateRoundTripSweepSurvivesThroughWireText()
    begin
        AssertDateRoundTrips(DMY2Date(1, 1, 2026));
        AssertDateRoundTrips(DMY2Date(31, 12, 2026));
        AssertDateRoundTrips(DMY2Date(29, 2, 2028));
        AssertDateRoundTrips(DMY2Date(15, 6, 2025));
    end;
}
