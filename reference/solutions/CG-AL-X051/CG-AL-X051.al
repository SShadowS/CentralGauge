codeunit 71400 "CG X051 Closer"
{
    Access = Internal;

    procedure CloseDay(): Integer
    var
        Account: Record "CG X051 Account";
        Engine: Codeunit "CG X051 Engine";
        Fingerprint: Integer;
    begin
        Engine.Settle('A');
        Engine.Settle('B');
        Engine.Settle('C');

        Fingerprint := 0;
        if Account.Get('A') then begin
            Account.SetRange("Kind Filter", "CG X051 Kind"::Normal);
            Account.CalcFields(Balance);
            Fingerprint += Account.Weight * Account.Balance;
        end;
        if Account.Get('B') then begin
            Account.SetRange("Kind Filter", "CG X051 Kind"::Normal);
            Account.CalcFields(Balance);
            Fingerprint += Account.Weight * Account.Balance;
        end;
        if Account.Get('C') then begin
            Account.SetRange("Kind Filter", "CG X051 Kind"::Normal);
            Account.CalcFields(Balance);
            Fingerprint += Account.Weight * Account.Balance;
        end;

        exit(Fingerprint);
    end;
}