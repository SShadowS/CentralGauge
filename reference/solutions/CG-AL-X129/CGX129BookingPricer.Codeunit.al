codeunit 70892 "CG X129 Booking Pricer"
{
    /// Prices a booking that is charged by the hour and stores the result on it.
    procedure PriceBooking(BookingNo: Code[20])
    var
        Booking: Record "CG X129 Booking";
    begin
        if not Booking.Get(BookingNo) then
            Error(MissingBookingErr, BookingNo);

        Booking.Amount := HourlyAmountFor(Booking."Tier Code", Booking.Hours);
        Booking.Modify();
    end;

    /// What an hourly booking would cost, without recording anything.
    procedure QuoteHourly(TierCode: Code[20]; Hours: Decimal): Decimal
    begin
        exit(HourlyAmountFor(TierCode, Hours));
    end;

    /// Re-prices every hourly booking on a tier after its rate card changes.
    procedure RepriceTier(TierCode: Code[20])
    var
        Booking: Record "CG X129 Booking";
    begin
        Booking.SetRange("Tier Code", TierCode);
        if Booking.FindSet() then
            repeat
                Booking.Amount := HourlyAmountFor(Booking."Tier Code", Booking.Hours);
                Booking.Modify();
            until Booking.Next() = 0;
    end;

    /// Prices a booking that is charged as a single flat fee and stores it.
    procedure PriceFlatFeeBooking(BookingNo: Code[20])
    var
        Booking: Record "CG X129 Booking";
    begin
        if not Booking.Get(BookingNo) then
            Error(MissingBookingErr, BookingNo);

        Booking.Amount := FlatFeeAmountFor(Booking."Tier Code");
        Booking.Modify();
    end;

    /// What a flat-fee booking would cost, without recording anything.
    procedure QuoteFlatFee(TierCode: Code[20]): Decimal
    begin
        exit(FlatFeeAmountFor(TierCode));
    end;

    local procedure HourlyAmountFor(TierCode: Code[20]; Hours: Decimal): Decimal
    var
        RateCard: Record "CG X129 Rate Card";
        ChargeableHours: Decimal;
    begin
        if not RateCard.Get(TierCode) then
            Error(MissingTierErr, TierCode);

        ChargeableHours := Hours;
        if ChargeableHours < RateCard."Minimum Hours" then
            ChargeableHours := RateCard."Minimum Hours";

        exit(Round(ChargeableHours * RateCard."Hourly Rate", 0.01));
    end;

    local procedure FlatFeeAmountFor(TierCode: Code[20]): Decimal
    var
        RateCard: Record "CG X129 Rate Card";
    begin
        if not RateCard.Get(TierCode) then
            Error(MissingTierErr, TierCode);

        exit(Round(RateCard."Flat Fee", 0.01));
    end;

    var
        MissingBookingErr: Label 'Booking %1 does not exist.', Comment = '%1 = booking number';
        MissingTierErr: Label 'There is no rate card for tier %1.', Comment = '%1 = tier code';
}
