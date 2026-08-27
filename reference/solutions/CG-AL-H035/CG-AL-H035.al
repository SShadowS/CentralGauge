codeunit 70350 "CG H035 Auth"
{
    Access = Public;

    procedure AddApiKeyHeader(var Request: HttpRequestMessage; ApiKey: SecretText): Boolean
    var
        Headers: HttpHeaders;
    begin
        Request.GetHeaders(Headers);
        if Headers.Contains('X-Api-Key') then
            Headers.Remove('X-Api-Key');
        exit(Headers.Add('X-Api-Key', ApiKey));
    end;
}