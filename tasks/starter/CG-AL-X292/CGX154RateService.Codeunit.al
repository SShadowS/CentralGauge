codeunit 71381 "CG X154 Rate Service"
{
    SingleInstance = true;

    var
        CachedRate: Decimal;
        HasCachedRate: Boolean;

    procedure GetServiceRate(ForCompany: Text[30]): Decimal
    var
        RateSetup: Record "CG X154 Rate Setup";
    begin
        if not HasCachedRate then begin
            RateSetup.ChangeCompany(ForCompany);
            RateSetup.Get('RATE');
            CachedRate := RateSetup."Service Rate";
            HasCachedRate := true;
        end;
        exit(CachedRate);
    end;

    procedure Reset()
    begin
        Clear(CachedRate);
        HasCachedRate := false;
    end;
}
