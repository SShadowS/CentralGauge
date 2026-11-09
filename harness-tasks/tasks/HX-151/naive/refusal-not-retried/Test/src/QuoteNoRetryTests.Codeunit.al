codeunit 80588 "CGR Quote No Retry Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        NoRetryNoQuoteTxt: Label 'There is no quote for vehicle %1 from %2 to %3.', Locked = true;
        NoRetryRefusedTxt: Label 'Partner refused vehicle %1.', Locked = true;

    [Test]
    procedure NoRetryQuotePrice()
    var
        Spy: Codeunit "CGR Quote No Retry Spy";
        QuoteMgt: Codeunit "CGR Quote Mgt";
    begin
        NoRetryPrepare('HX151-RA1');
        Spy.SetNoRetryPremium(10);
        BindSubscription(Spy);
        Assert.AreEqual(160, QuoteMgt.Quote('HX151-RA1', 20270301D, 20270303D), 'Price');
    end;

    [Test]
    procedure NoRetryKeptQuote()
    var
        Spy: Codeunit "CGR Quote No Retry Spy";
        QuoteMgt: Codeunit "CGR Quote Mgt";
    begin
        NoRetryPrepare('HX151-RA2');
        Spy.SetNoRetryPremium(10);
        BindSubscription(Spy);
        QuoteMgt.Quote('HX151-RA2', 20270301D, 20270303D);
        Spy.SetNoRetryPremium(30);
        Assert.AreEqual(160, QuoteMgt.Quote('HX151-RA2', 20270301D, 20270303D), 'Kept quote');
        Assert.AreEqual(1, Spy.NoRetryAskedCount(), 'Insurer asked once');
    end;

    [Test]
    procedure NoRetryResetDropsQuote()
    var
        Spy: Codeunit "CGR Quote No Retry Spy";
        QuoteCache: Codeunit "CGR Quote Cache";
        QuoteMgt: Codeunit "CGR Quote Mgt";
    begin
        NoRetryPrepare('HX151-RA3');
        Spy.SetNoRetryPremium(10);
        BindSubscription(Spy);
        QuoteMgt.Quote('HX151-RA3', 20270301D, 20270303D);
        QuoteCache.Reset();
        Commit();
        asserterror QuoteMgt.BookQuote('HX151-RA3', 20270301D, 20270303D, 'HX151 NoRetry C');
        Assert.ExpectedError(StrSubstNo(NoRetryNoQuoteTxt, 'HX151-RA3', 20270301D, 20270303D));
    end;

    [Test]
    procedure NoRetryBookAgreedPrice()
    var
        Contract: Record "CGR Rental Contract";
        Spy: Codeunit "CGR Quote No Retry Spy";
        QuoteMgt: Codeunit "CGR Quote Mgt";
    begin
        NoRetryPrepare('HX151-RA4');
        Spy.SetNoRetryPremium(10);
        BindSubscription(Spy);
        QuoteMgt.Quote('HX151-RA4', 20270301D, 20270303D);
        Spy.SetNoRetryPremium(40);
        Commit();
        Contract.Get(QuoteMgt.BookQuote('HX151-RA4', 20270301D, 20270303D, 'HX151 NoRetry D'));
        Assert.AreEqual(160, Contract."Agreed Price", 'Agreed price');
        Assert.AreEqual(Contract.Status::Open, Contract.Status, 'Open');
        Assert.AreEqual(1, Spy.NoRetryAskedCount(), 'Insurer asked once');
    end;

    [Test]
    procedure NoRetrySecondBookingFails()
    var
        Spy: Codeunit "CGR Quote No Retry Spy";
        QuoteMgt: Codeunit "CGR Quote Mgt";
    begin
        NoRetryPrepare('HX151-RA5');
        Spy.SetNoRetryPremium(10);
        BindSubscription(Spy);
        QuoteMgt.Quote('HX151-RA5', 20270301D, 20270303D);
        Commit();
        QuoteMgt.BookQuote('HX151-RA5', 20270301D, 20270303D, 'HX151 NoRetry E');
        Commit();
        asserterror QuoteMgt.BookQuote('HX151-RA5', 20270301D, 20270303D, 'HX151 NoRetry E');
        Assert.ExpectedError(StrSubstNo(NoRetryNoQuoteTxt, 'HX151-RA5', 20270301D, 20270303D));
    end;

    [Test]
    procedure NoRetryRefusalFails()
    var
        Contract: Record "CGR Rental Contract";
        Spy: Codeunit "CGR Quote No Retry Spy";
        QuoteMgt: Codeunit "CGR Quote Mgt";
    begin
        NoRetryPrepare('HX151-RA6');
        Spy.SetNoRetryPremium(10);
        BindSubscription(Spy);
        QuoteMgt.Quote('HX151-RA6', 20270301D, 20270303D);
        Spy.RefuseNoRetryCustomer('HX151 NoRetry F');
        Commit();
        asserterror QuoteMgt.BookQuote('HX151-RA6', 20270301D, 20270303D, 'HX151 NoRetry F');
        Assert.ExpectedError(StrSubstNo(NoRetryRefusedTxt, 'HX151-RA6'));
        Contract.SetRange("Customer Name", 'HX151 NoRetry F');
        Assert.AreEqual(0, Contract.Count(), 'No contract kept');
    end;

    [Test]
    procedure NoRetryOtherDates()
    var
        Spy: Codeunit "CGR Quote No Retry Spy";
        QuoteMgt: Codeunit "CGR Quote Mgt";
    begin
        NoRetryPrepare('HX151-RA7');
        Spy.SetNoRetryPremium(10);
        BindSubscription(Spy);
        Assert.AreEqual(160, QuoteMgt.Quote('HX151-RA7', 20270301D, 20270303D), 'First dates');
        Assert.AreEqual(260, QuoteMgt.Quote('HX151-RA7', 20270301D, 20270305D), 'Other dates');
    end;

    local procedure NoRetryPrepare(VehicleNo: Code[20])
    var
        QuoteCache: Codeunit "CGR Quote Cache";
    begin
        QuoteCache.Reset();
        WorkDate(20270310D);
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate(VehicleNo, 50);
    end;
}
