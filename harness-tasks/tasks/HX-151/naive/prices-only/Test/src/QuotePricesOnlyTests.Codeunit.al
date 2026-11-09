codeunit 80586 "CGR Quote Prices Only Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        PricesNoQuoteTxt: Label 'There is no quote for vehicle %1 from %2 to %3.', Locked = true;
        PricesRefusedTxt: Label 'Partner refused vehicle %1.', Locked = true;

    [Test]
    procedure PricesOnlyQuotePrice()
    var
        Spy: Codeunit "CGR Quote Prices Only Spy";
        QuoteMgt: Codeunit "CGR Quote Mgt";
    begin
        PricesOnlyPrepare('HX151-PA1');
        Spy.SetPricesOnlyPremium(10);
        BindSubscription(Spy);
        Assert.AreEqual(160, QuoteMgt.Quote('HX151-PA1', 20270301D, 20270303D), 'Price');
    end;

    [Test]
    procedure PricesOnlyKeptQuote()
    var
        Spy: Codeunit "CGR Quote Prices Only Spy";
        QuoteMgt: Codeunit "CGR Quote Mgt";
    begin
        PricesOnlyPrepare('HX151-PA2');
        Spy.SetPricesOnlyPremium(10);
        BindSubscription(Spy);
        Assert.AreEqual(160, QuoteMgt.Quote('HX151-PA2', 20270301D, 20270303D), 'First quote');
        Assert.AreEqual(160, QuoteMgt.Quote('HX151-PA2', 20270301D, 20270303D), 'Kept quote');
    end;

    [Test]
    procedure PricesOnlyOtherDates()
    var
        Spy: Codeunit "CGR Quote Prices Only Spy";
        QuoteMgt: Codeunit "CGR Quote Mgt";
    begin
        PricesOnlyPrepare('HX151-PA7');
        Spy.SetPricesOnlyPremium(10);
        BindSubscription(Spy);
        Assert.AreEqual(160, QuoteMgt.Quote('HX151-PA7', 20270301D, 20270303D), 'First dates');
        Assert.AreEqual(260, QuoteMgt.Quote('HX151-PA7', 20270301D, 20270305D), 'Other dates');
    end;

    [Test]
    procedure PricesOnlyResetDropsQuote()
    var
        Spy: Codeunit "CGR Quote Prices Only Spy";
        QuoteCache: Codeunit "CGR Quote Cache";
        QuoteMgt: Codeunit "CGR Quote Mgt";
    begin
        PricesOnlyPrepare('HX151-PA3');
        Spy.SetPricesOnlyPremium(10);
        BindSubscription(Spy);
        QuoteMgt.Quote('HX151-PA3', 20270301D, 20270303D);
        QuoteCache.Reset();
        Commit();
        asserterror QuoteMgt.BookQuote('HX151-PA3', 20270301D, 20270303D, 'HX151 Prices C');
        Assert.ExpectedError(StrSubstNo(PricesNoQuoteTxt, 'HX151-PA3', 20270301D, 20270303D));
    end;

    [Test]
    procedure PricesOnlyBookAgreedPrice()
    var
        Contract: Record "CGR Rental Contract";
        Spy: Codeunit "CGR Quote Prices Only Spy";
        QuoteMgt: Codeunit "CGR Quote Mgt";
    begin
        PricesOnlyPrepare('HX151-PA4');
        Spy.SetPricesOnlyPremium(10);
        BindSubscription(Spy);
        QuoteMgt.Quote('HX151-PA4', 20270301D, 20270303D);
        Commit();
        Contract.Get(QuoteMgt.BookQuote('HX151-PA4', 20270301D, 20270303D, 'HX151 Prices D'));
        Assert.AreEqual(160, Contract."Agreed Price", 'Agreed price');
        Assert.AreEqual(Contract.Status::Open, Contract.Status, 'Open');
    end;

    [Test]
    procedure PricesOnlySecondBookingFails()
    var
        Spy: Codeunit "CGR Quote Prices Only Spy";
        QuoteMgt: Codeunit "CGR Quote Mgt";
    begin
        PricesOnlyPrepare('HX151-PA5');
        Spy.SetPricesOnlyPremium(10);
        BindSubscription(Spy);
        QuoteMgt.Quote('HX151-PA5', 20270301D, 20270303D);
        Commit();
        QuoteMgt.BookQuote('HX151-PA5', 20270301D, 20270303D, 'HX151 Prices E');
        Commit();
        asserterror QuoteMgt.BookQuote('HX151-PA5', 20270301D, 20270303D, 'HX151 Prices E');
        Assert.ExpectedError(StrSubstNo(PricesNoQuoteTxt, 'HX151-PA5', 20270301D, 20270303D));
    end;

    [Test]
    procedure PricesOnlyRefusalKeepsQuote()
    var
        Contract: Record "CGR Rental Contract";
        Spy: Codeunit "CGR Quote Prices Only Spy";
        QuoteMgt: Codeunit "CGR Quote Mgt";
    begin
        PricesOnlyPrepare('HX151-PA6');
        Spy.SetPricesOnlyPremium(10);
        BindSubscription(Spy);
        QuoteMgt.Quote('HX151-PA6', 20270301D, 20270303D);
        Spy.RefusePricesOnlyCustomer('HX151 Prices F');
        Commit();
        asserterror QuoteMgt.BookQuote('HX151-PA6', 20270301D, 20270303D, 'HX151 Prices F');
        Assert.ExpectedError(StrSubstNo(PricesRefusedTxt, 'HX151-PA6'));
        Contract.SetRange("Customer Name", 'HX151 Prices F');
        Assert.AreEqual(0, Contract.Count(), 'No contract kept');
        Spy.RefusePricesOnlyCustomer('');
        Commit();
        Contract.Get(QuoteMgt.BookQuote('HX151-PA6', 20270301D, 20270303D, 'HX151 Prices F'));
        Assert.AreEqual(160, Contract."Agreed Price", 'Retry books the kept quote');
    end;

    local procedure PricesOnlyPrepare(VehicleNo: Code[20])
    var
        QuoteCache: Codeunit "CGR Quote Cache";
    begin
        QuoteCache.Reset();
        WorkDate(20270310D);
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate(VehicleNo, 50);
    end;
}
