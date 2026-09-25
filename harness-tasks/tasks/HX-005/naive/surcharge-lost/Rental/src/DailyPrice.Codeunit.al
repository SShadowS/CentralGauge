codeunit 70206 "CGR Daily Price" implements "CGR Rental Price Method"
{
    procedure CalcBasePrice(Contract: Record "CGR Rental Contract"; DailyRate: Decimal): Decimal
    var
        Setup: Record "CGR Setup";
        Amount: Decimal;
        Days: Integer;
    begin
        Setup.GetOrCreate();
        Days := Contract."End Date" - Contract."Start Date" + 1;
        Amount := Days * DailyRate;
        exit(Amount);
    end;
}
