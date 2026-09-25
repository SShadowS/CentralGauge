codeunit 70203 "CGR Rental Pricing"
{
    procedure CalcAmount(Contract: Record "CGR Rental Contract"): Decimal
    var
        Vehicle: Record "CGR Vehicle";
        Setup: Record "CGR Setup";
        Amount: Decimal;
        Days: Integer;
        Driven: Integer;
        Allowed: Integer;
        i: Integer;
    begin
        Vehicle.Get(Contract."Vehicle No.");
        Setup.GetOrCreate();
        Days := Contract."End Date" - Contract."Start Date" + 1;
        case Contract."Pricing Method" of
            Contract."Pricing Method"::Daily:
                begin
                    Amount := Days * Vehicle."Daily Rate";
                    for i := 0 to Days - 1 do
                        if Date2DWY(Contract."Start Date" + i, 1) in [6, 7] then
                            Amount += Vehicle."Daily Rate" * Setup."Weekend Surcharge %" / 100;
                end;
            Contract."Pricing Method"::"Weekend Package":
                Amount := 2 * Vehicle."Daily Rate";
        end;
        Driven := Contract."Return Km" - Contract."Start Km";
        Allowed := Days * Setup."Km Allowance per Day";
        if Driven > Allowed then
            Amount += (Driven - Allowed) * Setup."Excess Km Rate";
        exit(Round(Amount, 0.01));
    end;
}
