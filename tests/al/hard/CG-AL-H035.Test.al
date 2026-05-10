codeunit 80250 "CG-AL-H035 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        Auth: Codeunit "CG H035 Auth";

    [Test]
    procedure TestAddApiKeyHeader_ReturnsTrue()
    var
        Request: HttpRequestMessage;
        ApiKey: SecretText;
        Added: Boolean;
    begin
        ApiKey := SecretText.SecretStrSubstNo('test-api-key-12345');

        Added := Auth.AddApiKeyHeader(Request, ApiKey);

        Assert.IsTrue(Added, 'AddApiKeyHeader should return true when the header is successfully added.');
    end;

    [Test]
    procedure TestAddApiKeyHeader_HeaderProbesAsSecret()
    var
        Request: HttpRequestMessage;
        Headers: HttpHeaders;
        ApiKey: SecretText;
    begin
        // [SCENARIO] HttpHeaders.ContainsSecret returns true only when the header value
        // was added through HttpHeaders.Add(Name: Text, Value: SecretText). If the model
        // unwraps the SecretText or routes the value through a Text intermediary,
        // ContainsSecret will not see the header and this assertion fails.
        ApiKey := SecretText.SecretStrSubstNo('probe-key');

        Auth.AddApiKeyHeader(Request, ApiKey);

        Request.GetHeaders(Headers);
        Assert.IsTrue(
            Headers.ContainsSecret('X-Api-Key'),
            'HttpHeaders.ContainsSecret(''X-Api-Key'') must return true: AddApiKeyHeader must use the SecretText overload of HttpHeaders.Add.');
    end;

    [Test]
    procedure TestAddApiKeyHeader_EmptySecretStillAdds()
    var
        Request: HttpRequestMessage;
        Headers: HttpHeaders;
        ApiKey: SecretText;
        Added: Boolean;
    begin
        ApiKey := SecretText.SecretStrSubstNo('');

        Added := Auth.AddApiKeyHeader(Request, ApiKey);

        Request.GetHeaders(Headers);
        Assert.IsTrue(Added, 'AddApiKeyHeader should return true even for an empty SecretText.');
        Assert.IsTrue(
            Headers.ContainsSecret('X-Api-Key'),
            'ContainsSecret must still see the header after an empty-SecretText add.');
    end;
}
