codeunit 70122 "CG Weather Service"
{
    Access = Public;

    procedure GetTemperature(City: Text): Decimal
    var
        Client: HttpClient;
        Response: HttpResponseMessage;
        ResponseText: Text;
        JsonObj: JsonObject;
        JsonTok: JsonToken;
        Url: Text;
    begin
        Url := StrSubstNo('https://api.weather.example/temperature?city=%1', City);

        if not Client.Get(Url, Response) then
            exit(0);

        if not Response.IsSuccessStatusCode() then
            exit(0);

        if not Response.Content.ReadAs(ResponseText) then
            exit(0);

        if not JsonObj.ReadFrom(ResponseText) then
            exit(0);

        if not JsonObj.Get('temperature', JsonTok) then
            exit(0);

        exit(JsonTok.AsValue().AsDecimal());
    end;

    procedure PostWeatherReport(ReportJson: Text): Boolean
    var
        Client: HttpClient;
        Request: HttpRequestMessage;
        Response: HttpResponseMessage;
        Content: HttpContent;
        ContentHeaders: HttpHeaders;
    begin
        Content.WriteFrom(ReportJson);
        Content.GetHeaders(ContentHeaders);
        if ContentHeaders.Contains('Content-Type') then
            ContentHeaders.Remove('Content-Type');
        ContentHeaders.Add('Content-Type', 'application/json');

        Request.Method := 'POST';
        Request.SetRequestUri('https://api.weather.example/reports');
        Request.Content := Content;

        if not Client.Send(Request, Response) then
            exit(false);

        exit((Response.HttpStatusCode() = 200) or (Response.HttpStatusCode() = 201));
    end;

    procedure GetForecast(City: Text; Days: Integer): Text
    var
        Client: HttpClient;
        Response: HttpResponseMessage;
        ResponseText: Text;
        Url: Text;
    begin
        Url := StrSubstNo('https://api.weather.example/forecast?city=%1&days=%2', City, Days);

        if not Client.Get(Url, Response) then
            exit('');

        if not Response.IsSuccessStatusCode() then
            exit('');

        if not Response.Content.ReadAs(ResponseText) then
            exit('');

        exit(ResponseText);
    end;

    procedure IsServiceAvailable(): Boolean
    var
        Client: HttpClient;
        Response: HttpResponseMessage;
    begin
        if not Client.Get('https://api.weather.example/health', Response) then
            exit(false);

        exit(Response.HttpStatusCode() = 200);
    end;
}