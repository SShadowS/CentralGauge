codeunit 70203 "CGR Rental Pricing"
{
    procedure CalcAmount(Contract: Record "CGR Rental Contract"): Decimal
    var
        Vehicle: Record "CGR Vehicle";
        DailyPrice: Codeunit "CGR Daily Price";
        WeekendPrice: Codeunit "CGR Weekend Package Price";
        ExcessKm: Codeunit "CGR Excess Km Charge";
        Amount: Decimal;
    begin
        Vehicle.Get(Contract."Vehicle No.");
        case Contract."Pricing Method" of
            Contract."Pricing Method"::Daily:
                Amount := DailyPrice.CalcBasePrice(Contract, Vehicle."Daily Rate");
            Contract."Pricing Method"::"Weekend Package":
                Amount := WeekendPrice.CalcBasePrice(Contract, Vehicle."Daily Rate");
            else
                Amount := 0;
        end;
        // The excess km charge is common to every method; round once, at the end.
        Amount += ExcessKm.Charge(Contract, Contract."End Date" - Contract."Start Date" + 1);
        exit(Round(Amount, 0.01));
    end;
}
