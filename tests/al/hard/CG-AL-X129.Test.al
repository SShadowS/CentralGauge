codeunit 89323 "CG-AL-X129 Test"
{
    Subtype = Test;
    TestPermissions = Disabled;

    // The hourly cases are driven from a table of (tier, hours, expected)
    // triples rather than one named test each. The triples ARE the spec - they
    // are literals, not recomputed with the formula under test - and the loop
    // stops at the first mismatch, so a failing run discloses one booking
    // rather than the whole rule. Named tests would ship the entire contract
    // in attempt-2 output (decisions entry 21).

    var
        Assert: Codeunit Assert;

    local procedure ClearFixture()
    var
        RateCard: Record "CG X129 Rate Card";
        Booking: Record "CG X129 Booking";
    begin
        RateCard.DeleteAll();
        Booking.DeleteAll();
    end;

    local procedure SeedTier(TierCode: Code[20]; HourlyRate: Decimal; MinimumHours: Decimal; FlatFee: Decimal)
    var
        RateCard: Record "CG X129 Rate Card";
        Ok: Boolean;
    begin
        RateCard.Init();
        RateCard."Tier Code" := TierCode;
        RateCard."Hourly Rate" := HourlyRate;
        RateCard."Minimum Hours" := MinimumHours;
        RateCard."Flat Fee" := FlatFee;
        Ok := RateCard.Insert();
    end;

    local procedure SeedBooking(No: Code[20]; TierCode: Code[20]; Hours: Decimal; CustomerName: Text[100])
    var
        Booking: Record "CG X129 Booking";
        Ok: Boolean;
    begin
        Booking.Init();
        Booking."No." := No;
        Booking."Tier Code" := TierCode;
        Booking.Hours := Hours;
        Booking."Customer Name" := CustomerName;
        // Nonzero sentinel: an unpriced booking must keep this exactly.
        Booking.Amount := -1;
        Ok := Booking.Insert();
    end;

    local procedure AmountOf(No: Code[20]): Decimal
    var
        Booking: Record "CG X129 Booking";
    begin
        Assert.IsTrue(Booking.Get(No), StrSubstNo('Expected booking %1 to still exist', No));
        exit(Booking.Amount);
    end;

    local procedure SeedStandardTiers()
    begin
        ClearFixture();
        SeedTier('STANDARD', 90, 2, 500);
        SeedTier('PREMIUM', 137.5, 0, 1250);
        SeedTier('CALLOUT', 33.333, 4, 250);
    end;

    // The graded triples. Each row is (tier, hours, expected amount), with the
    // expected value written out rather than derived, so the loop grades the
    // spec and not whatever the implementation happens to compute.
    local procedure CaseCount(): Integer
    begin
        exit(14);
    end;

    local procedure CaseTier(Index: Integer): Code[20]
    begin
        case Index of
            1, 2, 3, 4, 5, 6:
                exit('STANDARD');
            7, 8, 9, 10:
                exit('PREMIUM');
        end;
        exit('CALLOUT');
    end;

    local procedure CaseHours(Index: Integer): Decimal
    begin
        case Index of
            1:
                exit(0.5);
            2:
                exit(1);
            3:
                exit(2);
            4:
                exit(2.5);
            5:
                exit(5);
            6:
                exit(10);
            7:
                exit(0.01);
            8:
                exit(0.25);
            9:
                exit(1);
            10:
                exit(3);
            11:
                exit(1);
            12:
                exit(4);
            13:
                exit(7);
        end;
        exit(10);
    end;

    local procedure CaseExpected(Index: Integer): Decimal
    begin
        case Index of
            1:
                exit(180);
            2:
                exit(180);
            3:
                exit(180);
            4:
                exit(225);
            5:
                exit(450);
            6:
                exit(900);
            7:
                exit(1.38);
            8:
                exit(34.38);
            9:
                exit(137.5);
            10:
                exit(412.5);
            11:
                exit(133.33);
            12:
                exit(133.33);
            13:
                exit(233.33);
        end;
        exit(333.33);
    end;

    [Test]
    procedure RecordedAmountsMatchEachTiersPricing()
    var
        Pricer: Codeunit "CG X129 Booking Pricer";
        Index: Integer;
        BookingNo: Code[20];
    begin
        // [SCENARIO] Every booking in the graded set is priced from its tier
        SeedStandardTiers();

        for Index := 1 to CaseCount() do begin
            BookingNo := StrSubstNo('BK-S%1', Index);
            SeedBooking(BookingNo, CaseTier(Index), CaseHours(Index), 'Adatum');

            Pricer.PriceBooking(BookingNo);

            Assert.AreEqual(CaseExpected(Index), AmountOf(BookingNo),
                StrSubstNo('Expected the recorded amount for booking %1 to match its tier''s pricing', BookingNo));
        end;
    end;

    [Test]
    procedure QuotedAmountsMatchEachTiersPricing()
    var
        Pricer: Codeunit "CG X129 Booking Pricer";
        Index: Integer;
    begin
        // [SCENARIO] A quote agrees with the same tier's pricing, in memory
        SeedStandardTiers();

        for Index := 1 to CaseCount() do
            Assert.AreEqual(CaseExpected(Index), Pricer.QuoteHourly(CaseTier(Index), CaseHours(Index)),
                StrSubstNo('Expected the quote for graded case %1 to match its tier''s pricing', Index));
    end;

    [Test]
    procedure AQuoteAgreesWithWhatIsRecorded()
    var
        Pricer: Codeunit "CG X129 Booking Pricer";
    begin
        // [SCENARIO] A quote and the recorded amount cannot disagree
        SeedStandardTiers();
        SeedBooking('BK-08', 'STANDARD', 3.5, 'Adatum');

        Pricer.PriceBooking('BK-08');

        Assert.AreEqual(315.0, AmountOf('BK-08'),
            'Expected the recorded amount for this booking to match its tier''s pricing');
        Assert.AreEqual(315.0, Pricer.QuoteHourly('STANDARD', 3.5),
            'Expected the quote for this booking to match its tier''s pricing');
    end;

    [Test]
    procedure PricingOneBookingLeavesItsSiblingsAlone()
    var
        Pricer: Codeunit "CG X129 Booking Pricer";
    begin
        // [SCENARIO] Two bookings on the same tier, only one is priced
        SeedStandardTiers();
        SeedBooking('BK-13A', 'STANDARD', 4, 'Adatum');
        SeedBooking('BK-13B', 'STANDARD', 9, 'Contoso');

        Pricer.PriceBooking('BK-13A');

        Assert.AreEqual(360.0, AmountOf('BK-13A'),
            'Expected the priced booking to carry its tier''s amount');
        Assert.AreEqual(-1.0, AmountOf('BK-13B'),
            'Expected the other booking to be left exactly as it was');
    end;

    [Test]
    procedure RepricingATierCoversEveryBookingOnIt()
    var
        Booking: Record "CG X129 Booking";
        Pricer: Codeunit "CG X129 Booking Pricer";
    begin
        // [SCENARIO] A tier's rate card changed and its bookings are redone
        SeedStandardTiers();
        SeedBooking('BK-09A', 'STANDARD', 4, 'Adatum');
        SeedBooking('BK-09B', 'STANDARD', 1, 'Contoso');
        SeedBooking('BK-09C', 'PREMIUM', 4, 'Fabrikam');

        Pricer.RepriceTier('STANDARD');

        Assert.AreEqual(360.0, AmountOf('BK-09A'),
            'Expected every booking on the tier to carry its tier''s amount');
        Assert.AreEqual(180.0, AmountOf('BK-09B'),
            'Expected a short booking on the tier to carry its tier''s amount');
        Booking.Get('BK-09C');
        Assert.AreEqual(-1.0, Booking.Amount,
            'Expected a booking on another tier to be left exactly as it was');
        Assert.AreEqual(4.0, Booking.Hours,
            'Expected a booking on another tier to keep its hours');
        Assert.AreEqual('Fabrikam', Booking."Customer Name",
            'Expected a booking on another tier to keep its customer');
    end;

    [Test]
    procedure PricingABookingOnAnUnknownTierFails()
    var
        Pricer: Codeunit "CG X129 Booking Pricer";
    begin
        // [SCENARIO] The booking names a tier that has no rate card
        SeedStandardTiers();
        SeedBooking('BK-10', 'NO-SUCH-TIER', 3, 'Adatum');

        asserterror Pricer.PriceBooking('BK-10');

        Assert.ExpectedError('NO-SUCH-TIER');
    end;

    [Test]
    procedure QuotingAnUnknownTierFails()
    var
        Pricer: Codeunit "CG X129 Booking Pricer";
    begin
        // [SCENARIO] A quote is asked for against a tier that has no rate card
        SeedStandardTiers();

        asserterror Pricer.QuoteHourly('NO-SUCH-TIER', 3);

        Assert.ExpectedError('NO-SUCH-TIER');
    end;

    [Test]
    procedure PricingABookingThatDoesNotExistFails()
    var
        Pricer: Codeunit "CG X129 Booking Pricer";
    begin
        // [SCENARIO] There is no such booking to price
        SeedStandardTiers();

        asserterror Pricer.PriceBooking('BK-NOPE');

        Assert.ExpectedError('BK-NOPE');
    end;

    [Test]
    procedure PricingAFlatFeeBookingThatDoesNotExistFails()
    var
        Pricer: Codeunit "CG X129 Booking Pricer";
    begin
        // [SCENARIO] There is no such booking to price on the flat-fee side
        SeedStandardTiers();

        asserterror Pricer.PriceFlatFeeBooking('BK-NOPE');

        Assert.ExpectedError('BK-NOPE');
    end;

    [Test]
    procedure AFlatFeeBookingIsChargedItsTiersFlatFee()
    var
        Pricer: Codeunit "CG X129 Booking Pricer";
    begin
        // [SCENARIO] The flat-fee side of the product, whatever hours are on it
        SeedStandardTiers();
        SeedBooking('BK-11', 'PREMIUM', 9, 'Northwind Traders');

        Pricer.PriceFlatFeeBooking('BK-11');

        Assert.AreEqual(1250.0, AmountOf('BK-11'),
            'Expected a flat-fee booking to carry its tier''s flat fee');
        Assert.AreEqual(500.0, Pricer.QuoteFlatFee('STANDARD'),
            'Expected a flat-fee quote to be its tier''s flat fee');
    end;

    [Test]
    procedure AFlatFeeIsRecordedToTheCent()
    var
        Pricer: Codeunit "CG X129 Booking Pricer";
    begin
        // [SCENARIO] A flat fee carrying a fraction of a cent
        ClearFixture();
        SeedTier('ODDFEE', 100, 0, 250.005);
        SeedBooking('BK-14', 'ODDFEE', 1, 'Adatum');

        Pricer.PriceFlatFeeBooking('BK-14');

        Assert.AreEqual(250.01, AmountOf('BK-14'),
            'Expected a flat-fee booking to carry an amount recorded to the cent');
    end;

    [Test]
    procedure AFlatFeeBookingOnAnUnknownTierFails()
    var
        Pricer: Codeunit "CG X129 Booking Pricer";
    begin
        // [SCENARIO] The flat-fee booking names a tier that has no rate card
        SeedStandardTiers();
        SeedBooking('BK-15', 'NO-SUCH-TIER', 3, 'Adatum');

        asserterror Pricer.PriceFlatFeeBooking('BK-15');

        Assert.ExpectedError('NO-SUCH-TIER');
    end;

    [Test]
    procedure PricingLeavesTheBookingsOwnDetailsAlone()
    var
        Booking: Record "CG X129 Booking";
        Pricer: Codeunit "CG X129 Booking Pricer";
    begin
        // [SCENARIO] Pricing touches the amount and nothing else
        SeedStandardTiers();
        SeedBooking('BK-12', 'STANDARD', 6, 'Northwind Traders');

        Pricer.PriceBooking('BK-12');

        Booking.Get('BK-12');
        Assert.AreEqual('Northwind Traders', Booking."Customer Name",
            'Expected the customer on the booking to be left exactly as it was');
        Assert.AreEqual(6.0, Booking.Hours,
            'Expected the hours on the booking to be left exactly as they were');
        Assert.AreEqual('STANDARD', Booking."Tier Code",
            'Expected the tier on the booking to be left exactly as it was');
    end;

    [Test]
    procedure FlatFeePricingLeavesTheBookingsOwnDetailsAlone()
    var
        Booking: Record "CG X129 Booking";
        Pricer: Codeunit "CG X129 Booking Pricer";
    begin
        // [SCENARIO] The flat-fee side touches the amount and nothing else
        SeedStandardTiers();
        SeedBooking('BK-16', 'STANDARD', 7, 'Contoso');

        Pricer.PriceFlatFeeBooking('BK-16');

        Booking.Get('BK-16');
        Assert.AreEqual(500.0, Booking.Amount,
            'Expected the flat-fee booking to carry its tier''s flat fee');
        Assert.AreEqual(7.0, Booking.Hours,
            'Expected the hours on the booking to be left exactly as they were');
        Assert.AreEqual('Contoso', Booking."Customer Name",
            'Expected the customer on the booking to be left exactly as it was');
    end;
}
