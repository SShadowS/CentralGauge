codeunit 70016 "CG Secure Storage"
{
    Access = Public;

    var
        ApiKeyStorageKeyTok: Label 'CG_API_KEY', Locked = true;

    procedure StoreApiKey(ApiKey: SecretText)
    begin
        IsolatedStorage.Set(ApiKeyStorageKeyTok, ApiKey, DataScope::Module);
    end;

    procedure RetrieveApiKey(): SecretText
    var
        StoredApiKey: SecretText;
    begin
        if IsolatedStorage.Contains(ApiKeyStorageKeyTok, DataScope::Module) then
            IsolatedStorage.Get(ApiKeyStorageKeyTok, DataScope::Module, StoredApiKey);

        exit(StoredApiKey);
    end;

    procedure BuildAuthHeader(var Request: HttpRequestMessage; ApiKey: SecretText): Boolean
    var
        Headers: HttpHeaders;
        AuthorizationValue: SecretText;
    begin
        AuthorizationValue := SecretStrSubstNo('Bearer %1', ApiKey);

        Request.GetHeaders(Headers);
        exit(Headers.Add('Authorization', AuthorizationValue));
    end;

    procedure ValidateCredentials(ApiKey: SecretText): Boolean
    begin
        if ApiKey.IsEmpty() then
            exit(false);

        exit(true);
    end;
}