codeunit 70881 "CG X128 Collection Policy"
{
    local procedure GetSetup(var Setup: Record "CG X128 Collection Setup")
    begin
        if not Setup.Get('SETUP') then begin
            Setup.Init();
            Setup."Primary Key" := 'SETUP';
            Setup."Grace Period Days" := 14;
            Setup."Late Fee Percent" := 1.5;
            Setup.Insert();
        end;
    end;

    procedure SetGracePeriodDays(Days: Integer)
    var
        Setup: Record "CG X128 Collection Setup";
    begin
        GetSetup(Setup);
        Setup."Grace Period Days" := Days;
        Setup.Modify();
    end;

    procedure GetGracePeriodDays(): Integer
    var
        Setup: Record "CG X128 Collection Setup";
    begin
        GetSetup(Setup);
        exit(Setup."Grace Period Days");
    end;

    procedure SetLateFeePercent(Pct: Decimal)
    var
        Setup: Record "CG X128 Collection Setup";
    begin
        GetSetup(Setup);
        Setup."Late Fee Percent" := Pct;
        Setup.Modify();
    end;

    procedure GetLateFeePercent(): Decimal
    var
        Setup: Record "CG X128 Collection Setup";
    begin
        GetSetup(Setup);
        exit(Setup."Late Fee Percent");
    end;

    procedure IsOverdue(DaysSinceDue: Integer): Boolean
    begin
        exit(DaysSinceDue > GetGracePeriodDays());
    end;

    procedure CalculateLateFee(Amount: Decimal): Decimal
    begin
        exit(Amount * GetLateFeePercent() / 100);
    end;
}
