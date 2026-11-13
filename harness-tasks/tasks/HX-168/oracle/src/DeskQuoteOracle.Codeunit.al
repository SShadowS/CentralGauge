codeunit 88480 "HX168 Desk Quote Oracle"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        RateQuote: Codeunit "CGR Desk Rate Quote";
        CallerFailedTxt: Label 'HX168 the desk stopped the change.', Locked = true;

    [Test]
    procedure QuoteAddsSeasonSurcharge()
    begin
        StartHX168();
        NewDeskRateHX168('HX168-SUR-A', 100, 5, 0);
        NewDeskRateHX168('HX168-SUR-B', 80, 12.5, 0);
        ReadyHX168();

        Assert.AreEqual(105, RateQuote.QuoteDeskRate('HX168-SUR-A'), 'Quote of A includes its season surcharge');
        Assert.AreEqual(90, RateQuote.QuoteDeskRate('HX168-SUR-B'), 'Quote of B includes its season surcharge');
        Assert.AreEqual(105, RateQuote.QuoteDeskRate('HX168-SUR-A'), 'Repeat quote of A');
        Assert.AreEqual(90, RateQuote.QuoteDeskRate('HX168-SUR-B'), 'Repeat quote of B');
    end;

    [Test]
    procedure QuoteRoundsToCent()
    begin
        StartHX168();
        NewDeskRateHX168('HX168-RND-UP', 33.33, 7.5, 0);
        NewDeskRateHX168('HX168-RND-DN', 10.01, 12.5, 0);
        ReadyHX168();

        Assert.AreEqual(35.83, RateQuote.QuoteDeskRate('HX168-RND-UP'), '33.33 at 7.5% is quoted rounded to the cent');
        Assert.AreEqual(11.26, RateQuote.QuoteDeskRate('HX168-RND-DN'), '10.01 at 12.5% is quoted rounded to the cent');
        Assert.AreEqual(35.83, RateQuote.QuoteDeskRate('HX168-RND-UP'), 'Repeat quote stays rounded');
    end;

    [Test]
    procedure TwoRatesStayRemembered()
    var
        WarmQuote: Codeunit "CGR Desk Rate Quote";
        Quote: Decimal;
    begin
        StartHX168();
        NewDeskRateHX168('HX168-TWO-A', 40, 10, 0);
        NewDeskRateHX168('HX168-TWO-B', 70, 20, 0);
        ReadyHX168();
        WarmQuote.QuoteDeskRate('HX168-TWO-A');
        WarmQuote.QuoteDeskRate('HX168-TWO-B');
        Commit();
        SelectLatestVersion();

        Assert.IsTrue(StatementsOfQuoteHX168('HX168-TWO-A', Quote) = 0, 'Revisiting rate A after rate B issues no database statement');
        Assert.AreEqual(44, Quote, 'Rate A value');
        Assert.IsTrue(StatementsOfQuoteHX168('HX168-TWO-B', Quote) = 0, 'Revisiting rate B after rate A issues no database statement');
        Assert.AreEqual(84, Quote, 'Rate B value');
    end;

    [Test]
    procedure ForgetMidTransactionIsNeverQuoted()
    var
        DeskRate: Record "CGR Desk Rate";
        Runner: Codeunit "HX168 Rate Change Runner";
        Ok: Boolean;
    begin
        StartHX168();
        NewDeskRateHX168('HX168-FMID', 100, 5, 0);
        ReadyHX168();
        Assert.AreEqual(105, RateQuote.QuoteDeskRate('HX168-FMID'), 'Quote before the change');
        Commit();

        Runner.SetChangeForgetThenFailHX168('HX168-FMID', 200);
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'The caller failed after the change');
        Assert.AreEqual(CallerFailedTxt, GetLastErrorText(), 'Caller error text');
        DeskRate.Get('HX168-FMID');
        Assert.AreEqual(100, DeskRate."Day Rate", 'Nothing of the failed transaction is kept');
        Assert.AreEqual(105, RateQuote.QuoteDeskRate('HX168-FMID'), 'A change whose transaction failed is never quoted, also when ForgetDeskQuotes ran inside that transaction');
    end;

    [Test]
    procedure InsertedRateRolledBack()
    var
        DeskRate: Record "CGR Desk Rate";
        Runner: Codeunit "HX168 Rate Change Runner";
        Quote: Decimal;
        Ok: Boolean;
    begin
        StartHX168();
        if DeskRate.Get('HX168-INS') then
            DeskRate.Delete();
        ReadyHX168();

        Runner.SetInsertThenFailHX168('HX168-INS', 100);
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'The caller failed after creating the rate');
        Assert.AreEqual(CallerFailedTxt, GetLastErrorText(), 'Caller error text');
        Assert.IsFalse(DeskRate.Get('HX168-INS'), 'The rate created in the failed transaction is not kept');
        Assert.IsFalse(TryQuoteHX168('HX168-INS', Quote), 'A rate whose creation was rolled back has no quote');
        Assert.IsTrue(StrPos(GetLastErrorText(), 'does not exist') > 0, 'The quote fails with the not-found error, got: ' + GetLastErrorText());
    end;

    [Test]
    procedure RepeatQuoteIssuesNoStatement()
    var
        WarmQuote: Codeunit "CGR Desk Rate Quote";
        Quote: Decimal;
    begin
        StartHX168();
        NewDeskRateHX168('HX168-REP', 60, 10, 0);
        ReadyHX168();
        WarmQuote.QuoteDeskRate('HX168-REP');
        Commit();
        SelectLatestVersion();

        Assert.IsTrue(StatementsOfQuoteHX168('HX168-REP', Quote) = 0, 'A repeated quote of an unchanged rate, through another variable, issues no database statement');
        Assert.AreEqual(66, Quote, 'Repeated quote value');
    end;

    [Test]
    procedure ForgetDropsRememberedQuotes()
    var
        Quote: Decimal;
    begin
        StartHX168();
        NewDeskRateHX168('HX168-FGT', 50, 20, 0);
        ReadyHX168();
        Assert.AreEqual(60, RateQuote.QuoteDeskRate('HX168-FGT'), 'Quote before the forget');
        Commit();
        SelectLatestVersion();

        RateQuote.ForgetDeskQuotes();

        Assert.IsTrue(StatementsOfQuoteHX168('HX168-FGT', Quote) > 0, 'After ForgetDeskQuotes the next quote reads the database again');
        Assert.AreEqual(60, Quote, 'Quote after the forget is the stored value');
    end;

    [Test]
    procedure SavedRateChangeIsQuoted()
    var
        RateUpdate: Codeunit "CGR Desk Rate Update";
    begin
        StartHX168();
        NewDeskRateHX168('HX168-SAVE', 100, 5, 0);
        ReadyHX168();
        Assert.AreEqual(105, RateQuote.QuoteDeskRate('HX168-SAVE'), 'Quote before the change');

        RateUpdate.SetDeskDayRate('HX168-SAVE', 200);
        Assert.AreEqual(210, RateQuote.QuoteDeskRate('HX168-SAVE'), 'The changed rate is quoted in the same transaction');
        Commit();
        SelectLatestVersion();

        Assert.AreEqual(210, RateQuote.QuoteDeskRate('HX168-SAVE'), 'The saved rate is quoted after the commit');
    end;

    [Test]
    procedure RejectedRateIsNeverQuoted()
    var
        DeskRate: Record "CGR Desk Rate";
        Runner: Codeunit "HX168 Rate Change Runner";
        Ok: Boolean;
    begin
        StartHX168();
        NewDeskRateHX168('HX168-REJ', 100, 5, 100);
        ReadyHX168();
        Assert.AreEqual(105, RateQuote.QuoteDeskRate('HX168-REJ'), 'Quote before the change');
        Commit();

        Runner.SetChangeHX168('HX168-REJ', 90, false);
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'A rate under the minimum quote is rejected');
        Assert.AreEqual('Desk rate HX168-REJ is below its minimum quote.', GetLastErrorText(), 'Rejection error text');
        DeskRate.Get('HX168-REJ');
        Assert.AreEqual(100, DeskRate."Day Rate", 'The rejected rate is not kept');
        Assert.AreEqual(105, RateQuote.QuoteDeskRate('HX168-REJ'), 'A rejected rate is never quoted afterwards');
    end;

    [Test]
    procedure FailedCallerChangeIsNeverQuoted()
    var
        DeskRate: Record "CGR Desk Rate";
        Runner: Codeunit "HX168 Rate Change Runner";
        Ok: Boolean;
    begin
        StartHX168();
        NewDeskRateHX168('HX168-FAIL', 100, 5, 0);
        ReadyHX168();
        Assert.AreEqual(105, RateQuote.QuoteDeskRate('HX168-FAIL'), 'Quote before the change');
        Commit();

        Runner.SetChangeHX168('HX168-FAIL', 200, true);
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'The caller failed after the change');
        Assert.AreEqual(CallerFailedTxt, GetLastErrorText(), 'Caller error text');
        DeskRate.Get('HX168-FAIL');
        Assert.AreEqual(100, DeskRate."Day Rate", 'Nothing of the failed transaction is kept');
        Assert.AreEqual(105, RateQuote.QuoteDeskRate('HX168-FAIL'), 'A change whose transaction failed is never quoted afterwards');
    end;

    [Test]
    procedure DirectEditIsQuoted()
    var
        DeskRate: Record "CGR Desk Rate";
    begin
        StartHX168();
        NewDeskRateHX168('HX168-EDIT', 100, 5, 0);
        ReadyHX168();
        Assert.AreEqual(105, RateQuote.QuoteDeskRate('HX168-EDIT'), 'Quote before the edit');

        DeskRate.Get('HX168-EDIT');
        DeskRate."Day Rate" := 120;
        DeskRate.Modify(false);
        Assert.AreEqual(126, RateQuote.QuoteDeskRate('HX168-EDIT'), 'A rate changed by other code, without table triggers, is quoted correctly in the same transaction');
        Commit();

        Assert.AreEqual(126, RateQuote.QuoteDeskRate('HX168-EDIT'), 'A rate changed by other code, without table triggers, is quoted correctly after the commit');
    end;

    [Test]
    procedure DeletedRateHasNoQuote()
    var
        DeskRate: Record "CGR Desk Rate";
        Runner: Codeunit "HX168 Rate Change Runner";
        Quote: Decimal;
        Ok: Boolean;
    begin
        StartHX168();
        NewDeskRateHX168('HX168-DEL', 100, 5, 0);
        ReadyHX168();
        Assert.AreEqual(105, RateQuote.QuoteDeskRate('HX168-DEL'), 'Quote before the delete');
        Commit();

        Runner.SetDeleteThenQuoteHX168('HX168-DEL');
        Ok := Runner.Run();

        Assert.IsFalse(Ok, 'A rate deleted in the same transaction has no quote');
        Assert.IsTrue(StrPos(GetLastErrorText(), 'does not exist') > 0, 'In the same transaction the quote fails with the not-found error, got: ' + GetLastErrorText());
        Assert.AreEqual(105, RateQuote.QuoteDeskRate('HX168-DEL'), 'The rolled-back delete leaves the rate quoted as stored');

        DeskRate.Get('HX168-DEL');
        DeskRate.Delete();
        Commit();

        Assert.IsFalse(TryQuoteHX168('HX168-DEL', Quote), 'A deleted rate has no quote');
        Assert.IsTrue(StrPos(GetLastErrorText(), 'does not exist') > 0, 'The quote fails with the not-found error, got: ' + GetLastErrorText());
    end;

    local procedure StartHX168()
    begin
        WorkDate(20250115D);
    end;

    local procedure ReadyHX168()
    begin
        Commit();
        RateQuote.ForgetDeskQuotes();
    end;

    local procedure NewDeskRateHX168(RateCode: Code[20]; DayRate: Decimal; SurchargePct: Decimal; MinimumQuote: Decimal)
    var
        DeskRate: Record "CGR Desk Rate";
    begin
        if DeskRate.Get(RateCode) then
            DeskRate.Delete();
        DeskRate.Init();
        DeskRate.Code := RateCode;
        DeskRate."Day Rate" := DayRate;
        DeskRate."Season Surcharge %" := SurchargePct;
        DeskRate."Minimum Quote" := MinimumQuote;
        DeskRate.Insert();
    end;

    local procedure StatementsOfQuoteHX168(RateCode: Code[20]; var Quote: Decimal): BigInteger
    var
        Before: BigInteger;
    begin
        Before := SessionInformation.SqlStatementsExecuted;
        Quote := RateQuote.QuoteDeskRate(RateCode);
        exit(SessionInformation.SqlStatementsExecuted - Before);
    end;

    [TryFunction]
    local procedure TryQuoteHX168(RateCode: Code[20]; var Quote: Decimal)
    begin
        Quote := RateQuote.QuoteDeskRate(RateCode);
    end;
}
