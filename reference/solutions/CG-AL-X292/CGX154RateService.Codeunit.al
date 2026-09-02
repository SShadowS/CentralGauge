codeunit 71381 "CG X154 Rate Service"
{
    SingleInstance = true;

    var
        CachedRates: Dictionary of [Text, Decimal];

    procedure GetServiceRate(ForCompany: Text[30]): Decimal
    var
        RateSetup: Record "CG X154 Rate Setup";
        Rate: Decimal;
    begin
        if not CachedRates.ContainsKey(ForCompany) then begin
            RateSetup.ChangeCompany(ForCompany);
            RateSetup.Get('RATE');
            CachedRates.Add(ForCompany, RateSetup."Service Rate");
        end;
        Rate := CachedRates.Get(ForCompany);
        exit(Rate);
    end;

    procedure Reset()
    begin
        Clear(CachedRates);
    end;
}
