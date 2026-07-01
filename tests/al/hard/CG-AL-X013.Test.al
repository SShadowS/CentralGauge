codeunit 80302 "CG-AL-X013 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    [Test]
    procedure CombineShortInputsFitsUnderTenChars()
    var
        Joiner: Codeunit "CG X013 Joiner";
        Result: Code[20];
    begin
        // [GIVEN] Two short Code[10] inputs whose concatenation fits well
        // within 10 characters

        // [WHEN] Combine appends Suffix to the end of Prefix
        Result := Joiner.Combine('AB', 'CD');

        // [THEN] The result is the plain concatenation
        Assert.AreEqual('ABCD', Result, 'Short concatenation must equal Prefix followed by Suffix');
    end;

    [Test]
    procedure CombineFullInputsNeedsTwentyChars()
    var
        Joiner: Codeunit "CG X013 Joiner";
        Result: Code[20];
    begin
        // [GIVEN] Two full-length Code[10] inputs whose concatenation needs
        // all 20 characters

        // [WHEN] Combine appends Suffix to the end of Prefix
        Result := Joiner.Combine('ABCDEFGHIJ', 'KLMNOPQRST');

        // [THEN] The full 20-character result is preserved, not truncated
        // or thrown away
        Assert.AreEqual('ABCDEFGHIJKLMNOPQRST', Result, 'Full-length concatenation must not be truncated or overflow');
    end;
}
