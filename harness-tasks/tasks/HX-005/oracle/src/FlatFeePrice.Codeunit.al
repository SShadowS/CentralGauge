codeunit 85401 "HX5 Flat Fee Price" implements "CGR Rental Price Method"
{
    procedure CalcBasePrice(Contract: Record "CGR Rental Contract"; DailyRate: Decimal): Decimal
    begin
        exit(DailyRate * 1.5 * (Contract."End Date" - Contract."Start Date" + 1));
    end;
}
