codeunit 88835 "CG-AL-X082 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit Assert;

    // The default test isolation persists writes between test methods
    // (measured 2026-08-20, SOAP runner), so every test clears the log
    // table before exercising the objects under test.

    local procedure ClearLog()
    var
        CallLog: Record "CG X082 Call Log";
    begin
        CallLog.DeleteAll();
    end;

    [Test]
    procedure RefreshRateRecoversFromRepeatedServerErrorBursts()
    var
        CallLog: Record "CG X082 Call Log";
        Sync: Codeunit "CG X082 Exchange Rate Sync";
        MockHandler: Codeunit "CG-AL-X082 Mock Http Handler";
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
        MockHandler: Codeunit "CG-AL-X082 Mock Http Handler";
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
        MockHandler: Codeunit "CG-AL-X082 Mock Http Handler";
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
        MockHandler: Codeunit "CG-AL-X082 Mock Http Handler";
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
        MockHandler: Codeunit "CG-AL-X082 Mock Http Handler";
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
        MockHandler: Codeunit "CG-AL-X082 Mock Http Handler";
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
        MockHandler: Codeunit "CG-AL-X082 Mock Http Handler";
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
        MockHandler: Codeunit "CG-AL-X082 Mock Http Handler";
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
        MockHandler: Codeunit "CG-AL-X082 Mock Http Handler";
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
        MockHandler: Codeunit "CG-AL-X082 Mock Http Handler";
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
        MockHandler: Codeunit "CG-AL-X082 Mock Http Handler";
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
        MockHandler: Codeunit "CG-AL-X082 Mock Http Handler";
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
        MockHandler: Codeunit "CG-AL-X082 Mock Http Handler";
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
        MockHandler: Codeunit "CG-AL-X082 Mock Http Handler";
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
}
