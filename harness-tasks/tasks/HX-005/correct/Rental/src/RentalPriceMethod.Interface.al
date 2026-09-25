interface "CGR Rental Price Method"
{
    procedure CalcBasePrice(Contract: Record "CGR Rental Contract"; DailyRate: Decimal): Decimal;
}
