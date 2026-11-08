codeunit 80580 "CGR Quote Cache Tests"
{
    Subtype = Test;
    TestPermissions = Disabled;

    var
        Assert: Codeunit "Library Assert";
        Lib: Codeunit "CGR Test Library";
        NoQuoteTxt: Label 'There is no quote for vehicle %1 from %2 to %3.', Locked = true;
        PartnerRefusedTxt: Label 'The booking partner refused the booking of vehicle %1.', Locked = true;

    [Test]
    procedure QuoteIsDaysTimesRatePlusPremium()
    var
        Insurer: Codeunit "CGR Quote Insurer Spy";
        QuoteMgt: Codeunit "CGR Quote Mgt";
    begin
        HX151Prepare('HX151-A1');
        Insurer.SetInsurerPremium(10);
        BindSubscription(Insurer);

        Assert.AreEqual(160, QuoteMgt.Quote('HX151-A1', 20270301D, 20270303D), '3 days x 50 + premium 10');
        Assert.AreEqual(1, Insurer.PremiumAsked(), 'The insurer is asked for a new quote');
        UnbindSubscription(Insurer);
    end;

    [Test]
    procedure OtherDatesGetTheirOwnQuote()
    var
        Insurer: Codeunit "CGR Quote Insurer Spy";
        QuoteMgt: Codeunit "CGR Quote Mgt";
    begin
        HX151Prepare('HX151-B1');
        Insurer.SetInsurerPremium(10);
        BindSubscription(Insurer);

        Assert.AreEqual(160, QuoteMgt.Quote('HX151-B1', 20270301D, 20270303D), 'First dates: 3 days x 50 + 10');
        Assert.AreEqual(260, QuoteMgt.Quote('HX151-B1', 20270301D, 20270305D), 'Other dates are a new quote: 5 days x 50 + 10');
        Assert.AreEqual(2, Insurer.PremiumAsked(), 'Each date range asks the insurer');
        UnbindSubscription(Insurer);
    end;

    [Test]
    procedure SameDatesReturnTheKeptQuote()
    var
        Insurer: Codeunit "CGR Quote Insurer Spy";
        QuoteMgt: Codeunit "CGR Quote Mgt";
    begin
        HX151Prepare('HX151-C1');
        Insurer.SetInsurerPremium(10);
        BindSubscription(Insurer);

        Assert.AreEqual(160, QuoteMgt.Quote('HX151-C1', 20270301D, 20270303D), 'First quote');
        Insurer.SetInsurerPremium(30);
        Assert.AreEqual(160, QuoteMgt.Quote('HX151-C1', 20270301D, 20270303D), 'Same vehicle and dates return the kept quote');
        Assert.AreEqual(1, Insurer.PremiumAsked(), 'The kept quote does not ask the insurer again');
        UnbindSubscription(Insurer);
    end;

    [Test]
    procedure ResetDropsEveryKeptQuote()
    var
        Insurer: Codeunit "CGR Quote Insurer Spy";
        QuoteCache: Codeunit "CGR Quote Cache";
        QuoteMgt: Codeunit "CGR Quote Mgt";
    begin
        HX151Prepare('HX151-D1');
        Insurer.SetInsurerPremium(10);
        BindSubscription(Insurer);
        QuoteMgt.Quote('HX151-D1', 20270301D, 20270303D);

        QuoteCache.Reset();
        Commit();
        asserterror QuoteMgt.BookQuote('HX151-D1', 20270301D, 20270303D, 'HX151 Customer D');

        Assert.ExpectedError(StrSubstNo(NoQuoteTxt, 'HX151-D1', 20270301D, 20270303D));
        Assert.AreEqual(160, QuoteMgt.Quote('HX151-D1', 20270301D, 20270303D), 'A new quote after Reset');
        Assert.AreEqual(2, Insurer.PremiumAsked(), 'After Reset the insurer is asked again');
        UnbindSubscription(Insurer);
    end;

    [Test]
    procedure BookingAgreesTheKeptPrice()
    var
        Contract: Record "CGR Rental Contract";
        Insurer: Codeunit "CGR Quote Insurer Spy";
        QuoteMgt: Codeunit "CGR Quote Mgt";
        ContractNo: Code[20];
    begin
        HX151Prepare('HX151-E1');
        Insurer.SetInsurerPremium(10);
        BindSubscription(Insurer);
        Assert.AreEqual(160, QuoteMgt.Quote('HX151-E1', 20270301D, 20270303D), 'Quoted price');
        Insurer.SetInsurerPremium(40);

        ContractNo := HX151BookThroughRunner('HX151-E1', 'HX151 Customer E');

        Contract.Get(ContractNo);
        Assert.AreEqual(Contract.Status::Open, Contract.Status, 'The booked contract is Open');
        Assert.AreEqual(160, Contract."Agreed Price", 'Agreed Price is the kept quote');
        Assert.AreEqual('HX151-E1', Contract."Vehicle No.", 'Vehicle');
        Assert.AreEqual('HX151 Customer E', Contract."Customer Name", 'Customer');
        Assert.AreEqual(20270301D, Contract."Start Date", 'Start date');
        Assert.AreEqual(20270303D, Contract."End Date", 'End date');
        Assert.AreEqual(1, Insurer.PremiumAsked(), 'Booking does not ask the insurer again');
        UnbindSubscription(Insurer);
    end;

    [Test]
    procedure BookedQuoteIsNoLongerKept()
    var
        Insurer: Codeunit "CGR Quote Insurer Spy";
        QuoteMgt: Codeunit "CGR Quote Mgt";
    begin
        HX151Prepare('HX151-F1');
        Insurer.SetInsurerPremium(10);
        BindSubscription(Insurer);
        QuoteMgt.Quote('HX151-F1', 20270301D, 20270303D);
        HX151BookThroughRunner('HX151-F1', 'HX151 Customer F');

        Commit();
        asserterror QuoteMgt.BookQuote('HX151-F1', 20270301D, 20270303D, 'HX151 Customer F');

        Assert.ExpectedError(StrSubstNo(NoQuoteTxt, 'HX151-F1', 20270301D, 20270303D));
        UnbindSubscription(Insurer);
    end;

    [Test]
    procedure RefusedBookingKeepsTheQuote()
    var
        Contract: Record "CGR Rental Contract";
        Insurer: Codeunit "CGR Quote Insurer Spy";
        Partner: Codeunit "CGR Quote Partner Spy";
        QuoteMgt: Codeunit "CGR Quote Mgt";
        ContractNo: Code[20];
    begin
        HX151Prepare('HX151-G1');
        Insurer.SetInsurerPremium(10);
        BindSubscription(Insurer);
        QuoteMgt.Quote('HX151-G1', 20270301D, 20270303D);
        Partner.RefuseBookingFor('HX151 Customer G');
        BindSubscription(Partner);

        Commit();
        asserterror QuoteMgt.BookQuote('HX151-G1', 20270301D, 20270303D, 'HX151 Customer G');

        Assert.ExpectedError(StrSubstNo(PartnerRefusedTxt, 'HX151-G1'));
        UnbindSubscription(Partner);
        Contract.SetRange("Customer Name", 'HX151 Customer G');
        Assert.AreEqual(0, Contract.Count(), 'A refused booking keeps no contract');

        ContractNo := HX151BookThroughRunner('HX151-G1', 'HX151 Customer G');

        Contract.Get(ContractNo);
        Assert.AreEqual(160, Contract."Agreed Price", 'The retry books the kept quote');
        Assert.AreEqual(1, Insurer.PremiumAsked(), 'The retry does not ask the insurer again');
        UnbindSubscription(Insurer);
    end;

    local procedure HX151Prepare(VehicleNo: Code[20])
    var
        QuoteCache: Codeunit "CGR Quote Cache";
    begin
        QuoteCache.Reset();
        WorkDate(20270310D);
        Lib.CreateVehicle(VehicleNo, 1000, Enum::"CGR Maintenance Strategy"::Default);
        Lib.SetDailyRate(VehicleNo, 50);
    end;

    local procedure HX151BookThroughRunner(VehicleNo: Code[20]; CustomerName: Text[100]): Code[20]
    var
        Runner: Codeunit "CGR Quote Book Runner";
        Ok: Boolean;
    begin
        Commit();
        Runner.SetQuoteToBook(VehicleNo, 20270301D, 20270303D, CustomerName);
        ClearLastError();
        Ok := Runner.Run();
        Assert.IsTrue(Ok, 'BookQuote books vehicle ' + VehicleNo + ': ' + GetLastErrorText());
        exit(Runner.BookedContractNo());
    end;
}
