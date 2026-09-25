codeunit 70203 "CGR Rental Pricing"
{
    procedure CalcAmount(Contract: Record "CGR Rental Contract"): Decimal
    var
        Vehicle: Record "CGR Vehicle";
        Method: Interface "CGR Rental Price Method";
    begin
        Vehicle.Get(Contract."Vehicle No.");
        Method := Contract."Pricing Method";
        exit(Method.CalcBasePrice(Contract, Vehicle."Daily Rate"));
    end;
}
