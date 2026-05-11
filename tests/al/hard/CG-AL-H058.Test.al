codeunit 80273 "CG-AL-H058 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure TestAsciiRoundTrip()
    var
        Codec: Codeunit "CG H058 Codec";
        Encoded: Text;
        Decoded: Text;
    begin
        Encoded := Codec.EncodeBase64('hello world');
        Decoded := Codec.DecodeBase64(Encoded);
        Assert.AreEqual('hello world', Decoded, 'ASCII text must round-trip identically.');
    end;

    [Test]
    procedure TestLatinAccentsRoundTrip()
    var
        Codec: Codeunit "CG H058 Codec";
        Decoded: Text;
    begin
        // 'café résumé' includes accented Latin code points outside ASCII.
        Decoded := Codec.DecodeBase64(Codec.EncodeBase64('café résumé'));
        Assert.AreEqual('café résumé', Decoded, 'Latin accents must round-trip; a non-UTF-8 encoding will mangle them.');
    end;

    [Test]
    procedure TestCjkRoundTrip()
    var
        Codec: Codeunit "CG H058 Codec";
        Decoded: Text;
    begin
        // CJK code points require multi-byte UTF-8 sequences.
        Decoded := Codec.DecodeBase64(Codec.EncodeBase64('日本語'));
        Assert.AreEqual('日本語', Decoded, 'CJK characters must round-trip; Windows-1252 will lose them.');
    end;

    [Test]
    procedure TestMixedRoundTrip()
    var
        Codec: Codeunit "CG H058 Codec";
        Input: Text;
        Decoded: Text;
    begin
        Input := 'Hello, café 中文 ✓';
        Decoded := Codec.DecodeBase64(Codec.EncodeBase64(Input));
        Assert.AreEqual(Input, Decoded, 'Mixed ASCII + Latin + CJK + symbol must round-trip.');
    end;

    [Test]
    procedure TestEmptyRoundTrip()
    var
        Codec: Codeunit "CG H058 Codec";
        Decoded: Text;
    begin
        Decoded := Codec.DecodeBase64(Codec.EncodeBase64(''));
        Assert.AreEqual('', Decoded, 'Empty string must round-trip.');
    end;
}
