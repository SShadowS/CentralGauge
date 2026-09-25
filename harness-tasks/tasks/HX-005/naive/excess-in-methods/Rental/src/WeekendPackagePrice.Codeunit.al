codeunit 70207 "CGR Weekend Package Price" implements "CGR Rental Price Method"
{
    procedure CalcBasePrice(Contract: Record "CGR Rental Contract"; DailyRate: Decimal): Decimal
    var
        ExcessKm: Codeunit "CGR Excess Km Charge";
    begin
        exit(Round(2 * DailyRate + ExcessKm.Charge(Contract, Contract."End Date" - Contract."Start Date" + 1), 0.01));
    end;
}
