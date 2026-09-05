codeunit 80052 "CG-AL-E052 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        TypeConverter: Codeunit "CG Type Converter";

    [Test]
    procedure TestIntegerToText_PositiveNumber()
    var
        Result: Text;
    begin
        Result := TypeConverter.IntegerToText(42);

        Assert.AreEqual('42', Result, 'Should convert 42 to "42"');
    end;

    [Test]
    procedure TestIntegerToText_Zero()
    var
        Result: Text;
    begin
        Result := TypeConverter.IntegerToText(0);

        Assert.AreEqual('0', Result, 'Should convert 0 to "0"');
    end;

    [Test]
    procedure TestIntegerToText_NegativeNumber()
    var
        Result: Text;
    begin
        Result := TypeConverter.IntegerToText(-123);

        Assert.AreEqual('-123', Result, 'Should convert -123 to "-123"');
    end;

    [Test]
    procedure TestIntegerToText_LargeNumber()
    var
        Result: Text;
    begin
        Result := TypeConverter.IntegerToText(1000000);

        Assert.IsTrue(Result.Contains('1000000') or Result.Contains('1,000,000'), 'Should contain the large number');
    end;

    [Test]
    procedure TestDecimalToText_WholeNumber()
    var
        Result: Text;
    begin
        Result := TypeConverter.DecimalToText(100);

        Assert.IsTrue(Result.StartsWith('100'), 'Should start with 100');
    end;

    [Test]
    procedure TestDecimalToText_WithDecimals()
    var
        Result: Text;
    begin
        Result := TypeConverter.DecimalToText(123.45);

        Assert.IsTrue(Result.Contains('123'), 'Should contain 123');
        Assert.IsTrue(Result.Contains('45'), 'Should contain decimal part 45');
    end;

    [Test]
    procedure TestDecimalToText_NegativeDecimal()
    var
        Result: Text;
    begin
        Result := TypeConverter.DecimalToText(-99.99);

        Assert.IsTrue(Result.Contains('-'), 'Should contain negative sign');
        Assert.IsTrue(Result.Contains('99'), 'Should contain 99');
    end;

    [Test]
    procedure TestDecimalToText_Zero()
    var
        Result: Text;
    begin
        Result := TypeConverter.DecimalToText(0);

        Assert.IsTrue(Result.Contains('0'), 'Should contain 0');
    end;

    [Test]
    procedure TestBooleanToText_True()
    var
        Result: Text;
    begin
        Result := TypeConverter.BooleanToText(true);

        Assert.IsTrue((Result = 'true') or (Result = 'True') or (Result = 'Yes'),
            'Should convert true to text representation');
    end;

    [Test]
    procedure TestBooleanToText_False()
    var
        Result: Text;
    begin
        Result := TypeConverter.BooleanToText(false);

        Assert.IsTrue((Result = 'false') or (Result = 'False') or (Result = 'No'),
            'Should convert false to text representation');
    end;

    [Test]
    procedure TestDateToText_ValidDate()
    var
        Result: Text;
        TestDate: Date;
    begin
        TestDate := DMY2Date(15, 6, 2025);
        Result := TypeConverter.DateToText(TestDate);

        // Accept a 2-digit year: the container's session locale renders Format(Date) as MM/DD/YY.
        Assert.IsTrue(Result.Contains('2025') or Result.Contains('25'), 'Should contain year 2025');
        Assert.IsTrue(Result.Contains('6') or Result.Contains('06') or Result.Contains('Jun'),
            'Should contain month');
        Assert.IsTrue(Result.Contains('15'), 'Should contain day 15');
    end;

    [Test]
    procedure TestDateToText_FirstDayOfYear()
    var
        Result: Text;
        TestDate: Date;
    begin
        TestDate := DMY2Date(1, 1, 2025);
        Result := TypeConverter.DateToText(TestDate);

        Assert.IsTrue(Result.Contains('2025') or Result.Contains('25'), 'Should contain year');
        Assert.IsTrue(Result.Contains('1') or Result.Contains('01') or Result.Contains('Jan'),
            'Should contain January indicator');
    end;

    [Test]
    procedure TestFormatOrderSummary_BasicOrder()
    var
        Result: Text;
        TestDate: Date;
    begin
        TestDate := DMY2Date(10, 3, 2025);
        Result := TypeConverter.FormatOrderSummary(1001, 250.50, true, TestDate);

        Assert.IsTrue(Result.Contains('Order'), 'Should contain Order label');
        Assert.IsTrue(Result.Contains('1001'), 'Should contain order number');
        Assert.IsTrue(Result.Contains('Amount'), 'Should contain Amount label');
        Assert.IsTrue(Result.Contains('250'), 'Should contain amount value');
        Assert.IsTrue(Result.Contains('Shipped'), 'Should contain Shipped label');
        Assert.IsTrue(Result.Contains('Yes') or Result.Contains('true') or Result.Contains('True'),
            'Shipped order should render IsShipped as a true value');
    end;

    [Test]
    procedure TestFormatOrderSummary_NotShipped()
    var
        Result: Text;
        TestDate: Date;
    begin
        TestDate := DMY2Date(20, 5, 2025);
        Result := TypeConverter.FormatOrderSummary(2002, 99.99, false, TestDate);

        Assert.IsTrue(Result.Contains('2002'), 'Should contain order number');
        Assert.IsTrue(Result.Contains('99'), 'Should contain amount');
        Assert.IsTrue(Result.Contains('Date'), 'Should contain Date label');
        Assert.IsTrue(Result.Contains('No') or Result.Contains('false') or Result.Contains('False'),
            'Unshipped order should render IsShipped as a false value');
        Assert.IsFalse(Result.Contains('Yes') or Result.Contains('true') or Result.Contains('True'),
            'Unshipped order must not render IsShipped as a true value');
    end;

    [Test]
    procedure TestFormatOrderSummary_ZeroAmount()
    var
        Result: Text;
        TestDate: Date;
    begin
        TestDate := DMY2Date(1, 1, 2025);
        Result := TypeConverter.FormatOrderSummary(3003, 0, true, TestDate);

        Assert.IsTrue(Result.Contains('3003'), 'Should contain order number');
        Assert.IsTrue(Result.Contains('0'), 'Should contain zero amount');
    end;

    [Test]
    procedure TestFormatOrderSummary_ContainsAllParts()
    var
        Result: Text;
        TestDate: Date;
    begin
        TestDate := DMY2Date(25, 12, 2025);
        Result := TypeConverter.FormatOrderSummary(5000, 1500.00, true, TestDate);

        // Verify format structure
        Assert.IsTrue(Result.Contains('Order:') or Result.Contains('Order :'), 'Should have Order label');
        Assert.IsTrue(Result.Contains('Amount:') or Result.Contains('Amount :'), 'Should have Amount label');
        Assert.IsTrue(Result.Contains('Shipped:') or Result.Contains('Shipped :'), 'Should have Shipped label');
        Assert.IsTrue(Result.Contains('Date:') or Result.Contains('Date :'), 'Should have Date label');
    end;
}
