codeunit 88136 "HX145 Rerate Runner"
{
    var
        NightRun: Boolean;
        RunBranchCode: Code[10];
        RunFactor: Decimal;
        RunChanged: Integer;

    procedure SetHX145Branch(BranchCode: Code[10]; Factor: Decimal)
    begin
        NightRun := false;
        RunBranchCode := BranchCode;
        RunFactor := Factor;
        RunChanged := -1;
    end;

    procedure SetHX145Night(Factor: Decimal)
    begin
        NightRun := true;
        RunBranchCode := '';
        RunFactor := Factor;
        RunChanged := -1;
    end;

    procedure HX145Changed(): Integer
    begin
        exit(RunChanged);
    end;

    trigger OnRun()
    var
        Rerating: Codeunit "CGR Rerating";
    begin
        if NightRun then
            RunChanged := Rerating.RerateAll(RunFactor)
        else
            RunChanged := Rerating.RerateBranch(RunBranchCode, RunFactor);
    end;
}
