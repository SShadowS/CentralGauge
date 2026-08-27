codeunit 70036 "CG WriteWithSecrets Demo"
{
    Access = Public;

    procedure WriteSecretsViaDict(): Boolean
    var
        JsonObj: JsonObject;
        Secrets: Dictionary of [Text, SecretText];
        ApiKeySecret: SecretText;
        SaltSecret: SecretText;
        Result: SecretText;
        Success: Boolean;
    begin
        JsonObj.Add('api_key', 'placeholder');
        JsonObj.Add('salt', 'placeholder');

        ApiKeySecret := SecretText.SecretStrSubstNo('actual-api-key');
        SaltSecret := SecretText.SecretStrSubstNo('actual-salt');

        Secrets.Add('$.api_key', ApiKeySecret);
        Secrets.Add('$.salt', SaltSecret);

        Success := JsonObj.WriteWithSecretsTo(Secrets, Result);
        exit(Success);
    end;

    procedure WriteSecretsViaPath(): Boolean
    var
        JsonObj: JsonObject;
        TokenSecret: SecretText;
        Result: SecretText;
        Success: Boolean;
    begin
        JsonObj.Add('token', 'placeholder');

        TokenSecret := SecretText.SecretStrSubstNo('actual-token');

        Success := JsonObj.WriteWithSecretsTo('$.token', TokenSecret, Result);
        exit(Success);
    end;
}