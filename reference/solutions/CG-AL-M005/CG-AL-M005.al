codeunit 70002 "External Payment Service"
{
    var
        BaseUrlTxt: Label 'https://api.paymentservice.example.com/v1', Locked = true;
        ApiKeyTxt: Label 'Bearer %1', Locked = true;
        InvalidAmountErr: Label 'Payment amount must be greater than zero';
        HttpCallFailedErr: Label 'The HTTP request to the payment service failed. Status Code: %1, Reason: %2', Comment = '%1 = HTTP status code, %2 = reason phrase';
        ConnectionFailedErr: Label 'Could not connect to the external payment service after %1 attempts. Please check your network connection and try again.', Comment = '%1 = number of retry attempts';
        InvalidJsonResponseErr: Label 'The payment service returned an invalid JSON response.';
        MaxRetries: Integer;
        TimeoutMs: Integer;

    procedure SendPaymentRequest(OrderId: Text; Amount: Decimal; Currency: Text; var ResponseJson: JsonObject): Boolean
    var
        RequestJson: JsonObject;
        RequestBodyText: Text;
        ResponseText: Text;
    begin
        if Amount <= 0 then
            Error(InvalidAmountErr);

        RequestJson.Add('orderId', OrderId);
        RequestJson.Add('amount', Amount);
        RequestJson.Add('currency', Currency);
        RequestJson.Add('requestedAt', Format(CurrentDateTime(), 0, 9));
        RequestJson.WriteTo(RequestBodyText);

        if not TrySendHttpRequest('POST', BaseUrlTxt + '/payments', RequestBodyText, ResponseText) then
            exit(false);

        Clear(ResponseJson);
        if not ResponseJson.ReadFrom(ResponseText) then
            Error(InvalidJsonResponseErr);

        exit(true);
    end;

    procedure ValidatePaymentResponse(Response: JsonObject): Boolean
    var
        StatusToken: JsonToken;
        TransactionIdToken: JsonToken;
        AmountToken: JsonToken;
        StatusValue: Text;
    begin
        if not Response.Get('status', StatusToken) then
            exit(false);

        if not Response.Get('transactionId', TransactionIdToken) then
            exit(false);

        if not Response.Get('amount', AmountToken) then
            exit(false);

        if not StatusToken.IsValue() then
            exit(false);

        StatusValue := StatusToken.AsValue().AsText();
        exit(StatusValue = 'approved');
    end;

    procedure GetPaymentStatus(TransactionId: Text): Text
    var
        ResponseJson: JsonObject;
        StatusToken: JsonToken;
        ResponseText: Text;
        RequestUrl: Text;
    begin
        if TransactionId = '' then
            exit('');

        RequestUrl := BaseUrlTxt + '/payments/' + TransactionId + '/status';

        if not TrySendHttpRequest('GET', RequestUrl, '', ResponseText) then
            exit('');

        if not ResponseJson.ReadFrom(ResponseText) then
            exit('');

        if not ResponseJson.Get('status', StatusToken) then
            exit('');

        if not StatusToken.IsValue() then
            exit('');

        exit(StatusToken.AsValue().AsText());
    end;

    procedure HandlePaymentWebhook(WebhookData: JsonObject): Boolean
    var
        EventToken: JsonToken;
        TransactionIdToken: JsonToken;
        AmountToken: JsonToken;
        EventName: Text;
        TransactionId: Text[50];
        Amount: Decimal;
    begin
        if WebhookData.Keys().Count() = 0 then
            exit(false);

        if not WebhookData.Get('event', EventToken) then
            exit(false);

        if not EventToken.IsValue() then
            exit(false);

        EventName := EventToken.AsValue().AsText();
        if EventName = '' then
            exit(false);

        if WebhookData.Get('transactionId', TransactionIdToken) then
            if TransactionIdToken.IsValue() then
                TransactionId := CopyStr(TransactionIdToken.AsValue().AsText(), 1, MaxStrLen(TransactionId));

        if WebhookData.Get('amount', AmountToken) then
            if AmountToken.IsValue() then
                Amount := AmountToken.AsValue().AsDecimal();

        case EventName of
            'payment.completed':
                begin
                    LogPaymentTransaction(TransactionId, Amount, 'completed');
                    exit(true);
                end;
            'payment.failed':
                begin
                    LogPaymentTransaction(TransactionId, Amount, 'failed');
                    exit(true);
                end;
            'payment.refunded':
                begin
                    LogPaymentTransaction(TransactionId, Amount, 'refunded');
                    exit(true);
                end;
            else begin
                LogPaymentTransaction(TransactionId, Amount, 'unknown');
                exit(true);
            end;
        end;
    end;

    procedure LogPaymentTransaction(TransactionId: Text[50]; Amount: Decimal; Status: Text[20])
    var
        LogDimensions: Dictionary of [Text, Text];
        PaymentLogMsgTxt: Label 'Payment transaction logged. TransactionId: %1, Amount: %2, Status: %3', Comment = '%1 = transaction id, %2 = amount, %3 = status';
    begin
        LogDimensions.Add('TransactionId', TransactionId);
        LogDimensions.Add('Amount', Format(Amount, 0, 9));
        LogDimensions.Add('Status', Status);
        LogDimensions.Add('LoggedAt', Format(CurrentDateTime(), 0, 9));

        Session.LogMessage(
            'EPS-0001',
            StrSubstNo(PaymentLogMsgTxt, TransactionId, Format(Amount, 0, 9), Status),
            Verbosity::Normal,
            DataClassification::SystemMetadata,
            TelemetryScope::ExtensionPublisher,
            LogDimensions);
    end;

    [TryFunction]
    local procedure TrySendHttpRequest(Method: Text; Url: Text; RequestBody: Text; var ResponseText: Text)
    var
        Client: HttpClient;
        RequestMessage: HttpRequestMessage;
        ResponseMessage: HttpResponseMessage;
        Content: HttpContent;
        ContentHeaders: HttpHeaders;
        Attempt: Integer;
        Success: Boolean;
    begin
        InitializeSettings();

        Client.Timeout(TimeoutMs);
        Client.DefaultRequestHeaders().Add('Authorization', StrSubstNo(ApiKeyTxt, GetApiKey()));
        Client.DefaultRequestHeaders().Add('Accept', 'application/json');

        RequestMessage.Method(Method);
        RequestMessage.SetRequestUri(Url);

        if RequestBody <> '' then begin
            Content.WriteFrom(RequestBody);
            Content.GetHeaders(ContentHeaders);
            ContentHeaders.Clear();
            ContentHeaders.Add('Content-Type', 'application/json');
            RequestMessage.Content(Content);
        end;

        Success := false;
        for Attempt := 1 to MaxRetries do begin
            Clear(ResponseMessage);
            if Client.Send(RequestMessage, ResponseMessage) then begin
                if ResponseMessage.IsSuccessStatusCode() then begin
                    Success := true;
                    break;
                end;

                if not IsRetryableStatusCode(ResponseMessage.HttpStatusCode()) then
                    Error(HttpCallFailedErr, ResponseMessage.HttpStatusCode(), ResponseMessage.ReasonPhrase());
            end;

            if Attempt < MaxRetries then
                Sleep(Attempt * 1000);
        end;

        if not Success then begin
            if ResponseMessage.HttpStatusCode() <> 0 then
                Error(HttpCallFailedErr, ResponseMessage.HttpStatusCode(), ResponseMessage.ReasonPhrase());
            Error(ConnectionFailedErr, MaxRetries);
        end;

        ResponseMessage.Content().ReadAs(ResponseText);
    end;

    local procedure IsRetryableStatusCode(StatusCode: Integer): Boolean
    begin
        exit(StatusCode in [408, 429, 500, 502, 503, 504]);
    end;

    local procedure InitializeSettings()
    begin
        MaxRetries := 3;
        TimeoutMs := 30000;
    end;

    local procedure GetApiKey(): Text
    begin
        // In a production scenario, retrieve the API key from Isolated Storage or Azure Key Vault.
        exit('PLACEHOLDER-API-KEY');
    end;
}