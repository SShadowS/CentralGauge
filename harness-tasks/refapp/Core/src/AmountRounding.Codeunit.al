codeunit 70010 "CGR Amount Rounding"
{
    procedure Precision(): Decimal
    var
        Setup: Record "CGR Setup";
        SessionContext: Codeunit "CGR Session Context";
    begin
        SessionContext.GetSetup(Setup);
        if Setup."Amount Rounding Precision" <= 0 then
            exit(0.01);
        exit(Setup."Amount Rounding Precision");
    end;

    procedure RoundAmount(Amount: Decimal): Decimal
    begin
        exit(Round(Amount, Precision()));
    end;
}
