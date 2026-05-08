codeunit 80027 "CG-AL-M027 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        Sut: Codeunit "CG JSON Typed Getters";

    [Test]
    procedure TestObjectGetBigInteger()
    var
        JObj: JsonObject;
        BigVal: BigInteger;
    begin
        Evaluate(BigVal, '1234567890123');
        JObj.Add('big', BigVal);

        Assert.AreEqual(BigVal, Sut.ObjectGetBigInteger(JObj, 'big'), 'Present key returns BigInteger value');
        Assert.AreEqual(0, Sut.ObjectGetBigInteger(JObj, 'missing'), 'Missing key returns 0');
    end;

    [Test]
    procedure TestObjectGetByte()
    var
        JObj: JsonObject;
    begin
        JObj.Add('b', 200);

        Assert.AreEqual(200, Sut.ObjectGetByte(JObj, 'b'), 'Present key returns Byte value');
        Assert.AreEqual(0, Sut.ObjectGetByte(JObj, 'missing'), 'Missing key returns 0');
    end;

    [Test]
    procedure TestObjectGetChar()
    var
        JObj: JsonObject;
        ExpectedChar: Char;
    begin
        ExpectedChar := 'A';
        JObj.Add('c', 65);

        Assert.AreEqual(ExpectedChar, Sut.ObjectGetChar(JObj, 'c'), 'Present key returns Char value');
        Assert.AreEqual(0, Sut.ObjectGetChar(JObj, 'missing'), 'Missing key returns NUL char (0)');
    end;

    [Test]
    procedure TestObjectGetOption()
    var
        JObj: JsonObject;
    begin
        JObj.Add('opt', 2);

        Assert.AreEqual(2, Sut.ObjectGetOption(JObj, 'opt'), 'Present key returns option ordinal');
        Assert.AreEqual(0, Sut.ObjectGetOption(JObj, 'missing'), 'Missing key returns 0');
    end;

    [Test]
    procedure TestObjectGetDateTime()
    var
        JObj: JsonObject;
        DtVal: DateTime;
    begin
        DtVal := CreateDateTime(DMY2Date(15, 1, 2024), 103000T);
        JObj.Add('dt', DtVal);

        Assert.AreEqual(DtVal, Sut.ObjectGetDateTime(JObj, 'dt'), 'Present key returns DateTime value');
        Assert.AreEqual(0DT, Sut.ObjectGetDateTime(JObj, 'missing'), 'Missing key returns 0DT');
    end;

    [Test]
    procedure TestObjectGetDate()
    var
        JObj: JsonObject;
        DVal: Date;
    begin
        DVal := DMY2Date(17, 1, 2017);
        JObj.Add('d', DVal);

        Assert.AreEqual(DVal, Sut.ObjectGetDate(JObj, 'd'), 'Present key returns Date value');
        Assert.AreEqual(0D, Sut.ObjectGetDate(JObj, 'missing'), 'Missing key returns 0D');
    end;

    [Test]
    procedure TestObjectGetTime()
    var
        JObj: JsonObject;
        TVal: Time;
    begin
        TVal := 103000T;
        JObj.Add('t', TVal);

        Assert.AreEqual(TVal, Sut.ObjectGetTime(JObj, 't'), 'Present key returns Time value');
        Assert.AreEqual(0T, Sut.ObjectGetTime(JObj, 'missing'), 'Missing key returns 0T');
    end;

    [Test]
    procedure TestObjectGetDuration()
    var
        JObj: JsonObject;
        DurVal: Duration;
    begin
        DurVal := 60000;
        JObj.Add('dur', DurVal);

        Assert.AreEqual(DurVal, Sut.ObjectGetDuration(JObj, 'dur'), 'Present key returns Duration value (one minute)');
        Assert.AreEqual(0, Sut.ObjectGetDuration(JObj, 'missing'), 'Missing key returns 0');
    end;

    [Test]
    procedure TestObjectGetObject()
    var
        JObj: JsonObject;
        InnerObj: JsonObject;
        Result: JsonObject;
        EmptyResult: JsonObject;
    begin
        InnerObj.Add('foo', 'bar');
        JObj.Add('inner', InnerObj);

        Result := Sut.ObjectGetObject(JObj, 'inner');
        Assert.IsTrue(Result.Contains('foo'), 'Present key returns inner object containing original key');

        EmptyResult := Sut.ObjectGetObject(JObj, 'missing');
        Assert.AreEqual(0, EmptyResult.Keys().Count, 'Missing key returns empty JsonObject');
    end;

    [Test]
    procedure TestArrayGetBigInteger()
    var
        JArr: JsonArray;
        BigVal: BigInteger;
    begin
        Evaluate(BigVal, '9999999999');
        JArr.Add(BigVal);

        Assert.AreEqual(BigVal, Sut.ArrayGetBigInteger(JArr, 0), 'Index 0 returns BigInteger value');
    end;

    [Test]
    procedure TestArrayGetByte()
    var
        JArr: JsonArray;
    begin
        JArr.Add(100);

        Assert.AreEqual(100, Sut.ArrayGetByte(JArr, 0), 'Index 0 returns Byte value');
    end;

    [Test]
    procedure TestArrayGetChar()
    var
        JArr: JsonArray;
        ExpectedChar: Char;
    begin
        ExpectedChar := 'Z';
        JArr.Add(90);

        Assert.AreEqual(ExpectedChar, Sut.ArrayGetChar(JArr, 0), 'Index 0 returns Char value');
    end;

    [Test]
    procedure TestArrayGetOption()
    var
        JArr: JsonArray;
    begin
        JArr.Add(3);

        Assert.AreEqual(3, Sut.ArrayGetOption(JArr, 0), 'Index 0 returns option ordinal');
    end;

    [Test]
    procedure TestArrayGetDateTime()
    var
        JArr: JsonArray;
        DtVal: DateTime;
    begin
        DtVal := CreateDateTime(DMY2Date(1, 7, 2025), 080000T);
        JArr.Add(DtVal);

        Assert.AreEqual(DtVal, Sut.ArrayGetDateTime(JArr, 0), 'Index 0 returns DateTime value');
    end;

    [Test]
    procedure TestArrayGetDate()
    var
        JArr: JsonArray;
        DVal: Date;
    begin
        DVal := DMY2Date(31, 12, 2025);
        JArr.Add(DVal);

        Assert.AreEqual(DVal, Sut.ArrayGetDate(JArr, 0), 'Index 0 returns Date value');
    end;

    [Test]
    procedure TestArrayGetTime()
    var
        JArr: JsonArray;
        TVal: Time;
    begin
        TVal := 235959T;
        JArr.Add(TVal);

        Assert.AreEqual(TVal, Sut.ArrayGetTime(JArr, 0), 'Index 0 returns Time value');
    end;

    [Test]
    procedure TestArrayGetDuration()
    var
        JArr: JsonArray;
        DurVal: Duration;
    begin
        DurVal := 3600000;
        JArr.Add(DurVal);

        Assert.AreEqual(DurVal, Sut.ArrayGetDuration(JArr, 0), 'Index 0 returns Duration value (one hour)');
    end;

    [Test]
    procedure TestArrayGetObject()
    var
        JArr: JsonArray;
        InnerObj: JsonObject;
        Result: JsonObject;
    begin
        InnerObj.Add('key', 42);
        JArr.Add(InnerObj);

        Result := Sut.ArrayGetObject(JArr, 0);
        Assert.IsTrue(Result.Contains('key'), 'Index 0 returns inner JsonObject containing original key');
    end;
}
