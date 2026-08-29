codeunit 71454 "CG X161 Standard Carrier" implements "CG X161 Rate Provider"
{
    procedure GetQuote(WeightKg: Decimal; Zone: Code[10]): Decimal
    var
        RateBand: Record "CG X161 Rate Band";
        ZoneSurcharge: Record "CG X161 Zone Surcharge";
        Surcharge: Decimal;
    begin
        RateBand.SetRange(Carrier, RateBand.Carrier::Standard);
        RateBand.SetFilter("Band Limit Kg", '>=%1', WeightKg);
        if not RateBand.FindFirst() then
            Error(NoRateBandErr, WeightKg);

        if ZoneSurcharge.Get(ZoneSurcharge.Carrier::Standard, Zone) then
            Surcharge := ZoneSurcharge.Surcharge
        else
            Surcharge := 0;

        exit(Round(WeightKg * RateBand."Rate Per Kg" + Surcharge, 0.01));
    end;

    procedure CanShip(WeightKg: Decimal; Zone: Code[10]): Boolean
    var
        CarrierSetup: Record "CG X161 Carrier Setup";
    begin
        if not CarrierSetup.Get(CarrierSetup.Carrier::Standard) then
            exit(false);
        exit(WeightKg <= CarrierSetup."Max Weight Kg");
    end;

    var
        NoRateBandErr: Label 'There is no rate band covering %1 kg.', Comment = '%1 = weight in kg';
}
