codeunit 80056 "CG-AL-E056 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        Sut: Codeunit "CG Simple ToText";

    [Test]
    procedure TestBigIntegerToText_Zero()
    begin
        Assert.AreEqual('0', Sut.BigIntegerToText(0), 'BigInteger 0 should render as "0"');
    end;

    [Test]
    procedure TestBigIntegerToText_MaxValue()
    var
        BigVal: BigInteger;
    begin
        Evaluate(BigVal, '9223372036854775807');
        Assert.AreEqual('9223372036854775807', Sut.BigIntegerToText(BigVal), 'BigInteger MaxValue should render as digits');
    end;

    [Test]
    procedure TestBigIntegerToText_Negative()
    begin
        Assert.AreEqual('-12345', Sut.BigIntegerToText(-12345), 'BigInteger -12345 should render with leading minus');
    end;

    [Test]
    procedure TestByteToText_Zero()
    begin
        Assert.AreEqual('0', Sut.ByteToText(0), 'Byte 0 should render as "0"');
    end;

    [Test]
    procedure TestByteToText_MaxValue()
    begin
        Assert.AreEqual('255', Sut.ByteToText(255), 'Byte 255 should render as "255"');
    end;

    [Test]
    procedure TestGuidToText_NonEmpty()
    var
        G: Guid;
        Result: Text;
    begin
        G := CreateGuid();
        Result := Sut.GuidToText(G);
        Assert.AreNotEqual('', Result, 'Guid should render to non-empty Text');
        Assert.IsTrue(StrLen(Result) >= 36, 'Guid text length should be at least 36 chars');
    end;

    [Test]
    procedure TestGuidToText_EmptyGuid()
    var
        G: Guid;
        Result: Text;
    begin
        Clear(G);
        Result := Sut.GuidToText(G);
        Assert.IsTrue(Result.Contains('00000000'), 'Empty Guid should contain "00000000"');
    end;

    [Test]
    procedure TestVersionToText_FromAppManifest()
    var
        Info: ModuleInfo;
        Result: Text;
    begin
        NavApp.GetCurrentModuleInfo(Info);
        Result := Sut.VersionToText(Info.AppVersion);
        Assert.AreNotEqual('', Result, 'Version should render to non-empty Text');
        Assert.IsTrue(Result.Contains('.'), 'Version text should contain dot separators');
    end;

    [Test]
    procedure TestVersionToText_Default()
    var
        V: Version;
        Result: Text;
    begin
        Result := Sut.VersionToText(V);
        Assert.IsTrue(Result.Contains('0'), 'Default Version 0.0.0.0 should contain "0"');
    end;

    [Test]
    procedure TestDateTimeToText_NonEmpty()
    var
        Dt: DateTime;
        Result: Text;
    begin
        Dt := CreateDateTime(DMY2Date(15, 6, 2025), 120000T);
        Result := Sut.DateTimeToText(Dt);
        Assert.AreNotEqual('', Result, 'DateTime should render to non-empty Text');
        Assert.IsTrue(Result.Contains('2025'), 'DateTime should contain year 2025');
    end;

    [Test]
    procedure TestDateTimeToInvariantText_MatchesXmlFormat()
    var
        Dt: DateTime;
        Expected: Text;
    begin
        Dt := CreateDateTime(DMY2Date(15, 6, 2025), 120000T);
        Expected := Format(Dt, 0, 9);
        Assert.AreEqual(Expected, Sut.DateTimeToInvariantText(Dt), 'DateTime invariant text should match XML format');
    end;

    [Test]
    procedure TestDurationToText_Zero()
    var
        D: Duration;
        Result: Text;
    begin
        D := 0;
        Result := Sut.DurationToText(D);
        Assert.AreNotEqual('', Result, 'Duration 0 should render to non-empty Text');
    end;

    [Test]
    procedure TestDurationToInvariantText_FiveSeconds()
    var
        D: Duration;
        Expected: Text;
    begin
        D := 5000;
        Expected := Format(D, 0, 9);
        Assert.AreEqual(Expected, Sut.DurationToInvariantText(D), 'Duration invariant text should match XML format');
    end;

    [Test]
    procedure TestTimeToText_Noon()
    var
        T: Time;
        Result: Text;
    begin
        T := 120000T;
        Result := Sut.TimeToText(T);
        Assert.AreNotEqual('', Result, 'Time should render to non-empty Text');
        Assert.IsTrue(Result.Contains('12'), 'Time 12:00 should contain hour "12"');
    end;

    [Test]
    procedure TestTimeToInvariantText_Noon()
    var
        T: Time;
        Expected: Text;
    begin
        T := 120000T;
        Expected := Format(T, 0, 9);
        Assert.AreEqual(Expected, Sut.TimeToInvariantText(T), 'Time invariant text should match XML format');
    end;
}
