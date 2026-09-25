codeunit 70206 "CGR Daily Price" implements "CGR Rental Price Method"
{
    procedure CalcBasePrice(Contract: Record "CGR Rental Contract"; DailyRate: Decimal): Decimal
    var
        Setup: Record "CGR Setup";
        ExcessKm: Codeunit "CGR Excess Km Charge";
        Amount: Decimal;
        Days: Integer;
        i: Integer;
    begin
        Setup.GetOrCreate();
        Days := Contract."End Date" - Contract."Start Date" + 1;
        Amount := Days * DailyRate;
        for i := 0 to Days - 1 do
            if Date2DWY(Contract."Start Date" + i, 1) in [6, 7] then
                Amount += DailyRate * Setup."Weekend Surcharge %" / 100;
        Amount += ExcessKm.Charge(Contract, Days);
        exit(Round(Amount, 0.01));
    end;
}
