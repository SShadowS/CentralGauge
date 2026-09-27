codeunit 70208 "CGR Excess Km Charge"
{
    procedure Charge(Contract: Record "CGR Rental Contract"; Days: Integer): Decimal
    var
        Setup: Record "CGR Setup";
        Driven: Integer;
        Allowed: Integer;
    begin
        Setup.GetOrCreate();
        Driven := Contract."Return Km" - Contract."Start Km";
        Allowed := Days * Setup."Km Allowance per Day";
        if Driven > Allowed then
            exit((Driven - Allowed) * Setup."Excess Km Rate");
        exit(0);
    end;
}
