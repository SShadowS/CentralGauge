codeunit 70207 "CGR Weekend Package Price" implements "CGR Rental Price Method"
{
    procedure CalcBasePrice(Contract: Record "CGR Rental Contract"; DailyRate: Decimal): Decimal
    begin
        exit(2 * DailyRate);
    end;
}
