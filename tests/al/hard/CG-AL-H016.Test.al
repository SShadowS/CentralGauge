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
        Client: HttpClient;
        ApiKey: SecretText;
        Added: Boolean;
    begin
        ApiKey := SecretText.SecretStrSubstNo('test-api-key-12345');

        Added := SecureStorage.BuildAuthHeader(Client, ApiKey);

        Assert.IsTrue(Added, 'BuildAuthHeader should report success');
        Assert.IsTrue(Client.DefaultRequestHeaders.Contains('Authorization'), 'Authorization header should be present on the HttpClient');
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
