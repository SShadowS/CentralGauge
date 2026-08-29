codeunit 89381 "CG-AL-X161 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    // Standard and Express are graded from small tables of (weight, zone,
    // expected) triples rather than one named test per case - the triples ARE
    // the spec, and a failing sweep discloses one case rather than the whole
    // rate table (decisions entry 21).

    var
        Assert: Codeunit Assert;

    local procedure ClearFixture()
    var
        CarrierSetup: Record "CG X161 Carrier Setup";
        RateBand: Record "CG X161 Rate Band";
        ZoneSurcharge: Record "CG X161 Zone Surcharge";
    begin
        CarrierSetup.DeleteAll();
        RateBand.DeleteAll();
        ZoneSurcharge.DeleteAll();
    end;

    local procedure SeedCarrierSetup(Carrier: Enum "CG X161 Carrier"; MaxWeightKg: Decimal)
    var
        CarrierSetup: Record "CG X161 Carrier Setup";
        Ok: Boolean;
    begin
        CarrierSetup.Init();
        CarrierSetup.Carrier := Carrier;
        CarrierSetup."Max Weight Kg" := MaxWeightKg;
        Ok := CarrierSetup.Insert();
    end;

    local procedure SeedRateBand(Carrier: Enum "CG X161 Carrier"; BandLimitKg: Decimal; RatePerKg: Decimal)
    var
        RateBand: Record "CG X161 Rate Band";
        Ok: Boolean;
    begin
        RateBand.Init();
        RateBand.Carrier := Carrier;
        RateBand."Band Limit Kg" := BandLimitKg;
        RateBand."Rate Per Kg" := RatePerKg;
        Ok := RateBand.Insert();
    end;

    local procedure SeedZoneSurcharge(Carrier: Enum "CG X161 Carrier"; Zone: Code[10]; Surcharge: Decimal)
    var
        ZoneSurcharge: Record "CG X161 Zone Surcharge";
        Ok: Boolean;
    begin
        ZoneSurcharge.Init();
        ZoneSurcharge.Carrier := Carrier;
        ZoneSurcharge.Zone := Zone;
        ZoneSurcharge.Surcharge := Surcharge;
        Ok := ZoneSurcharge.Insert();
    end;

    local procedure SeedFixture()
    begin
        ClearFixture();

        SeedCarrierSetup("CG X161 Carrier"::Standard, 50);
        SeedRateBand("CG X161 Carrier"::Standard, 5, 10);
        SeedRateBand("CG X161 Carrier"::Standard, 20, 7);
        SeedRateBand("CG X161 Carrier"::Standard, 50, 5);
        SeedZoneSurcharge("CG X161 Carrier"::Standard, 'DOM', 0);
        SeedZoneSurcharge("CG X161 Carrier"::Standard, 'INTL', 15);

        SeedCarrierSetup("CG X161 Carrier"::Express, 30);
        SeedRateBand("CG X161 Carrier"::Express, 5, 18);
        SeedRateBand("CG X161 Carrier"::Express, 15, 14);
        SeedRateBand("CG X161 Carrier"::Express, 30, 11);
        SeedZoneSurcharge("CG X161 Carrier"::Express, 'DOM', 5);
        SeedZoneSurcharge("CG X161 Carrier"::Express, 'INTL', 25);
    end;

    // Graded Standard cases: (weight, zone, expected). Case 5 is the default.
    local procedure StdCaseCount(): Integer
    begin
        exit(5);
    end;

    local procedure StdCaseWeight(Index: Integer): Decimal
    begin
        case Index of
            1:
                exit(3);
            2:
                exit(3);
            3:
                exit(5);
            4:
                exit(5.01);
        end;
        exit(50);
    end;

    local procedure StdCaseZone(Index: Integer): Code[10]
    begin
        case Index of
            2:
                exit('INTL');
        end;
        exit('DOM');
    end;

    local procedure StdCaseExpected(Index: Integer): Decimal
    begin
        case Index of
            1:
                exit(30);
            2:
                exit(45);
            3:
                exit(50);
            4:
                exit(35.07);
        end;
        exit(250);
    end;

    // Graded Express cases: (weight, zone, expected). Case 5 is the default.
    local procedure ExpCaseCount(): Integer
    begin
        exit(5);
    end;

    local procedure ExpCaseWeight(Index: Integer): Decimal
    begin
        case Index of
            1:
                exit(3);
            2:
                exit(3);
            3:
                exit(15);
            4:
                exit(15.01);
        end;
        exit(30);
    end;

    local procedure ExpCaseZone(Index: Integer): Code[10]
    begin
        case Index of
            2, 5:
                exit('INTL');
        end;
        exit('DOM');
    end;

    local procedure ExpCaseExpected(Index: Integer): Decimal
    begin
        case Index of
            1:
                exit(59);
            2:
                exit(79);
            3:
                exit(215);
            4:
                exit(170.11);
        end;
        exit(355);
    end;

    [Test]
    procedure StandardQuotesMatchItsOwnRatesAndZones()
    var
        StandardCarrier: Codeunit "CG X161 Standard Carrier";
        Provider: Interface "CG X161 Rate Provider";
        Index: Integer;
    begin
        // [SCENARIO] Standard's quotes come from its own bands and surcharges
        SeedFixture();
        Provider := StandardCarrier;

        for Index := 1 to StdCaseCount() do
            Assert.AreEqual(StdCaseExpected(Index), Provider.GetQuote(StdCaseWeight(Index), StdCaseZone(Index)),
                StrSubstNo('Expected Standard''s quote for graded case %1 to match its own rates', Index));
    end;

    [Test]
    procedure StandardCanShipAtItsOwnWeightLimit()
    var
        StandardCarrier: Codeunit "CG X161 Standard Carrier";
        Provider: Interface "CG X161 Rate Provider";
    begin
        // [SCENARIO] Standard's shippability boundary sits at its own limit
        SeedFixture();
        Provider := StandardCarrier;

        Assert.IsTrue(Provider.CanShip(50, 'DOM'),
            'Expected Standard to be able to carry a shipment right at its own weight limit');
        Assert.IsFalse(Provider.CanShip(50.01, 'DOM'),
            'Expected Standard to refuse a shipment just over its own weight limit');
    end;

    [Test]
    procedure StandardRefusesToQuoteBeyondEveryBand()
    var
        StandardCarrier: Codeunit "CG X161 Standard Carrier";
        Provider: Interface "CG X161 Rate Provider";
    begin
        // [SCENARIO] There is no rate band at all for an extreme weight
        SeedFixture();
        Provider := StandardCarrier;

        asserterror Provider.GetQuote(999, 'DOM');

        Assert.ExpectedError('999');
    end;

    [Test]
    procedure ExpressQuotesMatchItsOwnRatesAndZones()
    var
        ExpressCarrier: Codeunit "CG X161 Express Carrier";
        Provider: Interface "CG X161 Rate Provider";
        Index: Integer;
    begin
        // [SCENARIO] Express's quotes come from its own bands and surcharges
        SeedFixture();
        Provider := ExpressCarrier;

        for Index := 1 to ExpCaseCount() do
            Assert.AreEqual(ExpCaseExpected(Index), Provider.GetQuote(ExpCaseWeight(Index), ExpCaseZone(Index)),
                StrSubstNo('Expected Express''s quote for graded case %1 to match its own rates', Index));
    end;

    [Test]
    procedure ExpressCanShipAtItsOwnWeightLimit()
    var
        ExpressCarrier: Codeunit "CG X161 Express Carrier";
        Provider: Interface "CG X161 Rate Provider";
    begin
        // [SCENARIO] Express's shippability boundary sits at its own limit,
        // which is not the same limit as Standard's
        SeedFixture();
        Provider := ExpressCarrier;

        Assert.IsTrue(Provider.CanShip(30, 'DOM'),
            'Expected Express to be able to carry a shipment right at its own weight limit');
        Assert.IsFalse(Provider.CanShip(30.01, 'DOM'),
            'Expected Express to refuse a shipment just over its own weight limit');
        Assert.IsFalse(Provider.CanShip(40, 'DOM'),
            'Expected Express to refuse a shipment its own weight limit cannot carry, even though the other carrier could');
    end;

    [Test]
    procedure ExpressRefusesToQuoteBeyondEveryBand()
    var
        ExpressCarrier: Codeunit "CG X161 Express Carrier";
        Provider: Interface "CG X161 Rate Provider";
    begin
        // [SCENARIO] There is no rate band at all for an extreme weight
        SeedFixture();
        Provider := ExpressCarrier;

        asserterror Provider.GetQuote(999, 'DOM');

        Assert.ExpectedError('999');
    end;

    [Test]
    procedure TheTwoCarriersQuoteDifferentlyForTheSameWeightAndZone()
    var
        StandardCarrier: Codeunit "CG X161 Standard Carrier";
        ExpressCarrier: Codeunit "CG X161 Express Carrier";
        StandardProvider: Interface "CG X161 Rate Provider";
        ExpressProvider: Interface "CG X161 Rate Provider";
    begin
        // [SCENARIO] The same request quotes each carrier's own price
        SeedFixture();
        StandardProvider := StandardCarrier;
        ExpressProvider := ExpressCarrier;

        Assert.AreEqual(30, StandardProvider.GetQuote(3, 'DOM'),
            'Expected Standard''s quote for this shipment to be its own price');
        Assert.AreEqual(59, ExpressProvider.GetQuote(3, 'DOM'),
            'Expected Express''s quote for the very same shipment to be its own price, not Standard''s');
    end;

    [Test]
    procedure DispatchingQuotesTheSameAsCallingTheCarrierDirectly()
    var
        StandardCarrier: Codeunit "CG X161 Standard Carrier";
        ExpressCarrier: Codeunit "CG X161 Express Carrier";
        Dispatcher: Codeunit "CG X161 Rate Dispatcher";
        StandardProvider: Interface "CG X161 Rate Provider";
        ExpressProvider: Interface "CG X161 Rate Provider";
    begin
        // [SCENARIO] Asking by carrier name matches that carrier's own quote,
        // and agrees with asking the carrier directly
        SeedFixture();
        StandardProvider := StandardCarrier;
        ExpressProvider := ExpressCarrier;

        Assert.AreEqual(84, Dispatcher.Quote("CG X161 Carrier"::Standard, 12, 'DOM'),
            'Expected dispatching to Standard by name to match Standard''s own quote');
        Assert.AreEqual(StandardProvider.GetQuote(12, 'DOM'), Dispatcher.Quote("CG X161 Carrier"::Standard, 12, 'DOM'),
            'Expected dispatching to Standard by name to agree with calling Standard directly');

        Assert.AreEqual(215, Dispatcher.Quote("CG X161 Carrier"::Express, 15, 'DOM'),
            'Expected dispatching to Express by name to match Express''s own quote, not Standard''s');
        Assert.AreEqual(ExpressProvider.GetQuote(15, 'DOM'), Dispatcher.Quote("CG X161 Carrier"::Express, 15, 'DOM'),
            'Expected dispatching to Express by name to agree with calling Express directly');
    end;

    [Test]
    procedure DispatchingChecksShippabilityTheSameAsCallingTheCarrierDirectly()
    var
        Dispatcher: Codeunit "CG X161 Rate Dispatcher";
    begin
        // [SCENARIO] Asking by carrier name agrees with each carrier's own limit
        SeedFixture();

        Assert.IsTrue(Dispatcher.IsShippable("CG X161 Carrier"::Standard, 50, 'DOM'),
            'Expected dispatching to Standard to allow a shipment right at Standard''s own limit');
        Assert.IsTrue(Dispatcher.IsShippable("CG X161 Carrier"::Express, 30, 'DOM'),
            'Expected dispatching to Express to allow a shipment right at Express''s own limit');
        Assert.IsFalse(Dispatcher.IsShippable("CG X161 Carrier"::Express, 40, 'DOM'),
            'Expected dispatching to Express to refuse a shipment beyond Express''s own limit, even though Standard could carry it');
    end;
}
