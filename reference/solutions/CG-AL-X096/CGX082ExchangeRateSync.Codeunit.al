codeunit 70472 "CG X082 Exchange Rate Sync"
{
    procedure RefreshRate(CurrencyPair: Text; Handler: Interface "CG X082 Http Handler"; var Rate: Decimal): Boolean
    var
        ResilientClient: Codeunit "CG X082 Resilient Http Client";
        CallLog: Record "CG X082 Call Log";
        ResponseBody: Text;
        ResponseJson: JsonObject;
        RateToken: JsonToken;
        Endpoint: Text;
        Success: Boolean;
    begin
        Endpoint := 'https://rates.example.com/v1/latest?base=' + CurrencyPair;
        Success := ResilientClient.GetWithRetry(Endpoint, 5, Handler, ResponseBody);

        Rate := 0;
        if Success then
            if ResponseJson.ReadFrom(ResponseBody) then
                if ResponseJson.Get('rate', RateToken) then
                    Rate := RateToken.AsValue().AsDecimal();

        CallLog.Init();
        CallLog."Endpoint" := CopyStr(Endpoint, 1, MaxStrLen(CallLog."Endpoint"));
        CallLog."Succeeded" := Success;
        CallLog."Total Backoff (ms)" := ResilientClient.GetTotalBackoffMs();
        CallLog."Logged At" := CurrentDateTime();
        CallLog.Insert(true);

        exit(Success);
    end;
}
