codeunit 70921 "CG X132 Balance Buffer"
{
    var
        NotAWorkingCopyErr: Label 'CG X132 Balance Buffer only accepts a working copy of balance lines built up in memory; the real balance table cannot be passed in directly.';

    procedure ProcessBuffer(var BalanceLine: Record "CG X132 Balance Line"): Decimal
    var
        Total: Decimal;
    begin
        if not BalanceLine.IsTemporary() then
            Error(NotAWorkingCopyErr);

        if BalanceLine.FindSet() then
            repeat
                BalanceLine.Reviewed := true;
                BalanceLine.Modify();
                Total += BalanceLine.Amount;
            until BalanceLine.Next() = 0;

        exit(Total);
    end;

    procedure ArchiveBuffer(var BalanceLine: Record "CG X132 Balance Line")
    begin
        if BalanceLine.FindSet() then
            repeat
                BalanceLine.Reviewed := true;
                BalanceLine.Amount := 0;
                BalanceLine.Modify();
            until BalanceLine.Next() = 0;
    end;
}
