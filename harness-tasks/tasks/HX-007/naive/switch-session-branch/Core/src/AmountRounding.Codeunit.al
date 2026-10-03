codeunit 70010 "CGR Amount Rounding"
{
    procedure Precision(): Decimal
    var
        Setup: Record "CGR Setup";
        BranchRounding: Record "CGR Branch Rounding";
        SessionContext: Codeunit "CGR Session Context";
    begin
        if BranchRounding.Get(SessionContext.CurrentBranch()) then
            if BranchRounding."Rounding Precision" > 0 then
                exit(BranchRounding."Rounding Precision");
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
