codeunit 70360 "CG H036 Token Parser"
{
    Access = Public;

    procedure ParseAccessToken(JsonText: Text): SecretText
    var
        TokenJsonObject: JsonObject;
        AccessTokenJsonToken: JsonToken;
        EmptyToken: SecretText;
    begin
        if not TokenJsonObject.ReadFrom(JsonText) then
            exit(EmptyToken);

        if not TokenJsonObject.Get('access_token', AccessTokenJsonToken) then
            exit(EmptyToken);

        exit(AccessTokenJsonToken.AsValue().AsText());
    end;
}