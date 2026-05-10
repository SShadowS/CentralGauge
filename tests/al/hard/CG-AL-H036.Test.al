codeunit 80251 "CG-AL-H036 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        Parser: Codeunit "CG H036 Token Parser";

    [Test]
    procedure TestParseAccessToken_ValidJson_ReturnsNonEmptySecret()
    var
        Token: SecretText;
    begin
        Token := Parser.ParseAccessToken('{"access_token":"abcdef-12345","token_type":"Bearer"}');
        Assert.IsFalse(Token.IsEmpty(), 'SecretText must be non-empty after parsing a valid access_token.');
    end;

    [Test]
    procedure TestParseAccessToken_MissingProperty_ReturnsEmpty()
    var
        Token: SecretText;
    begin
        Token := Parser.ParseAccessToken('{"refresh_token":"xyz"}');
        Assert.IsTrue(Token.IsEmpty(), 'SecretText must be empty when access_token is absent.');
    end;

    [Test]
    procedure TestParseAccessToken_InvalidJson_ReturnsEmpty()
    var
        Token: SecretText;
    begin
        Token := Parser.ParseAccessToken('not a json at all');
        Assert.IsTrue(Token.IsEmpty(), 'SecretText must be empty when input is not valid JSON.');
    end;

    [Test]
    procedure TestParseAccessToken_EmptyTokenValue_StillParses()
    var
        Token: SecretText;
    begin
        // The JSON parses; access_token exists but its value is empty.
        // SecretText built from empty Text reports IsEmpty()=true.
        Token := Parser.ParseAccessToken('{"access_token":""}');
        Assert.IsTrue(Token.IsEmpty(), 'SecretText built from an empty access_token value must report IsEmpty()=true.');
    end;

    [Test]
    procedure TestParseAccessToken_NestedJson_ReadsTopLevelOnly()
    var
        Token: SecretText;
    begin
        // access_token at top level should be picked. Nested object should be ignored.
        Token := Parser.ParseAccessToken('{"access_token":"top","details":{"access_token":"nested"}}');
        Assert.IsFalse(Token.IsEmpty(), 'Top-level access_token must be returned.');
    end;
}
