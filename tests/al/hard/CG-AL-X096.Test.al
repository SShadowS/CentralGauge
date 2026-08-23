codeunit 89192 "CG-AL-X096 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;
        ShippingNsLbl: Label 'urn:tryal:freight:shipping:v2', Locked = true;
        TrackingNsLbl: Label 'urn:tryal:freight:tracking:v1', Locked = true;
        ForeignNsLbl: Label 'urn:partner:audit:v1', Locked = true;

    // Default test isolation persists writes between test methods, so every
    // test clears the tables it touches before seeding or importing anything.

    local procedure ClearLog()
    var
        CallLog: Record "CG X082 Call Log";
    begin
        CallLog.DeleteAll();
    end;

    local procedure ShippingMessage(InnerXml: Text): Text
    begin
        exit('<?xml version="1.0" encoding="UTF-8"?>' +
            '<ShipmentStatus xmlns="' + ShippingNsLbl + '">' + InnerXml + '</ShipmentStatus>');
    end;

    local procedure TrackingElement(Value: Text): Text
    begin
        exit('<trk:TrackingNo xmlns:trk="' + TrackingNsLbl + '">' + Value + '</trk:TrackingNo>');
    end;

    local procedure AssertDecimalRoundTrips(Original: Decimal)
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Parsed: Decimal;
        WireText: Text;
    begin
        WireText := WireFormat.ToWireDecimal(Original);

        Assert.IsTrue(WireFormat.FromWireDecimal(WireText, Parsed),
            StrSubstNo('Expected the wire text produced for %1 to be accepted back in, but %2 was rejected', Original, WireText));
        Assert.AreEqual(Original, Parsed,
            StrSubstNo('Expected the round trip through %1 to reproduce the original amount %2', WireText, Original));
    end;

    local procedure AssertDateRoundTrips(Original: Date)
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Parsed: Date;
        WireText: Text;
    begin
        WireText := WireFormat.ToWireDate(Original);

        Assert.IsTrue(WireFormat.FromWireDate(WireText, Parsed),
            StrSubstNo('Expected the wire text produced for %1 to be accepted back in, but %2 was rejected', Original, WireText));
        Assert.AreEqual(Original, Parsed,
            StrSubstNo('Expected the round trip through %1 to reproduce the original date %2', WireText, Original));
    end;

    local procedure ClearData()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
    begin
        OrderLine.DeleteAll();
        Order.DeleteAll();
    end;

    local procedure SeedOrder(OrderNo: Code[20]; CustomerNo: Code[20]; OrderDate: Date; var Order: Record "CG X093 Order")
    begin
        Order.Init();
        Order."No." := OrderNo;
        Order."Customer No." := CustomerNo;
        Order."Order Date" := OrderDate;
        Order.Insert();
    end;

    local procedure SeedLine(OrderNo: Code[20]; LineNo: Integer; ItemNo: Code[20]; LineDescription: Text[100]; Qty: Decimal; UnitPrice: Decimal; LineAmount: Decimal; var OrderLine: Record "CG X093 Order Line")
    begin
        OrderLine.Init();
        OrderLine."Order No." := OrderNo;
        OrderLine."Line No." := LineNo;
        OrderLine."Item No." := ItemNo;
        OrderLine.Description := LineDescription;
        OrderLine.Quantity := Qty;
        OrderLine."Unit Price" := UnitPrice;
        OrderLine."Line Amount" := LineAmount;
        OrderLine.Insert();
    end;

    local procedure ParseExport(Order: Record "CG X093 Order") OrderObject: JsonObject
    var
        OrderExport: Codeunit "CG X093 Order Export";
        Payload: Text;
    begin
        Payload := OrderExport.ExportOrder(Order);
        Assert.IsTrue(OrderObject.ReadFrom(Payload),
            StrSubstNo('Expected ExportOrder to return well-formed JSON, but a parser rejected: %1', Payload));
    end;

    local procedure GetProperty(JsonObj: JsonObject; PropertyName: Text) Token: JsonToken
    begin
        Assert.IsTrue(JsonObj.Get(PropertyName, Token),
            StrSubstNo('Expected the exported document to contain a "%1" property', PropertyName));
    end;

    local procedure GetLine(OrderObject: JsonObject; Index: Integer) LineObject: JsonObject
    var
        LinesToken: JsonToken;
        LineToken: JsonToken;
    begin
        LinesToken := GetProperty(OrderObject, 'lines');
        Assert.IsTrue(LinesToken.IsArray(), 'Expected the "lines" property to be a JSON array');
        Assert.IsTrue(LinesToken.AsArray().Get(Index, LineToken),
            StrSubstNo('Expected the "lines" array to have an element at index %1', Index));
        Assert.IsTrue(LineToken.IsObject(), StrSubstNo('Expected element %1 of the "lines" array to be a JSON object', Index));
        LineObject := LineToken.AsObject();
    end;

    local procedure AssertTextProperty(JsonObj: JsonObject; PropertyName: Text; Expected: Text)
    var
        Token: JsonToken;
    begin
        Token := GetProperty(JsonObj, PropertyName);
        Assert.AreEqual(Expected, Token.AsValue().AsText(),
            StrSubstNo('Expected the "%1" property to carry the exact value from the order', PropertyName));
    end;

    local procedure AssertNumberProperty(JsonObj: JsonObject; PropertyName: Text; Expected: Decimal)
    var
        Token: JsonToken;
        RawValue: Text;
    begin
        Token := GetProperty(JsonObj, PropertyName);
        Assert.IsTrue(Token.IsValue(), StrSubstNo('Expected the "%1" property to be a plain JSON value, not an object or array', PropertyName));
        Token.WriteTo(RawValue);
        Assert.IsFalse(RawValue.StartsWith('"'),
            StrSubstNo('Expected the "%1" property to be an unquoted JSON number, but it serialized as %2', PropertyName, RawValue));
        Assert.AreEqual(Expected, Token.AsValue().AsDecimal(),
            StrSubstNo('Expected the "%1" property to carry the value from the order line', PropertyName));
    end;

    [Test]
    procedure RefreshRateRecoversFromRepeatedServerErrorBursts()
    var
        CallLog: Record "CG X082 Call Log";
        Sync: Codeunit "CG X082 Exchange Rate Sync";
        MockHandler: Codeunit "CG-AL-X096 Mock Http Handler";
        Rate: Decimal;
    begin
        // [SCENARIO] A run of 503s followed by a 200 must still recover within the attempt budget
        ClearLog();
        MockHandler.ScriptResponse(503, '{"rate": 7.25}');
        MockHandler.ScriptResponse(503, '{"rate": 7.25}');
        MockHandler.ScriptResponse(200, '{"rate": 7.25}');

        Assert.IsTrue(Sync.RefreshRate('USDEUR', MockHandler, Rate),
            'Expected RefreshRate to recover after two 503 responses and a final success, the same way it recovers from repeated 500s');
        Assert.AreEqual(7.25, Rate, 'Expected the rate from the final successful response');
        Assert.AreEqual(3, MockHandler.GetRequestCount(), 'Expected exactly three requests: two 503s that were retried and the 200 that finally succeeded');

        CallLog.FindLast();
        Assert.IsTrue(CallLog.Succeeded, 'Expected the call log entry to record success once the retries recovered');
        Assert.AreEqual(300, CallLog."Total Backoff (ms)", 'Expected the call log to record the backoff spent on the two retried attempts (100 + 200)');
    end;

    [Test]
    procedure RefreshRateAlreadyRecoversFromTheFamiliarServerError()
    var
        CallLog: Record "CG X082 Call Log";
        Sync: Codeunit "CG X082 Exchange Rate Sync";
        MockHandler: Codeunit "CG-AL-X096 Mock Http Handler";
        Rate: Decimal;
    begin
        // [SCENARIO] Two 500s followed by a 200 recover correctly - the case that already works today
        ClearLog();
        MockHandler.ScriptResponse(500, '{"rate": 1.0854}');
        MockHandler.ScriptResponse(500, '{"rate": 1.0854}');
        MockHandler.ScriptResponse(200, '{"rate": 1.0854}');

        Assert.IsTrue(Sync.RefreshRate('USDGBP', MockHandler, Rate),
            'Expected RefreshRate to recover after two 500 responses and a final success');
        Assert.AreEqual(1.0854, Rate, 'Expected the rate from the final successful response');
        Assert.AreEqual(3, MockHandler.GetRequestCount(), 'Expected exactly three requests for the two retried 500s and the successful 200');

        CallLog.FindLast();
        Assert.IsTrue(CallLog.Succeeded, 'Expected the call log entry to record success once the retries recovered');
        Assert.AreEqual(300, CallLog."Total Backoff (ms)", 'Expected the call log to record the backoff spent on the two retried attempts (100 + 200)');
    end;

    [Test]
    procedure RefreshRateRecoversFromRateLimiting()
    var
        CallLog: Record "CG X082 Call Log";
        Sync: Codeunit "CG X082 Exchange Rate Sync";
        MockHandler: Codeunit "CG-AL-X096 Mock Http Handler";
        Rate: Decimal;
    begin
        // [SCENARIO] A rate-limited response followed by a 200 must recover the same way a 500 does
        ClearLog();
        MockHandler.ScriptResponse(429, '{"rate": 143.5}');
        MockHandler.ScriptResponse(200, '{"rate": 143.5}');

        Assert.IsTrue(Sync.RefreshRate('USDJPY', MockHandler, Rate),
            'Expected RefreshRate to recover after a rate-limited response and a final success, the same way it recovers from a 500');
        Assert.AreEqual(143.5, Rate, 'Expected the rate from the final successful response');
        Assert.AreEqual(2, MockHandler.GetRequestCount(), 'Expected exactly two requests: the rate-limited one that was retried and the 200 that succeeded');

        CallLog.FindLast();
        Assert.IsTrue(CallLog.Succeeded, 'Expected the call log entry to record success once the retry recovered');
        Assert.AreEqual(100, CallLog."Total Backoff (ms)", 'Expected the call log to record the backoff spent on the single retried attempt');
    end;

    [Test]
    procedure RefreshRateFailsWhenTheProviderNeverRecovers()
    var
        CallLog: Record "CG X082 Call Log";
        Sync: Codeunit "CG X082 Exchange Rate Sync";
        MockHandler: Codeunit "CG-AL-X096 Mock Http Handler";
        Rate: Decimal;
    begin
        // [SCENARIO] A provider that answers a server error for the whole attempt budget must report failure, not a stale or partial rate
        ClearLog();
        MockHandler.ScriptResponse(503, '{"rate": 999}');
        Rate := 42.5;

        Assert.IsFalse(Sync.RefreshRate('USDNOK', MockHandler, Rate),
            'Expected RefreshRate to return false when the provider answers 503 for the whole attempt budget');
        Assert.AreEqual(0, Rate, 'Expected the rate to reset to 0, not the stale value it was preset to, when every attempt failed');

        CallLog.FindLast();
        Assert.IsFalse(CallLog.Succeeded, 'Expected the call log entry to record failure when the provider never recovered');
        Assert.AreEqual(1500, CallLog."Total Backoff (ms)", 'Expected the call log to record the backoff spent on all four retried attempts (100+200+400+800)');
    end;

    [Test]
    procedure GivesUpImmediatelyOnANotFoundResponse()
    var
        Client: Codeunit "CG X082 Resilient Http Client";
        MockHandler: Codeunit "CG-AL-X096 Mock Http Handler";
        ResponseBody: Text;
    begin
        // [SCENARIO] A 404 must never be retried, even though a retry here would reach a 200
        MockHandler.ScriptResponse(404, '{"error":"not found"}');
        MockHandler.ScriptResponse(200, '{"rate": 999}');
        ResponseBody := 'stale value from a previous call';

        Assert.IsFalse(Client.GetWithRetry('https://rates.example.com/v1/latest?base=USDCHF', 3, MockHandler, ResponseBody),
            'Expected GetWithRetry to return false for a 404 - a permanent client error must not be retried, even though a retry here would have reached a 200');
        Assert.AreEqual(1, MockHandler.GetRequestCount(), 'Expected exactly one request for a 404 response - permanent errors are never retried');
        Assert.AreEqual('', ResponseBody, 'Expected the response body to end up empty after a 404, not the failed response body and not the stale value it was preset to');
        Assert.AreEqual(0, Client.GetTotalBackoffMs(), 'Expected no backoff on the tally when the call gives up without retrying');
    end;

    [Test]
    procedure GivesUpImmediatelyOnABadRequestResponse()
    var
        Client: Codeunit "CG X082 Resilient Http Client";
        MockHandler: Codeunit "CG-AL-X096 Mock Http Handler";
        ResponseBody: Text;
    begin
        // [SCENARIO] A 400 must never be retried either
        MockHandler.ScriptResponse(400, '{"error":"bad request"}');
        MockHandler.ScriptResponse(200, '{"rate": 999}');
        ResponseBody := 'stale value from a previous call';

        Assert.IsFalse(Client.GetWithRetry('https://rates.example.com/v1/latest?base=USDCAD', 3, MockHandler, ResponseBody),
            'Expected GetWithRetry to return false for a 400 - a permanent client error must not be retried, even though a retry here would have reached a 200');
        Assert.AreEqual(1, MockHandler.GetRequestCount(), 'Expected exactly one request for a 400 response - permanent errors are never retried');
        Assert.AreEqual('', ResponseBody, 'Expected the response body to end up empty after a 400, not the stale value it was preset to');
        Assert.AreEqual(0, Client.GetTotalBackoffMs(), 'Expected no backoff on the tally when the call gives up without retrying');
    end;

    [Test]
    procedure GivesUpImmediatelyJustBelowTheServerErrorRange()
    var
        Client: Codeunit "CG X082 Resilient Http Client";
        MockHandler: Codeunit "CG-AL-X096 Mock Http Handler";
        ResponseBody: Text;
    begin
        // [SCENARIO] 499 sits one below the server-error range and must never be retried
        MockHandler.ScriptResponse(499, '{"error":"client closed request"}');
        MockHandler.ScriptResponse(200, '{"rate": 999}');
        ResponseBody := 'stale value from a previous call';

        Assert.IsFalse(Client.GetWithRetry('https://rates.example.com/v1/latest?base=USDAUD', 3, MockHandler, ResponseBody),
            'Expected GetWithRetry to return false for a 499 - a permanent client error must not be retried, even though a retry here would have reached a 200');
        Assert.AreEqual(1, MockHandler.GetRequestCount(), 'Expected exactly one request for a 499 response - permanent errors are never retried');
        Assert.AreEqual('', ResponseBody, 'Expected the response body to end up empty after a 499, not the stale value it was preset to');
        Assert.AreEqual(0, Client.GetTotalBackoffMs(), 'Expected no backoff on the tally when the call gives up without retrying');
    end;

    [Test]
    procedure GivesUpImmediatelyOnAMidRangeClientError()
    var
        Client: Codeunit "CG X082 Resilient Http Client";
        MockHandler: Codeunit "CG-AL-X096 Mock Http Handler";
        ResponseBody: Text;
    begin
        // [SCENARIO] 451 is a permanent client error and must never be retried, the same as 400 or 404
        MockHandler.ScriptResponse(451, '{"error":"unavailable for legal reasons"}');
        MockHandler.ScriptResponse(200, '{"rate": 999}');
        ResponseBody := 'stale value from a previous call';

        Assert.IsFalse(Client.GetWithRetry('https://rates.example.com/v1/latest?base=USDNZD', 3, MockHandler, ResponseBody),
            'Expected GetWithRetry to return false for a 451 - a permanent client error must not be retried, even though a retry here would have reached a 200');
        Assert.AreEqual(1, MockHandler.GetRequestCount(), 'Expected exactly one request for a 451 response - permanent errors are never retried');
        Assert.AreEqual('', ResponseBody, 'Expected the response body to end up empty after a 451, not the stale value it was preset to');
        Assert.AreEqual(0, Client.GetTotalBackoffMs(), 'Expected no backoff on the tally when the call gives up without retrying');
    end;

    [Test]
    procedure RecoversFromALessCommonServerErrorCode()
    var
        Client: Codeunit "CG X082 Resilient Http Client";
        MockHandler: Codeunit "CG-AL-X096 Mock Http Handler";
        ResponseBody: Text;
    begin
        // [SCENARIO] 501 is just as much a server error as 500 or 503 and must recover the same way
        MockHandler.ScriptResponse(501, '');
        MockHandler.ScriptResponse(501, '');
        MockHandler.ScriptResponse(200, 'third-time-lucky');

        Assert.IsTrue(Client.GetWithRetry('https://rates.example.com/v1/latest?base=EURNOK', 5, MockHandler, ResponseBody),
            'Expected GetWithRetry to recover after two 501 responses and a final 200 - every server error status is worth retrying');
        Assert.AreEqual('third-time-lucky', ResponseBody, 'Expected the body of the third (successful) response');
        Assert.AreEqual(3, MockHandler.GetRequestCount(), 'Expected exactly three requests for the two retried 501s and the successful 200');
        Assert.AreEqual(300, Client.GetTotalBackoffMs(), 'Expected the backoff tally for two retries to be 100 ms + 200 ms = 300 ms');
    end;

    [Test]
    procedure RecoversFromTheHighestServerErrorCode()
    var
        Client: Codeunit "CG X082 Resilient Http Client";
        MockHandler: Codeunit "CG-AL-X096 Mock Http Handler";
        ResponseBody: Text;
    begin
        // [SCENARIO] 599 sits at the top of the server-error range and must recover exactly like 500 does
        MockHandler.ScriptResponse(599, '');
        MockHandler.ScriptResponse(200, 'recovered-after-599');

        Assert.IsTrue(Client.GetWithRetry('https://rates.example.com/v1/latest?base=EURSEK', 3, MockHandler, ResponseBody),
            'Expected GetWithRetry to recover after a 599 response and a final 200');
        Assert.AreEqual('recovered-after-599', ResponseBody, 'Expected the body of the successful response');
        Assert.AreEqual(2, MockHandler.GetRequestCount(), 'Expected exactly two requests: the retried 599 and the successful 200');
        Assert.AreEqual(100, Client.GetTotalBackoffMs(), 'Expected the backoff tally for one retry to be 100 ms');
    end;

    [Test]
    procedure RecoversFromEveryServerErrorStatusInTheFullRange()
    var
        Client: Codeunit "CG X082 Resilient Http Client";
        MockHandler: Codeunit "CG-AL-X096 Mock Http Handler";
        ResponseBody: Text;
        Status: Integer;
        PriorRequestCount: Integer;
    begin
        // [SCENARIO] Every status in 500-599 is transient and recovers within the attempt budget
        for Status := 500 to 599 do begin
            PriorRequestCount := MockHandler.GetRequestCount();
            MockHandler.ScriptResponse(Status, '');
            MockHandler.ScriptResponse(Status, '');
            MockHandler.ScriptResponse(200, 'recovered');

            Assert.IsTrue(Client.GetWithRetry(StrSubstNo('https://rates.example.com/v1/latest?base=EUR%1', Status), 5, MockHandler, ResponseBody),
                StrSubstNo('Expected GetWithRetry to recover after two %1 responses and a final 200', Status));
            Assert.AreEqual('recovered', ResponseBody,
                StrSubstNo('Expected the body of the successful response after two %1 responses', Status));
            Assert.AreEqual(3, MockHandler.GetRequestCount() - PriorRequestCount,
                StrSubstNo('Expected exactly three requests for two retried %1 responses and the successful 200', Status));
            Assert.AreEqual(300, Client.GetTotalBackoffMs(),
                StrSubstNo('Expected the backoff tally for two retries after a %1 to be 100 ms + 200 ms = 300 ms', Status));
        end;
    end;

    [Test]
    procedure SucceedsImmediatelyOnAnyTwoHundredStatus()
    var
        Client: Codeunit "CG X082 Resilient Http Client";
        MockHandler: Codeunit "CG-AL-X096 Mock Http Handler";
        SuccessStatuses: List of [Integer];
        SuccessStatus: Integer;
        ResponseBody: Text;
        PriorRequestCount: Integer;
    begin
        // [SCENARIO] Any status in the 2xx class succeeds on the first attempt, not only 200
        SuccessStatuses.Add(200);
        SuccessStatuses.Add(204);
        SuccessStatuses.Add(299);

        foreach SuccessStatus in SuccessStatuses do begin
            PriorRequestCount := MockHandler.GetRequestCount();
            MockHandler.ScriptResponse(SuccessStatus, StrSubstNo('payload-%1', SuccessStatus));

            Assert.IsTrue(Client.GetWithRetry(StrSubstNo('https://rates.example.com/v1/latest?base=EUR%1', SuccessStatus), 3, MockHandler, ResponseBody),
                StrSubstNo('Expected GetWithRetry to return true for a %1 response - any status in the 2xx class is a success', SuccessStatus));
            Assert.AreEqual(StrSubstNo('payload-%1', SuccessStatus), ResponseBody,
                StrSubstNo('Expected the response body to carry the body of the successful %1 response unchanged', SuccessStatus));
            Assert.AreEqual(1, MockHandler.GetRequestCount() - PriorRequestCount,
                StrSubstNo('Expected exactly one request when the first attempt already succeeded with a %1', SuccessStatus));
            Assert.AreEqual(0, Client.GetTotalBackoffMs(),
                StrSubstNo('Expected a backoff tally of 0 when the first attempt already succeeded with a %1', SuccessStatus));
        end;
    end;

    [Test]
    procedure ASingleAllowedAttemptMeansNoRetryEvenForAServerError()
    var
        Client: Codeunit "CG X082 Resilient Http Client";
        MockHandler: Codeunit "CG-AL-X096 Mock Http Handler";
        ResponseBody: Text;
    begin
        // [SCENARIO] MaxAttempts = 1 against a server error sends one request - an off-by-one retry would hit the scripted 200
        MockHandler.ScriptResponse(503, '');
        MockHandler.ScriptResponse(200, 'unreachable-success-body');
        ResponseBody := 'stale value from a previous call';

        Assert.IsFalse(Client.GetWithRetry('https://rates.example.com/v1/latest?base=EURHUF', 1, MockHandler, ResponseBody),
            'Expected GetWithRetry to return false when MaxAttempts is 1 and the only attempt gets a server error');
        Assert.AreEqual(1, MockHandler.GetRequestCount(), 'Expected exactly one request when MaxAttempts is 1 - the transient error leaves no budget for a retry');
        Assert.AreEqual('', ResponseBody, 'Expected the response body to end up empty when the single allowed attempt failed');
    end;

    [Test]
    procedure BackoffTallyStartsFreshOnEveryCall()
    var
        Client: Codeunit "CG X082 Resilient Http Client";
        MockHandler: Codeunit "CG-AL-X096 Mock Http Handler";
        ResponseBody: Text;
    begin
        // [SCENARIO] A second call on the same client instance reports its own tally, not a running total from the first call
        MockHandler.ScriptResponse(500, 'warm-up-body');
        MockHandler.ScriptResponse(200, 'warm-up-body');
        Client.GetWithRetry('https://rates.example.com/v1/latest?base=EURCZK', 3, MockHandler, ResponseBody);
        Assert.AreEqual(100, Client.GetTotalBackoffMs(), 'Expected the first call, which retried once, to report a backoff tally of 100 ms');

        MockHandler.ScriptResponse(200, 'second-call-body');
        Client.GetWithRetry('https://rates.example.com/v1/latest?base=EURCZK', 3, MockHandler, ResponseBody);

        Assert.AreEqual(0, Client.GetTotalBackoffMs(), 'Expected the second call, which never retried, to report a backoff tally of 0 - not the 100 ms left over from the first call');
        Assert.AreEqual(3, MockHandler.GetRequestCount(), 'Expected three requests in total: two for the first call (500 then 200) and one for the second (200)');
    end;

    [Test]
    procedure ImportCountsEveryPackageAndKeepsOtherFieldsAccurate()
    var
        ImportEntry: Record "CG X083 Shipment Import Entry";
        Mgt: Codeunit "CG X083 Shipment Import Mgt.";
        Any: Codeunit Any;
        ShipmentNo: Code[20];
        FirstTrackingNo: Text;
        SecondTrackingNo: Text;
        Payload: Text;
    begin
        ImportEntry.DeleteAll();

        ShipmentNo := CopyStr('SHP-' + UpperCase(Any.AlphanumericText(8)), 1, MaxStrLen(ShipmentNo));
        FirstTrackingNo := '1Z-' + UpperCase(Any.AlphanumericText(7));
        SecondTrackingNo := '1Z-' + UpperCase(Any.AlphanumericText(7));

        Payload := ShippingMessage(
            '<Header><ShipmentNo>' + ShipmentNo + '</ShipmentNo></Header>' +
            '<Packages>' +
            '<Package>' + TrackingElement(FirstTrackingNo) + '<Weight unit="KG">12.5</Weight></Package>' +
            '<Package>' + TrackingElement(SecondTrackingNo) + '<Weight unit="KG">3.25</Weight></Package>' +
            '<Package/>' +
            '</Packages>');

        Mgt.ImportShipmentStatus(Payload);

        ImportEntry.SetRange("Shipment No.", ShipmentNo);
        ImportEntry.FindLast();

        Assert.AreEqual(ShipmentNo, ImportEntry."Shipment No.", 'Expected the entry to record the shipment the message was for');
        Assert.AreEqual(3, ImportEntry."Package Count", 'Expected one count per package the shipment actually contains');
        Assert.AreEqual(2, ImportEntry."Tracking No. Count", 'Expected only the two packages that carry a tracking number to be counted as tracked');
        Assert.AreEqual('KG', ImportEntry."Weight Unit", 'Expected the unit of the first package that carries one');
        Assert.AreEqual(ImportEntry.Status::Received, ImportEntry.Status, 'Expected a shipment with packages to be marked as received, not empty');
    end;

    [Test]
    procedure ImportCountsEveryPackageWhenTheSenderFormatsTheMessageDifferently()
    var
        ImportEntry: Record "CG X083 Shipment Import Entry";
        Mgt: Codeunit "CG X083 Shipment Import Mgt.";
        Any: Codeunit Any;
        ShipmentNo: Code[20];
        Payload: Text;
    begin
        ImportEntry.DeleteAll();

        ShipmentNo := CopyStr('SHP-' + UpperCase(Any.AlphanumericText(8)), 1, MaxStrLen(ShipmentNo));

        Payload := '<?xml version="1.0" encoding="UTF-8"?>' +
            '<f:ShipmentStatus xmlns:f="' + ShippingNsLbl + '">' +
            '<f:Header><f:ShipmentNo>' + ShipmentNo + '</f:ShipmentNo></f:Header>' +
            '<f:Packages>' +
            '<f:Package>' + TrackingElement('1Z-' + UpperCase(Any.AlphanumericText(7))) + '<f:Weight unit="LB">10</f:Weight></f:Package>' +
            '<f:Package>' + TrackingElement('1Z-' + UpperCase(Any.AlphanumericText(7))) + '<f:Weight unit="LB">20</f:Weight></f:Package>' +
            '</f:Packages>' +
            '</f:ShipmentStatus>';

        Mgt.ImportShipmentStatus(Payload);

        ImportEntry.SetRange("Shipment No.", ShipmentNo);
        ImportEntry.FindLast();

        Assert.AreEqual(2, ImportEntry."Package Count", 'Expected one count per package however the sender chose to format this particular message - the two carriers'' messages describe the same shipment shape');
        Assert.AreEqual(ImportEntry.Status::Received, ImportEntry.Status, 'Expected a shipment with packages to be marked as received, not empty');
    end;

    [Test]
    procedure ForeignPackagesFromOtherPartnersNeverInflateTheCount()
    var
        ImportEntry: Record "CG X083 Shipment Import Entry";
        Mgt: Codeunit "CG X083 Shipment Import Mgt.";
        Any: Codeunit Any;
        ShipmentNo: Code[20];
        Payload: Text;
    begin
        ImportEntry.DeleteAll();

        ShipmentNo := CopyStr('SHP-' + UpperCase(Any.AlphanumericText(8)), 1, MaxStrLen(ShipmentNo));

        Payload := ShippingMessage(
            '<Header><ShipmentNo>' + ShipmentNo + '</ShipmentNo></Header>' +
            '<Packages>' +
            '<Package><Weight unit="KG">1.5</Weight></Package>' +
            '<aud:Package xmlns:aud="' + ForeignNsLbl + '"/>' +
            '<Package><Weight unit="KG">2.0</Weight></Package>' +
            '</Packages>' +
            '<aud:Package xmlns:aud="' + ForeignNsLbl + '"/>');

        Mgt.ImportShipmentStatus(Payload);

        ImportEntry.SetRange("Shipment No.", ShipmentNo);
        ImportEntry.FindLast();

        Assert.AreEqual(2, ImportEntry."Package Count", 'Expected only the shipment''s own packages to count, not another partner''s decoy packages that happen to share the same element name');
        Assert.AreEqual(ImportEntry.Status::Received, ImportEntry.Status, 'Expected a shipment with real packages to be marked as received, not empty');
    end;

    [Test]
    procedure APackageThatCarriesNoShipmentIdentityIsNeverCounted()
    var
        ImportEntry: Record "CG X083 Shipment Import Entry";
        Mgt: Codeunit "CG X083 Shipment Import Mgt.";
        Any: Codeunit Any;
        ShipmentNo: Code[20];
        Payload: Text;
    begin
        ImportEntry.DeleteAll();

        ShipmentNo := CopyStr('SHP-' + UpperCase(Any.AlphanumericText(8)), 1, MaxStrLen(ShipmentNo));

        Payload := ShippingMessage(
            '<Header><ShipmentNo>' + ShipmentNo + '</ShipmentNo></Header>' +
            '<Packages>' +
            '<Package><Weight unit="KG">1.5</Weight></Package>' +
            '<Package xmlns=""/>' +
            '<Package><Weight unit="KG">2.0</Weight></Package>' +
            '</Packages>');

        Mgt.ImportShipmentStatus(Payload);

        ImportEntry.SetRange("Shipment No.", ShipmentNo);
        ImportEntry.FindLast();

        Assert.AreEqual(2, ImportEntry."Package Count", 'Expected only the shipment''s own identified packages to count, not a decoy package that carries no shipment identity at all');
        Assert.AreEqual(ImportEntry.Status::Received, ImportEntry.Status, 'Expected a shipment with real packages to be marked as received, not empty');
    end;

    [Test]
    procedure EmptyShipmentReportsZeroPackagesWithoutError()
    var
        ImportEntry: Record "CG X083 Shipment Import Entry";
        Mgt: Codeunit "CG X083 Shipment Import Mgt.";
        Any: Codeunit Any;
        ShipmentNo: Code[20];
        Payload: Text;
    begin
        ImportEntry.DeleteAll();

        ShipmentNo := CopyStr('SHP-' + UpperCase(Any.AlphanumericText(8)), 1, MaxStrLen(ShipmentNo));

        Payload := ShippingMessage('<Header><ShipmentNo>' + ShipmentNo + '</ShipmentNo></Header><Packages/>');

        Mgt.ImportShipmentStatus(Payload);

        ImportEntry.SetRange("Shipment No.", ShipmentNo);
        ImportEntry.FindLast();

        Assert.AreEqual(0, ImportEntry."Package Count", 'Expected zero for a shipment that genuinely carries no packages - not an error');
        Assert.AreEqual(0, ImportEntry."Tracking No. Count", 'Expected zero tracking numbers when there are no packages to carry one');
        Assert.AreEqual('', ImportEntry."Weight Unit", 'Expected an empty weight unit when there are no packages to weigh');
        Assert.AreEqual(ImportEntry.Status::"Empty Shipment", ImportEntry.Status, 'Expected a shipment with no packages to be marked empty');
    end;

    [Test]
    procedure TheOldMessageFormatStillImportsAnEmptyShipmentCleanly()
    var
        ImportEntry: Record "CG X083 Shipment Import Entry";
        Mgt: Codeunit "CG X083 Shipment Import Mgt.";
        Payload: Text;
    begin
        ImportEntry.DeleteAll();

        // The format the gateway used before it went live with real carrier
        // traffic - no shipment number, no packages, nothing to find.
        Payload := '<?xml version="1.0" encoding="UTF-8"?><ShipmentStatus><Header/><Packages/></ShipmentStatus>';

        Mgt.ImportShipmentStatus(Payload);

        ImportEntry.FindLast();

        Assert.AreEqual('', ImportEntry."Shipment No.", 'Expected an empty shipment number when the message carries none');
        Assert.AreEqual(0, ImportEntry."Package Count", 'Expected zero packages for a message that carries none, the same as it always did for this message shape');
        Assert.AreEqual(0, ImportEntry."Tracking No. Count", 'Expected zero tracking numbers for a message that carries none');
        Assert.AreEqual('', ImportEntry."Weight Unit", 'Expected an empty weight unit for a message that carries no packages');
        Assert.AreEqual(ImportEntry.Status::"Empty Shipment", ImportEntry.Status, 'Expected a shipment with no packages to be marked empty, exactly as this message shape always reported');
    end;

    [Test]
    procedure GetLastImportedPackageCountMatchesTheMostRecentImportForThatShipment()
    var
        ImportEntry: Record "CG X083 Shipment Import Entry";
        Mgt: Codeunit "CG X083 Shipment Import Mgt.";
        Any: Codeunit Any;
        ShipmentNo: Code[20];
        OtherShipmentNo: Code[20];
        FirstPayload: Text;
        SecondPayload: Text;
    begin
        ImportEntry.DeleteAll();

        ShipmentNo := CopyStr('SHP-' + UpperCase(Any.AlphanumericText(8)), 1, MaxStrLen(ShipmentNo));
        OtherShipmentNo := CopyStr('SHP-' + UpperCase(Any.AlphanumericText(8)), 1, MaxStrLen(OtherShipmentNo));

        ImportEntry.Init();
        ImportEntry."Shipment No." := OtherShipmentNo;
        ImportEntry."Package Count" := 777;
        ImportEntry.Status := ImportEntry.Status::Received;
        ImportEntry."Imported At" := CurrentDateTime();
        ImportEntry.Insert(true);

        FirstPayload := ShippingMessage(
            '<Header><ShipmentNo>' + ShipmentNo + '</ShipmentNo></Header>' +
            '<Packages><Package><Weight unit="KG">1.0</Weight></Package></Packages>');
        Mgt.ImportShipmentStatus(FirstPayload);

        SecondPayload := ShippingMessage(
            '<Header><ShipmentNo>' + ShipmentNo + '</ShipmentNo></Header>' +
            '<Packages>' +
            '<Package><Weight unit="KG">1.0</Weight></Package>' +
            '<Package><Weight unit="KG">1.0</Weight></Package>' +
            '<Package><Weight unit="KG">1.0</Weight></Package>' +
            '<Package><Weight unit="KG">1.0</Weight></Package>' +
            '</Packages>');
        Mgt.ImportShipmentStatus(SecondPayload);

        Assert.AreEqual(4, Mgt.GetLastImportedPackageCount(ShipmentNo), 'Expected the most recently imported package count for a re-scanned shipment, not the first scan''s count');

        ImportEntry.SetRange("Shipment No.", OtherShipmentNo);
        ImportEntry.FindLast();
        Assert.AreEqual(777, ImportEntry."Package Count", 'Expected an unrelated shipment''s entry to be untouched by importing a different shipment');
    end;

    [Test]
    procedure GetLastImportedPackageCountIsZeroForAShipmentNeverImported()
    var
        ImportEntry: Record "CG X083 Shipment Import Entry";
        Mgt: Codeunit "CG X083 Shipment Import Mgt.";
    begin
        ImportEntry.DeleteAll();

        Assert.AreEqual(0, Mgt.GetLastImportedPackageCount('SHP-NEVER-SEEN'), 'Expected zero for a shipment number that was never imported');
    end;

    [Test]
    procedure ToWireDecimalRendersPlainDigitsWithDotSeparator()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('1234567.89', WireFormat.ToWireDecimal(1234567.89),
            'Expected the amount as plain digits with a dot before the fraction, with no separator a receiving server would read differently depending on its own regional settings');
    end;

    [Test]
    procedure ToWireDecimalKeepsLeadingMinusForNegativeValues()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('-1234.5', WireFormat.ToWireDecimal(-1234.5),
            'Expected a leading minus with plain digits and a dot before the fraction, the same on every server');
    end;

    [Test]
    procedure ToWireDecimalStaysPlainBelowTheFirstGroupingBoundary()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('999', WireFormat.ToWireDecimal(999),
            'Expected a whole amount under a thousand to render as plain digits');
    end;

    [Test]
    procedure ToWireDecimalHasNoGroupSeparatorAtTheGroupingBoundary()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('1000', WireFormat.ToWireDecimal(1000),
            'Expected a whole amount at a thousand to still render as plain digits, with no separator marking the thousands');
    end;

    [Test]
    procedure ToWireDateRendersYearMonthDay()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('2026-01-23', WireFormat.ToWireDate(DMY2Date(23, 1, 2026)),
            'Expected 23 January 2026 to render as 2026-01-23 on every server');
    end;

    [Test]
    procedure ToWireDatePadsSingleDigitMonthAndDay()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
    begin
        Assert.AreEqual('2026-02-03', WireFormat.ToWireDate(DMY2Date(3, 2, 2026)),
            'Expected zero-padded month and day: 3 February 2026 is 2026-02-03 on every server');
    end;

    [Test]
    procedure FromWireDecimalParsesValidWireText()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Decimal;
    begin
        Assert.IsTrue(WireFormat.FromWireDecimal('1234.56', Value),
            'Expected the wire text 1234.56 to be accepted');
        Assert.AreEqual(1234.56, Value, 'Expected the wire text 1234.56 to parse to exactly that amount');
    end;

    [Test]
    procedure FromWireDecimalParsesNegativeWireText()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Decimal;
    begin
        Assert.IsTrue(WireFormat.FromWireDecimal('-42.75', Value),
            'Expected the wire text -42.75 to be accepted');
        Assert.AreEqual(-42.75, Value, 'Expected the wire text -42.75 to parse to exactly that amount');
    end;

    [Test]
    procedure FromWireDecimalRejectsCommaFormattedText()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Decimal;
        Accepted: Boolean;
    begin
        Accepted := WireFormat.FromWireDecimal('1,5', Value);

        Assert.IsFalse(Accepted,
            StrSubstNo('Expected 1,5 to be rejected as not wire text, but it was accepted and parsed as %1', Value));
    end;

    [Test]
    procedure FromWireDecimalRejectsGarbageWithoutError()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Decimal;
    begin
        Assert.IsFalse(WireFormat.FromWireDecimal('twelve point five', Value),
            'Expected text that is no amount at all to be rejected, not raised as an error');
    end;

    [Test]
    procedure FromWireDateParsesValidWireText()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Date;
    begin
        Assert.IsTrue(WireFormat.FromWireDate('2026-01-23', Value),
            'Expected the wire text 2026-01-23 to be accepted');
        Assert.AreEqual(DMY2Date(23, 1, 2026), Value, 'Expected the wire text 2026-01-23 to parse to 23 January 2026');
    end;

    [Test]
    procedure FromWireDateRejectsLocaleFormattedText()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Date;
        Accepted: Boolean;
    begin
        Accepted := WireFormat.FromWireDate('05-02-2026', Value);

        Assert.IsFalse(Accepted,
            StrSubstNo('Expected 05-02-2026 to be rejected as not wire text, but it was accepted and parsed as %1', Value));
    end;

    [Test]
    procedure FromWireDateRejectsGarbageWithoutError()
    var
        WireFormat: Codeunit "CG X092 Wire Format";
        Value: Date;
    begin
        Assert.IsFalse(WireFormat.FromWireDate('23rd of January 2026', Value),
            'Expected text that is no wire date at all to be rejected, not raised as an error');
    end;

    [Test]
    procedure DecimalRoundTripSweepSurvivesThroughWireText()
    begin
        AssertDecimalRoundTrips(1000);
        AssertDecimalRoundTrips(12345.67);
        AssertDecimalRoundTrips(-98765.43);
        AssertDecimalRoundTrips(2000000);
        AssertDecimalRoundTrips(-1500.25);
        AssertDecimalRoundTrips(42.5);
    end;

    [Test]
    procedure DateRoundTripSweepSurvivesThroughWireText()
    begin
        AssertDateRoundTrips(DMY2Date(1, 1, 2026));
        AssertDateRoundTrips(DMY2Date(31, 12, 2026));
        AssertDateRoundTrips(DMY2Date(29, 2, 2028));
        AssertDateRoundTrips(DMY2Date(15, 6, 2025));
    end;

    [Test]
    procedure ExportedDocumentIsWellFormedJson()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
    begin
        ClearData();
        SeedOrder('SO-1001', 'C-1000', DMY2Date(15, 6, 2026), Order);
        SeedLine(Order."No.", 10000, 'ITM-1', 'Steel bracket', 2, 199.5, 399, OrderLine);

        ParseExport(Order);
    end;

    [Test]
    procedure HeaderFieldsRoundTripToTheExportedDocument()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
        OrderObject: JsonObject;
    begin
        ClearData();
        SeedOrder('SO-2001', 'C-2000', DMY2Date(15, 6, 2026), Order);
        SeedLine(Order."No.", 10000, 'ITM-1', 'Steel bracket', 2, 199.5, 399, OrderLine);

        OrderObject := ParseExport(Order);

        AssertTextProperty(OrderObject, 'orderNo', Order."No.");
        AssertTextProperty(OrderObject, 'customerNo', Order."Customer No.");
    end;

    [Test]
    procedure OrderDateWithSingleDigitDayAndMonthSerializesAsExactIsoString()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
        OrderObject: JsonObject;
        DateToken: JsonToken;
    begin
        ClearData();
        SeedOrder('SO-3001', 'C-3000', DMY2Date(5, 1, 2026), Order);
        SeedLine(Order."No.", 10000, 'ITM-1', 'Steel bracket', 2, 199.5, 399, OrderLine);

        OrderObject := ParseExport(Order);

        DateToken := GetProperty(OrderObject, 'orderDate');
        Assert.AreEqual('2026-01-05', DateToken.AsValue().AsText(),
            'Expected the order date January 5, 2026 to serialize as 2026-01-05');
    end;

    [Test]
    procedure OrderDateWithDoubleDigitDayAndMonthSerializesAsExactIsoString()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
        OrderObject: JsonObject;
        DateToken: JsonToken;
    begin
        ClearData();
        SeedOrder('SO-3002', 'C-3001', DMY2Date(23, 11, 2026), Order);
        SeedLine(Order."No.", 10000, 'ITM-1', 'Steel bracket', 2, 199.5, 399, OrderLine);

        OrderObject := ParseExport(Order);

        DateToken := GetProperty(OrderObject, 'orderDate');
        Assert.AreEqual('2026-11-23', DateToken.AsValue().AsText(),
            'Expected the order date November 23, 2026 to serialize as 2026-11-23');
    end;

    [Test]
    procedure UnitPriceSerializesAsAPlainJsonNumberNotAText()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
        LineObject: JsonObject;
    begin
        ClearData();
        SeedOrder('SO-4001', 'C-4000', DMY2Date(15, 6, 2026), Order);
        SeedLine(Order."No.", 10000, 'ITM-1', 'Steel bracket', 3, 1249.99, 3749.97, OrderLine);

        LineObject := GetLine(ParseExport(Order), 0);

        AssertNumberProperty(LineObject, 'unitPrice', OrderLine."Unit Price");
    end;

    [Test]
    procedure QuantityAndLineAmountSerializeAsPlainJsonNumbers()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
        LineObject: JsonObject;
    begin
        ClearData();
        SeedOrder('SO-5001', 'C-5000', DMY2Date(15, 6, 2026), Order);
        SeedLine(Order."No.", 10000, 'ITM-1', 'Steel bracket', 4.5, 20, 91.35, OrderLine);

        LineObject := GetLine(ParseExport(Order), 0);

        AssertNumberProperty(LineObject, 'lineNo', OrderLine."Line No.");
        AssertNumberProperty(LineObject, 'quantity', OrderLine.Quantity);
        AssertNumberProperty(LineObject, 'lineAmount', OrderLine."Line Amount");
    end;

    [Test]
    procedure LineAmountIsTheStoredValueNotARecomputation()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
        LineObject: JsonObject;
    begin
        ClearData();
        SeedOrder('SO-6001', 'C-6000', DMY2Date(15, 6, 2026), Order);
        // Line Amount deliberately does not equal Quantity * Unit Price, so a
        // recomputed export would disagree with the stored value.
        SeedLine(Order."No.", 10000, 'ITM-1', 'Steel bracket', 10, 100, 850, OrderLine);

        LineObject := GetLine(ParseExport(Order), 0);

        AssertNumberProperty(LineObject, 'lineAmount', 850);
    end;

    [Test]
    procedure LinesArrayCoversOnlyThisOrdersOwnLinesInLineNoOrder()
    var
        Order: Record "CG X093 Order";
        OtherOrder: Record "CG X093 Order";
        FirstLine: Record "CG X093 Order Line";
        SecondLine: Record "CG X093 Order Line";
        OtherLine: Record "CG X093 Order Line";
        OrderObject: JsonObject;
        LinesToken: JsonToken;
    begin
        ClearData();
        SeedOrder('SO-7001', 'C-7000', DMY2Date(15, 6, 2026), Order);
        SeedLine(Order."No.", 20000, 'ITM-2', 'Second line', 1, 50, 50, SecondLine);
        SeedLine(Order."No.", 10000, 'ITM-1', 'First line', 1, 40, 40, FirstLine);
        SeedOrder('SO-7002', 'C-7001', DMY2Date(15, 6, 2026), OtherOrder);
        SeedLine(OtherOrder."No.", 10000, 'ITM-3', 'Other order line', 1, 10, 10, OtherLine);

        OrderObject := ParseExport(Order);

        LinesToken := GetProperty(OrderObject, 'lines');
        Assert.IsTrue(LinesToken.IsArray(), 'Expected the "lines" property to be a JSON array');
        Assert.AreEqual(2, LinesToken.AsArray().Count(),
            'Expected the "lines" array to contain only this order''s own lines, in ascending line number order');
        AssertTextProperty(GetLine(OrderObject, 0), 'itemNo', FirstLine."Item No.");
        AssertTextProperty(GetLine(OrderObject, 1), 'itemNo', SecondLine."Item No.");
    end;

    [Test]
    procedure DescriptionsWithQuotesAndBackslashesRoundTripUnchanged()
    var
        Order: Record "CG X093 Order";
        OrderLine: Record "CG X093 Order Line";
        LineObject: JsonObject;
        HostileDescription: Text[100];
    begin
        ClearData();
        HostileDescription := '24" bracket \ steel "premium"';
        SeedOrder('SO-8001', 'C-8000', DMY2Date(15, 6, 2026), Order);
        SeedLine(Order."No.", 10000, 'ITM-1', HostileDescription, 1, 40, 40, OrderLine);

        LineObject := GetLine(ParseExport(Order), 0);

        AssertTextProperty(LineObject, 'description', HostileDescription);
    end;

    [Test]
    procedure OrderWithoutLinesSerializesAnEmptyLinesArray()
    var
        Order: Record "CG X093 Order";
        OrderObject: JsonObject;
        LinesToken: JsonToken;
    begin
        ClearData();
        SeedOrder('SO-9001', 'C-9000', DMY2Date(15, 6, 2026), Order);

        OrderObject := ParseExport(Order);

        LinesToken := GetProperty(OrderObject, 'lines');
        Assert.IsTrue(LinesToken.IsArray(), 'Expected the "lines" property to be a JSON array even for an order without lines');
        Assert.AreEqual(0, LinesToken.AsArray().Count(), 'Expected an empty "lines" array for an order without lines');
    end;
}
