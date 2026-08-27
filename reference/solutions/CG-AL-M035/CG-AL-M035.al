codeunit 70035 "CG HttpClient Cert Demo"
{
    Access = Public;

    procedure SetAndCapture(NewValue: Boolean): Boolean
    var
        Client: HttpClient;
        CapturedValue: Boolean;
    begin
        CapturedValue := Client.UseServerCertificateValidation(NewValue);
        exit(CapturedValue);
    end;
}