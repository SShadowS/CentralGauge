codeunit 80017 "CG-AL-H016 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        SecureStorage: Codeunit "CG Secure Storage";

    [Test]
    procedure TestBuildAuthHeader_AddsAuthorizationHeader()
    var
        Request: HttpRequestMessage;
        ApiKey: SecretText;
        Added: Boolean;
    begin
        // [SCENARIO] BuildAuthHeader adds the Authorization header to the request.
        // The model is required to call Request.GetHeaders().Add('Authorization', ...) and
        // return its Boolean result. We assert the Boolean here because Authorization is a
        // typed (restricted) header in .NET: HttpHeaders.Contains and GetValues do not
        // surface it by name, so a name-based read-back is not a reliable check across
        // BC runtime versions.
        ApiKey := SecretText.SecretStrSubstNo('test-api-key-12345');

        Added := SecureStorage.BuildAuthHeader(Request, ApiKey);

        Assert.IsTrue(Added, 'BuildAuthHeader should return true when Headers.Add succeeds');
    end;

    [Test]
    procedure TestValidateCredentials_NonEmptySecretReturnsTrue()
    var
        ApiKey: SecretText;
        Result: Boolean;
    begin
        ApiKey := SecretText.SecretStrSubstNo('correct-password');

        Result := SecureStorage.ValidateCredentials(ApiKey);

        Assert.IsTrue(Result, 'Non-empty SecretText should validate as true');
    end;

    [Test]
    procedure TestValidateCredentials_EmptySecretReturnsFalse()
    var
        ApiKey: SecretText;
        Result: Boolean;
    begin
        ApiKey := SecretText.SecretStrSubstNo('');

        Result := SecureStorage.ValidateCredentials(ApiKey);

        Assert.IsFalse(Result, 'Empty SecretText should validate as false');
    end;

    [Test]
    procedure TestStoreAndRetrieve_RoundTrip()
    var
        OriginalKey: SecretText;
        RetrievedKey: SecretText;
    begin
        OriginalKey := SecretText.SecretStrSubstNo('my-secret-api-key');

        SecureStorage.StoreApiKey(OriginalKey);

        Assert.IsTrue(IsolatedStorage.Contains('CG_API_KEY', DataScope::Module), 'IsolatedStorage should contain the stored key after StoreApiKey');

        RetrievedKey := SecureStorage.RetrieveApiKey();

        Assert.IsFalse(RetrievedKey.IsEmpty(), 'Retrieved SecretText should not be empty');
    end;
}
