codeunit 80584 "CGR Quote Same Dates Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        SameNoQuoteTxt: Label 'There is no quote for vehicle %1 from %2 to %3.', Locked = true;
        SameRefusedTxt: Label 'Partner refused vehicle %1.', Locked = true;

    [Test]
    procedure SameDatesQuotePrice()
    var
        Spy: Codeunit "CGR Quote Same Dates Spy";
        QuoteMgt: Codeunit "CGR Quote Mgt";
    begin
        SameDatesPrepare('HX151-SA1');
        Spy.SetSameDatesPremium(10);
        BindSubscription(Spy);
        Assert.AreEqual(160, QuoteMgt.Quote('HX151-SA1', 20270301D, 20270303D), 'Price');
    end;

    [Test]
    procedure SameDatesKeptQuote()
    var
        Spy: Codeunit "CGR Quote Same Dates Spy";
        QuoteMgt: Codeunit "CGR Quote Mgt";
    begin
        SameDatesPrepare('HX151-SA2');
        Spy.SetSameDatesPremium(10);
        BindSubscription(Spy);
        QuoteMgt.Quote('HX151-SA2', 20270301D, 20270303D);
        Spy.SetSameDatesPremium(30);
        Assert.AreEqual(160, QuoteMgt.Quote('HX151-SA2', 20270301D, 20270303D), 'Kept quote');
        Assert.AreEqual(1, Spy.SameDatesAskedCount(), 'Insurer asked once');
    end;

    [Test]
    procedure SameDatesResetDropsQuote()
    var
        Spy: Codeunit "CGR Quote Same Dates Spy";
        QuoteCache: Codeunit "CGR Quote Cache";
        QuoteMgt: Codeunit "CGR Quote Mgt";
    begin
        SameDatesPrepare('HX151-SA3');
        Spy.SetSameDatesPremium(10);
        BindSubscription(Spy);
        QuoteMgt.Quote('HX151-SA3', 20270301D, 20270303D);
        QuoteCache.Reset();
        Commit();
        asserterror QuoteMgt.BookQuote('HX151-SA3', 20270301D, 20270303D, 'HX151 Same C');
        Assert.ExpectedError(StrSubstNo(SameNoQuoteTxt, 'HX151-SA3', 20270301D, 20270303D));
    end;

    [Test]
    procedure SameDatesBookAgreedPrice()
    var
        Contract: Record "CGR Rental Contract";
        Spy: Codeunit "CGR Quote Same Dates Spy";
        QuoteMgt: Codeunit "CGR Quote Mgt";
    begin
        SameDatesPrepare('HX151-SA4');
        Spy.SetSameDatesPremium(10);
        BindSubscription(Spy);
        QuoteMgt.Quote('HX151-SA4', 20270301D, 20270303D);
        Spy.SetSameDatesPremium(40);
        Commit();
        Contract.Get(QuoteMgt.BookQuote('HX151-SA4', 20270301D, 20270303D, 'HX151 Same D'));
        Assert.AreEqual(160, Contract."Agreed Price", 'Agreed price');
        Assert.AreEqual(Contract.Status::Open, Contract.Status, 'Open');
        Assert.AreEqual(1, Spy.SameDatesAskedCount(), 'Insurer asked once');
    end;

    [Test]
    procedure SameDatesSecondBookingFails()
    var
        Spy: Codeunit "CGR Quote Same Dates Spy";
        QuoteMgt: Codeunit "CGR Quote Mgt";
    begin
        SameDatesPrepare('HX151-SA5');
        Spy.SetSameDatesPremium(10);
        BindSubscription(Spy);
        QuoteMgt.Quote('HX151-SA5', 20270301D, 20270303D);
        Commit();
        QuoteMgt.BookQuote('HX151-SA5', 20270301D, 20270303D, 'HX151 Same E');
        Commit();
        asserterror QuoteMgt.BookQuote('HX151-SA5', 20270301D, 20270303D, 'HX151 Same E');
        Assert.ExpectedError(StrSubstNo(SameNoQuoteTxt, 'HX151-SA5', 20270301D, 20270303D));
    end;

    [Test]
    procedure SameDatesRefusalKeepsQuote()
    var
        Contract: Record "CGR Rental Contract";
        Spy: Codeunit "CGR Quote Same Dates Spy";
        QuoteMgt: Codeunit "CGR Quote Mgt";
    begin
        SameDatesPrepare('HX151-SA6');
        Spy.SetSameDatesPremium(10);
        BindSubscription(Spy);
        QuoteMgt.Quote('HX151-SA6', 20270301D, 20270303D);
        Spy.RefuseSameDatesCustomer('HX151 Same F');
        Commit();
        asserterror QuoteMgt.BookQuote('HX151-SA6', 20270301D, 20270303D, 'HX151 Same F');
        Assert.ExpectedError(StrSubstNo(SameRefusedTxt, 'HX151-SA6'));
        Contract.SetRange("Customer Name", 'HX151 Same F');
        Assert.AreEqual(0, Contract.Count(), 'No contract kept');
        Spy.RefuseSameDatesCustomer('');
        Commit();
        Contract.Get(QuoteMgt.BookQuote('HX151-SA6', 20270301D, 20270303D, 'HX151 Same F'));
        Assert.AreEqual(160, Contract."Agreed Price", 'Retry books the kept quote');
    end;

    local procedure SameDatesPrepare(VehicleNo: Code[20])
    var
        QuoteCache: Codeunit "CGR Quote Cache";
    begin
        QuoteCache.Reset();
        WorkDate(20270310D);
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate(VehicleNo, 50);
    end;
}
