codeunit 70203 "CGR Rental Pricing"
{
    procedure CalcAmount(Contract: Record "CGR Rental Contract"): Decimal
    var
        Vehicle: Record "CGR Vehicle";
        Method: Interface "CGR Rental Price Method";
        ExcessKm: Codeunit "CGR Excess Km Charge";
        Amount: Decimal;
    begin
        Vehicle.Get(Contract."Vehicle No.");
        Method := Contract."Pricing Method";
        Amount := Method.CalcBasePrice(Contract, Vehicle."Daily Rate");
        // The excess km charge is common to every method; round once, at the end.
        Amount += ExcessKm.Charge(Contract, Contract."End Date" - Contract."Start Date" + 1);
        exit(Round(Amount, 0.01));
    end;
}
